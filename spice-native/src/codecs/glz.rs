/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use miniz_oxide::inflate::decompress_to_vec_zlib;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use super::util::{read_be_u16, read_be_u32, read_be_u64, read_be_variable, read_bytes, read_u8};
use super::LzImageType;

#[derive(Deserialize)]
pub(super) struct GlzDictionaryEntry {
    id: String,
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[derive(Serialize)]
pub(super) struct DecodedGlzImage {
    pub(super) image_id: String,
    width: u32,
    height: u32,
    pub(super) pixels: Vec<u8>,
}

#[wasm_bindgen]
pub fn glz_rgb_decode(input: &[u8], dictionary: JsValue) -> Result<JsValue, JsValue> {
    let entries: Vec<GlzDictionaryEntry> = serde_wasm_bindgen::from_value(dictionary)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let decoded = decode_glz_image(input, &entries).map_err(|error| JsValue::from_str(&error))?;
    serde_wasm_bindgen::to_value(&decoded).map_err(|error| JsValue::from_str(&error.to_string()))
}

#[wasm_bindgen]
pub fn zlib_glz_rgb_decode(input: &[u8], dictionary: JsValue) -> Result<JsValue, JsValue> {
    let inflated = decompress_to_vec_zlib(input)
        .map_err(|error| JsValue::from_str(&format!("zlib inflate failed: {:?}", error)))?;
    glz_rgb_decode(&inflated, dictionary)
}

pub(super) fn decode_glz_image(
    input: &[u8],
    dictionary: &[GlzDictionaryEntry],
) -> Result<DecodedGlzImage, String> {
    let mut position = 0usize;
    let magic = read_bytes(input, &mut position, 4)?;
    if magic != b"  ZL" {
        return Err("Invalid GLZ magic.".into());
    }

    let _major = read_be_u16(input, &mut position)?;
    let _minor = read_be_u16(input, &mut position)?;
    let type_and_flags = read_u8(input, &mut position)?;
    let image_type = type_and_flags & 0x0f;
    let top_down = (type_and_flags >> 4) != 0;
    let width = read_be_u32(input, &mut position)?;
    let height = read_be_u32(input, &mut position)?;
    let _stride = read_be_u32(input, &mut position)?;
    let image_id = read_be_u64(input, &mut position)?;
    let _window_head_distance = read_be_u32(input, &mut position)?;

    let total_pixels = (width as usize).saturating_mul(height as usize);
    let mut out = vec![0u8; total_pixels.saturating_mul(4)];
    let mut out_pixels = 0usize;

    while out_pixels < total_pixels && position < input.len() {
        let ctrl = read_u8(input, &mut position)? as usize;
        if ctrl < 32 {
            let direct_count = ctrl + 1;
            for _ in 0..direct_count {
                if out_pixels >= total_pixels {
                    break;
                }

                let pixel = read_glz_direct_pixel(input, &mut position, image_type)?;
                write_pixel(&mut out, out_pixels, pixel);
                out_pixels += 1;
            }
            continue;
        }

        let mut run_length = ctrl >> 5;
        if run_length == 7 {
            loop {
                let extension = read_u8(input, &mut position)? as usize;
                run_length += extension;
                if extension != 255 {
                    break;
                }
            }
        }

        let mut extended_offset = (ctrl & 0x0f) as usize;
        let mut pixel_flag = (ctrl & 0x10) != 0;
        extended_offset |= (read_u8(input, &mut position)? as usize) << 4;

        let distance_descriptor = read_u8(input, &mut position)?;
        let image_flag = (distance_descriptor >> 6) as usize;
        let image_distance = if !pixel_flag {
            let low_distance = (distance_descriptor & 0x3f) as u64;
            let high_distance = read_be_variable(input, &mut position, image_flag)?;
            (high_distance << 6) | low_distance
        } else {
            pixel_flag = (distance_descriptor & 0x20) != 0;
            extended_offset |= ((distance_descriptor & 0x1f) as usize) << 12;
            let distance = read_be_variable(input, &mut position, image_flag)?;
            if pixel_flag {
                extended_offset |= (read_u8(input, &mut position)? as usize) << 17;
            }
            distance
        };

        if image_distance == 0 {
            if extended_offset == 0 || extended_offset > out_pixels {
                return Err("GLZ current-image offset was outside the decoded output.".into());
            }

            if extended_offset == 1 {
                let pixel = read_pixel(&out, out_pixels - 1);
                for _ in 0..run_length {
                    if out_pixels >= total_pixels {
                        break;
                    }
                    write_pixel(&mut out, out_pixels, pixel);
                    out_pixels += 1;
                }
            } else {
                let mut ref_pixel_index = out_pixels - extended_offset;
                for _ in 0..run_length {
                    if out_pixels >= total_pixels {
                        break;
                    }
                    let pixel = read_pixel(&out, ref_pixel_index);
                    write_pixel(&mut out, out_pixels, pixel);
                    out_pixels += 1;
                    ref_pixel_index += 1;
                }
            }
        } else {
            let target_id = image_id.checked_sub(image_distance).ok_or_else(|| {
                "GLZ referenced an image older than the dictionary permits.".to_string()
            })?;
            let target = dictionary
                .iter()
                .find(|entry| entry.id.parse::<u64>().ok() == Some(target_id))
                .ok_or_else(|| format!("GLZ dictionary entry {target_id} was not available."))?;
            let start = extended_offset.saturating_mul(4);
            let declared_pixels = (target.width as usize).saturating_mul(target.height as usize);
            let available_pixels = usize::min(declared_pixels, target.pixels.len() / 4);
            if extended_offset >= available_pixels || start >= target.pixels.len() {
                return Err(format!(
                    "GLZ referenced offset {extended_offset} outside image {target_id}."
                ));
            }

            let copy_pixels = usize::min(run_length, available_pixels - extended_offset);
            for index in 0..copy_pixels {
                if out_pixels >= total_pixels {
                    break;
                }
                let source_index = extended_offset + index;
                let pixel = read_pixel(&target.pixels, source_index);
                write_pixel(&mut out, out_pixels, pixel);
                out_pixels += 1;
            }
        }
    }

    if !top_down {
        flip_rgba_rows(&mut out, width as usize, height as usize);
    }

    Ok(DecodedGlzImage {
        image_id: image_id.to_string(),
        width,
        height,
        pixels: out,
    })
}

fn read_glz_direct_pixel(
    input: &[u8],
    position: &mut usize,
    image_type: u8,
) -> Result<[u8; 4], String> {
    match image_type {
        x if x == LzImageType::Rgb16 as u8 => {
            let low = read_u8(input, position)? as u16;
            let high = read_u8(input, position)? as u16;
            let packed = low | (high << 8);
            let red = ((packed >> 10) & 0x1f) as u8;
            let green = ((packed >> 5) & 0x1f) as u8;
            let blue = (packed & 0x1f) as u8;
            Ok([
                (red << 3) | (red >> 2),
                (green << 3) | (green >> 2),
                (blue << 3) | (blue >> 2),
                255,
            ])
        }
        x if x == LzImageType::Rgb24 as u8 || x == LzImageType::Rgb32 as u8 => {
            let blue = read_u8(input, position)?;
            let green = read_u8(input, position)?;
            let red = read_u8(input, position)?;
            if image_type == LzImageType::Rgb32 as u8 {
                let _padding = read_u8(input, position)?;
            }
            Ok([red, green, blue, 255])
        }
        x if x == LzImageType::Rgba as u8 => {
            let blue = read_u8(input, position)?;
            let green = read_u8(input, position)?;
            let red = read_u8(input, position)?;
            let alpha = read_u8(input, position)?;
            Ok([red, green, blue, alpha])
        }
        _ => Err(format!("Unsupported GLZ image type {image_type}.")),
    }
}

fn flip_rgba_rows(pixels: &mut [u8], width: usize, height: usize) {
    if width == 0 || height <= 1 {
        return;
    }

    let row_bytes = width * 4;
    let mut scratch = vec![0u8; row_bytes];
    for row in 0..(height / 2) {
        let top_offset = row * row_bytes;
        let bottom_offset = (height - 1 - row) * row_bytes;
        scratch.copy_from_slice(&pixels[top_offset..top_offset + row_bytes]);
        pixels.copy_within(bottom_offset..bottom_offset + row_bytes, top_offset);
        pixels[bottom_offset..bottom_offset + row_bytes].copy_from_slice(&scratch);
    }
}

fn read_pixel(pixels: &[u8], pixel_index: usize) -> [u8; 4] {
    let offset = pixel_index * 4;
    [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        pixels[offset + 3],
    ]
}

fn write_pixel(pixels: &mut [u8], pixel_index: usize, value: [u8; 4]) {
    let offset = pixel_index * 4;
    pixels[offset] = value[0];
    pixels[offset + 1] = value[1];
    pixels[offset + 2] = value[2];
    pixels[offset + 3] = value[3];
}
