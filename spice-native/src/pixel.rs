/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use wasm_bindgen::prelude::*;

pub fn cursor_to_rgba_pixels(
    cursor_type: u8,
    input: &[u8],
    width: u16,
    height: u16,
) -> Option<Vec<u8>> {
    let pixel_count = usize::from(width).saturating_mul(usize::from(height));
    if pixel_count == 0 {
        return None;
    }
    match cursor_type {
        0 => alpha_cursor_to_rgba(input, pixel_count),
        1 => Some(mono_cursor_to_rgba(
            input,
            u32::from(width),
            u32::from(height),
        )),
        4 => color16_cursor_to_rgba(input, u32::from(width), u32::from(height)),
        5 => color24_cursor_to_rgba(input, u32::from(width), u32::from(height)),
        6 => color32_cursor_to_rgba(input, u32::from(width), u32::from(height)),
        _ => None,
    }
}

#[wasm_bindgen]
pub fn apply_rop_rgba(rop_descriptor: u16, source: &[u8], dest: &[u8]) -> Vec<u8> {
    apply_draw_copy_rop_rgba(rop_descriptor, source, dest)
}

#[wasm_bindgen]
pub fn apply_draw_copy_rop_rgba(rop_descriptor: u16, source: &[u8], dest: &[u8]) -> Vec<u8> {
    let length = source.len().min(dest.len());
    if length == 0 {
        return Vec::new();
    }

    let mut source_pixels = source[..length].to_vec();
    let mut dest_pixels = dest[..length].to_vec();

    if (rop_descriptor & 1) != 0 {
        invert_rgb_in_place(&mut source_pixels);
    }
    if (rop_descriptor & 4) != 0 {
        invert_rgb_in_place(&mut dest_pixels);
    }

    let mut result = if (rop_descriptor & 8) != 0 {
        source_pixels.clone()
    } else if (rop_descriptor & 16) != 0 {
        blend_binary_op(&source_pixels, &dest_pixels, |src, dst| src | dst)
    } else if (rop_descriptor & 32) != 0 {
        blend_binary_op(&source_pixels, &dest_pixels, |src, dst| src & dst)
    } else if (rop_descriptor & 64) != 0 {
        blend_binary_op(&source_pixels, &dest_pixels, |src, dst| src ^ dst)
    } else if (rop_descriptor & 128) != 0 {
        fill_rgba(length, 0)
    } else if (rop_descriptor & 256) != 0 {
        fill_rgba(length, 255)
    } else if (rop_descriptor & 512) != 0 {
        let mut inverted = dest_pixels.clone();
        invert_rgb_in_place(&mut inverted);
        inverted
    } else {
        source_pixels.clone()
    };

    if (rop_descriptor & 1024) != 0 {
        invert_rgb_in_place(&mut result);
    }

    ensure_alpha(&mut result);
    result
}

fn alpha_cursor_to_rgba(input: &[u8], pixel_count: usize) -> Option<Vec<u8>> {
    let byte_count = pixel_count.checked_mul(4)?;
    if input.len() < byte_count {
        return None;
    }
    let mut out = vec![0u8; byte_count];
    for index in 0..pixel_count {
        let src = index * 4;
        out[src] = input[src + 2];
        out[src + 1] = input[src + 1];
        out[src + 2] = input[src];
        out[src + 3] = input[src + 3];
    }
    Some(out)
}

#[wasm_bindgen]
pub fn mono_cursor_to_rgba(input: &[u8], width: u32, height: u32) -> Vec<u8> {
    let width = width as usize;
    let height = height as usize;
    let stride = mask_stride(width);
    let plane_len = stride.saturating_mul(height);
    if width == 0 || height == 0 || input.len() < plane_len.saturating_mul(2) {
        return Vec::new();
    }

    let and_mask = &input[..plane_len];
    let xor_mask = &input[plane_len..plane_len * 2];
    let mut out = vec![0u8; width.saturating_mul(height).saturating_mul(4)];

    for y in 0..height {
        for x in 0..width {
            let index = y * width + x;
            let offset = index * 4;
            let and = mask_bit(and_mask, stride, x, y);
            let xor = mask_bit(xor_mask, stride, x, y);
            match (and, xor) {
                (0, 0) => {
                    out[offset] = 0;
                    out[offset + 1] = 0;
                    out[offset + 2] = 0;
                    out[offset + 3] = 255;
                }
                (0, 1) => {
                    out[offset] = 255;
                    out[offset + 1] = 255;
                    out[offset + 2] = 255;
                    out[offset + 3] = 255;
                }
                (1, 0) => {
                    out[offset] = 0;
                    out[offset + 1] = 0;
                    out[offset + 2] = 0;
                    out[offset + 3] = 0;
                }
                _ => {
                    out[offset] = 255;
                    out[offset + 1] = 255;
                    out[offset + 2] = 255;
                    out[offset + 3] = 255;
                }
            }
        }
    }

    out
}

fn color16_cursor_to_rgba(input: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let width = width as usize;
    let height = height as usize;
    let pixel_count = width.checked_mul(height)?;
    let color_len = pixel_count.checked_mul(2)?;
    if input.len() < color_len {
        return None;
    }
    let mask = input.get(color_len..);
    let mut out = vec![0u8; pixel_count.checked_mul(4)?];
    for index in 0..pixel_count {
        let src = index * 2;
        let packed = u16::from_le_bytes([input[src], input[src + 1]]);
        let red5 = (packed >> 10) & 0x1f;
        let green5 = (packed >> 5) & 0x1f;
        let blue5 = packed & 0x1f;
        let dest = index * 4;
        out[dest] = ((red5 << 3) | (red5 >> 2)) as u8;
        out[dest + 1] = ((green5 << 3) | (green5 >> 2)) as u8;
        out[dest + 2] = ((blue5 << 3) | (blue5 >> 2)) as u8;
        out[dest + 3] = cursor_alpha_from_mask(mask, width, index);
    }
    Some(out)
}

fn color24_cursor_to_rgba(input: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let width = width as usize;
    let height = height as usize;
    let pixel_count = width.checked_mul(height)?;
    let color_len = pixel_count.checked_mul(3)?;
    if input.len() < color_len {
        return None;
    }
    let mask = input.get(color_len..);
    let mut out = vec![0u8; pixel_count.checked_mul(4)?];
    for index in 0..pixel_count {
        let src = index * 3;
        let dest = index * 4;
        out[dest] = input[src];
        out[dest + 1] = input[src + 1];
        out[dest + 2] = input[src + 2];
        out[dest + 3] = cursor_alpha_from_mask(mask, width, index);
    }
    Some(out)
}

fn color32_cursor_to_rgba(input: &[u8], width: u32, height: u32) -> Option<Vec<u8>> {
    let width = width as usize;
    let height = height as usize;
    let pixel_count = width.checked_mul(height)?;
    let color_len = pixel_count.checked_mul(4)?;
    if input.len() < color_len {
        return None;
    }
    let mask = input.get(color_len..);
    let mut out = vec![0u8; pixel_count.checked_mul(4)?];
    for index in 0..pixel_count {
        let src = index * 4;
        out[src] = input[src + 2];
        out[src + 1] = input[src + 1];
        out[src + 2] = input[src];
        out[src + 3] = cursor_alpha_from_mask(mask, width, index);
    }
    Some(out)
}

fn cursor_alpha_from_mask(mask: Option<&[u8]>, width: usize, index: usize) -> u8 {
    let Some(mask) = mask else {
        return 255;
    };
    let stride = mask_stride(width);
    let x = index % width;
    let y = index / width;
    if mask.len() < stride.saturating_mul(y + 1) {
        return 255;
    }
    if mask_bit(mask, stride, x, y) != 0 {
        0
    } else {
        255
    }
}

fn mask_stride(width: usize) -> usize {
    width.saturating_add(7) / 8
}

fn mask_bit(input: &[u8], stride: usize, x: usize, y: usize) -> u8 {
    let offset = y.saturating_mul(stride).saturating_add(x / 8);
    input
        .get(offset)
        .map(|byte| {
            if (byte & (0x80 >> (x % 8))) != 0 {
                1
            } else {
                0
            }
        })
        .unwrap_or(0)
}

#[wasm_bindgen]
pub fn apply_alpha_mask_rgba(input: &[u8], alpha_mask: &[u8]) -> Vec<u8> {
    if input.is_empty() {
        return Vec::new();
    }

    let mut out = input.to_vec();
    let alpha_len = usize::min(alpha_mask.len(), out.len() / 4);
    for index in 0..alpha_len {
        out[index * 4 + 3] = alpha_mask[index];
    }

    out
}

fn invert_rgb_in_place(pixels: &mut [u8]) {
    let mut index = 0;
    while index + 3 < pixels.len() {
        pixels[index] = 255 - pixels[index];
        pixels[index + 1] = 255 - pixels[index + 1];
        pixels[index + 2] = 255 - pixels[index + 2];
        index += 4;
    }
}

fn ensure_alpha(pixels: &mut [u8]) {
    let mut index = 0;
    while index + 3 < pixels.len() {
        pixels[index + 3] = 255;
        index += 4;
    }
}

fn fill_rgba(length: usize, value: u8) -> Vec<u8> {
    let mut out = vec![0u8; length];
    let mut index = 0;
    while index + 3 < out.len() {
        out[index] = value;
        out[index + 1] = value;
        out[index + 2] = value;
        out[index + 3] = 255;
        index += 4;
    }
    out
}

fn blend_binary_op<F>(source: &[u8], dest: &[u8], op: F) -> Vec<u8>
where
    F: Fn(u8, u8) -> u8,
{
    let length = source.len().min(dest.len());
    let mut out = vec![0u8; length];
    let mut index = 0;
    while index + 3 < length {
        out[index] = op(source[index], dest[index]);
        out[index + 1] = op(source[index + 1], dest[index + 1]);
        out[index + 2] = op(source[index + 2], dest[index + 2]);
        out[index + 3] = 255;
        index += 4;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{apply_draw_copy_rop_rgba, cursor_to_rgba_pixels, mono_cursor_to_rgba};

    #[test]
    fn draw_copy_rop_put_copies_source() {
        assert_eq!(
            apply_draw_copy_rop_rgba(8, &[10, 20, 30, 255], &[90, 80, 70, 255]),
            vec![10, 20, 30, 255],
        );
    }

    #[test]
    fn draw_copy_rop_ignores_brush_inversion_for_source_input() {
        assert_eq!(
            apply_draw_copy_rop_rgba(8 | 2, &[10, 20, 30, 255], &[90, 80, 70, 255]),
            vec![10, 20, 30, 255],
        );
    }

    #[test]
    fn draw_copy_rop_applies_source_and_dest_ops() {
        assert_eq!(
            apply_draw_copy_rop_rgba(16, &[0x0f, 0x33, 0xf0, 255], &[0xf0, 0x55, 0x0f, 255]),
            vec![0xff, 0x77, 0xff, 255],
        );
        assert_eq!(
            apply_draw_copy_rop_rgba(64, &[0x0f, 0x33, 0xf0, 255], &[0xf0, 0x55, 0x0f, 255]),
            vec![0xff, 0x66, 0xff, 255],
        );
    }

    #[test]
    fn mono_cursor_uses_and_plane_then_xor_plane() {
        let rgba = mono_cursor_to_rgba(&[0b0010_0000, 0b0101_0000], 4, 1);
        assert_eq!(
            rgba,
            vec![
                0, 0, 0, 255, // and 0 xor 0 -> black
                255, 255, 255, 255, // and 0 xor 1 -> white
                0, 0, 0, 0, // and 1 xor 0 -> transparent
                255, 255, 255, 255, // and 1 xor 1 -> white fallback for invert
            ],
        );
    }

    #[test]
    fn color32_cursor_applies_bitmap_mask() {
        let rgba = cursor_to_rgba_pixels(
            6,
            &[
                3,
                2,
                1,
                0,
                6,
                5,
                4,
                0,
                9,
                8,
                7,
                0,
                12,
                11,
                10,
                0,
                0b0100_0000,
            ],
            4,
            1,
        )
        .expect("cursor");
        assert_eq!(
            rgba,
            vec![1, 2, 3, 255, 4, 5, 6, 0, 7, 8, 9, 255, 10, 11, 12, 255,],
        );
    }
}
