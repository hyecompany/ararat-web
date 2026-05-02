/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use wasm_bindgen::prelude::*;

use super::LzImageType;

#[wasm_bindgen]
pub fn lz4_decode(input: &[u8], width: u32, height: u32) -> Vec<u8> {
    decode_lz4_image(input, width, height).unwrap_or_default()
}

fn decode_lz4_image(input: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || input.len() < 2 {
        return Err("Invalid LZ4 image header.".into());
    }

    let top_down = input[0] != 0;
    let format = input[1];
    let bytes_per_pixel = match format {
        x if x == LzImageType::Rgb16 as u8 => 2usize,
        x if x == LzImageType::Rgb24 as u8 => 3usize,
        x if x == LzImageType::Rgb32 as u8 || x == LzImageType::Rgba as u8 => 4usize,
        _ => return Err(format!("Unsupported LZ4 bitmap format {format}.")),
    };

    let width = width as usize;
    let height = height as usize;
    let stride = width
        .checked_mul(bytes_per_pixel)
        .ok_or_else(|| "LZ4 image stride overflowed.".to_string())?;
    let expected_len = stride
        .checked_mul(height)
        .ok_or_else(|| "LZ4 image size overflowed.".to_string())?;
    if expected_len == 0 {
        return Err("Invalid empty LZ4 image.".into());
    }

    let mut raw = vec![0u8; expected_len];
    let mut source = 2usize;
    let mut output_position = 0usize;
    while source < input.len() {
        if input.len().saturating_sub(source) < 4 {
            return Err("Truncated LZ4 block size.".into());
        }
        let encoded_size = u32::from_be_bytes([
            input[source],
            input[source + 1],
            input[source + 2],
            input[source + 3],
        ]) as usize;
        source += 4;
        let block_end = source
            .checked_add(encoded_size)
            .filter(|end| *end <= input.len())
            .ok_or_else(|| "Truncated LZ4 block payload.".to_string())?;
        output_position =
            decode_lz4_block_into(input, source, block_end, &mut raw, output_position)?;
        source = block_end;
    }

    if output_position != expected_len {
        return Err("LZ4 image decoded to an unexpected size.".into());
    }

    lz4_raw_to_rgba(&raw, width, height, stride, format, top_down)
}

fn decode_lz4_block_into(
    input: &[u8],
    mut source: usize,
    block_end: usize,
    output: &mut [u8],
    mut output_position: usize,
) -> Result<usize, String> {
    while source < block_end {
        let token = input[source];
        source += 1;

        let mut literal_length = (token >> 4) as usize;
        if literal_length == 15 {
            literal_length += read_lz4_extended_length(input, &mut source, block_end)?;
        }
        let literal_end = source
            .checked_add(literal_length)
            .filter(|end| *end <= block_end)
            .ok_or_else(|| "Truncated LZ4 literal run.".to_string())?;
        let output_literal_end = output_position
            .checked_add(literal_length)
            .filter(|end| *end <= output.len())
            .ok_or_else(|| "LZ4 literal run exceeded output size.".to_string())?;
        output[output_position..output_literal_end].copy_from_slice(&input[source..literal_end]);
        source = literal_end;
        output_position = output_literal_end;

        if source >= block_end {
            break;
        }

        if block_end.saturating_sub(source) < 2 {
            return Err("Truncated LZ4 match offset.".into());
        }
        let offset = (input[source] as usize) | ((input[source + 1] as usize) << 8);
        source += 2;
        if offset == 0 || offset > output_position {
            return Err("Invalid LZ4 match offset.".into());
        }

        let mut match_length = (token & 0x0f) as usize;
        if match_length == 15 {
            match_length += read_lz4_extended_length(input, &mut source, block_end)?;
        }
        match_length += 4;
        let output_match_end = output_position
            .checked_add(match_length)
            .filter(|end| *end <= output.len())
            .ok_or_else(|| "LZ4 match exceeded output size.".to_string())?;
        let mut reference = output_position - offset;
        while output_position < output_match_end {
            output[output_position] = output[reference];
            output_position += 1;
            reference += 1;
        }
    }

    Ok(output_position)
}

fn read_lz4_extended_length(
    input: &[u8],
    source: &mut usize,
    block_end: usize,
) -> Result<usize, String> {
    let mut length = 0usize;
    loop {
        if *source >= block_end {
            return Err("Truncated LZ4 extended length.".into());
        }
        let value = input[*source] as usize;
        *source += 1;
        length = length
            .checked_add(value)
            .ok_or_else(|| "LZ4 length overflowed.".to_string())?;
        if value != 255 {
            return Ok(length);
        }
    }
}

fn lz4_raw_to_rgba(
    raw: &[u8],
    width: usize,
    height: usize,
    stride: usize,
    format: u8,
    top_down: bool,
) -> Result<Vec<u8>, String> {
    let bytes_per_pixel = lz4_format_bytes_per_pixel(format)?;
    let mut output = vec![0u8; width.saturating_mul(height).saturating_mul(4)];
    for visual_row in 0..height {
        let source_row = if top_down {
            visual_row
        } else {
            height - 1 - visual_row
        };
        let row_offset = source_row
            .checked_mul(stride)
            .ok_or_else(|| "LZ4 row offset overflowed.".to_string())?;
        for column in 0..width {
            let source_offset = row_offset + column * bytes_per_pixel;
            let dest_offset = (visual_row * width + column) * 4;
            match format {
                x if x == LzImageType::Rgb16 as u8 => {
                    if source_offset + 2 > raw.len() {
                        return Err("Truncated LZ4 RGB16 pixel.".into());
                    }
                    let packed =
                        (raw[source_offset] as u16) | ((raw[source_offset + 1] as u16) << 8);
                    let red = ((packed >> 10) & 0x1f) as u8;
                    let green = ((packed >> 5) & 0x1f) as u8;
                    let blue = (packed & 0x1f) as u8;
                    output[dest_offset] = (red << 3) | (red >> 2);
                    output[dest_offset + 1] = (green << 3) | (green >> 2);
                    output[dest_offset + 2] = (blue << 3) | (blue >> 2);
                    output[dest_offset + 3] = 255;
                }
                x if x == LzImageType::Rgb24 as u8 => {
                    if source_offset + 3 > raw.len() {
                        return Err("Truncated LZ4 RGB24 pixel.".into());
                    }
                    output[dest_offset] = raw[source_offset + 2];
                    output[dest_offset + 1] = raw[source_offset + 1];
                    output[dest_offset + 2] = raw[source_offset];
                    output[dest_offset + 3] = 255;
                }
                x if x == LzImageType::Rgb32 as u8 || x == LzImageType::Rgba as u8 => {
                    if source_offset + 4 > raw.len() {
                        return Err("Truncated LZ4 RGB32/RGBA pixel.".into());
                    }
                    output[dest_offset] = raw[source_offset + 2];
                    output[dest_offset + 1] = raw[source_offset + 1];
                    output[dest_offset + 2] = raw[source_offset];
                    output[dest_offset + 3] = if format == LzImageType::Rgba as u8 {
                        raw[source_offset + 3]
                    } else {
                        255
                    };
                }
                _ => return Err(format!("Unsupported LZ4 bitmap format {format}.")),
            }
        }
    }
    Ok(output)
}

fn lz4_format_bytes_per_pixel(format: u8) -> Result<usize, String> {
    match format {
        x if x == LzImageType::Rgb16 as u8 => Ok(2),
        x if x == LzImageType::Rgb24 as u8 => Ok(3),
        x if x == LzImageType::Rgb32 as u8 || x == LzImageType::Rgba as u8 => Ok(4),
        _ => Err(format!("Unsupported LZ4 bitmap format {format}.")),
    }
}
