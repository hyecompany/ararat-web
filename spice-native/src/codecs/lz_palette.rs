/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use wasm_bindgen::prelude::*;

use super::util::{decode_lz_byte_stream, palette_index_from_row_byte, write_palette_rgba};
use super::LzImageType;

#[wasm_bindgen]
pub fn lz_plt_decode(
    input: &[u8],
    width: u32,
    height: u32,
    stride: u32,
    type_val: u8,
    top_down: bool,
    palette: &[u32],
) -> Vec<u8> {
    if width == 0 || height == 0 || stride == 0 || palette.is_empty() {
        return Vec::new();
    }

    let pixels_per_byte = match type_val {
        x if x == LzImageType::Plt1Le as u8 || x == LzImageType::Plt1Be as u8 => 8usize,
        x if x == LzImageType::Plt4Le as u8 || x == LzImageType::Plt4Be as u8 => 2usize,
        x if x == LzImageType::Plt8 as u8 => 1usize,
        _ => return Vec::new(),
    };

    let width = width as usize;
    let height = height as usize;
    let stride = stride as usize;
    let expected_len = stride.saturating_mul(height);
    if expected_len == 0 {
        return Vec::new();
    }

    let decoded = decode_lz_byte_stream(input, expected_len);
    if decoded.is_empty() {
        return Vec::new();
    }

    let mut output = vec![0u8; width.saturating_mul(height).saturating_mul(4)];
    for visual_row in 0..height {
        let source_row = if top_down {
            visual_row
        } else {
            height - 1 - visual_row
        };
        let row_offset = source_row.saturating_mul(stride);
        if row_offset >= decoded.len() {
            return Vec::new();
        }

        for column in 0..width {
            let byte_offset = row_offset + column / pixels_per_byte;
            if byte_offset >= decoded.len() {
                return Vec::new();
            }
            let pixel_in_byte = column % pixels_per_byte;
            let palette_index =
                palette_index_from_row_byte(type_val, decoded[byte_offset], pixel_in_byte) as usize;
            let Some(color) = palette.get(palette_index).copied() else {
                return Vec::new();
            };
            write_palette_rgba(&mut output, (visual_row * width + column) * 4, color);
        }
    }

    output
}
