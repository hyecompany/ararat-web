/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use wasm_bindgen::prelude::*;

use super::util::{palette_index_from_row_byte, write_palette_rgba};
use super::LzImageType;

#[wasm_bindgen]
pub fn bitmap_decode(
    input: &[u8],
    width: u32,
    height: u32,
    stride: u32,
    format: u8,
    flags: u8,
) -> Vec<u8> {
    if width == 0 || height == 0 || stride == 0 {
        return Vec::new();
    }

    let bytes_per_pixel = match format {
        x if x == LzImageType::Rgb16 as u8 => 2usize,
        x if x == LzImageType::Rgb24 as u8 => 3usize,
        x if x == LzImageType::Rgb32 as u8 || x == LzImageType::Rgba as u8 => 4usize,
        _ => return Vec::new(),
    };

    let stride = stride as usize;
    let width = width as usize;
    let height = height as usize;
    let rows = usize::min(height, input.len() / stride);
    if rows == 0 {
        return Vec::new();
    }

    let top_down = (flags & 4) != 0 || format == LzImageType::Rgba as u8;
    let mut out = vec![0u8; width * rows * 4];

    for row in 0..rows {
        let src_row = if top_down { row } else { rows - 1 - row } * stride;
        for column in 0..width {
            let src_offset = src_row + column * bytes_per_pixel;
            if src_offset + bytes_per_pixel > input.len() {
                break;
            }

            let dest_offset = (row * width + column) * 4;
            if bytes_per_pixel == 2 {
                let pixel = (input[src_offset] as u16) | ((input[src_offset + 1] as u16) << 8);
                let red = ((pixel >> 10) & 0x1f) as u8;
                let green = ((pixel >> 5) & 0x1f) as u8;
                let blue = (pixel & 0x1f) as u8;
                out[dest_offset] = (red << 3) | (red >> 2);
                out[dest_offset + 1] = (green << 3) | (green >> 2);
                out[dest_offset + 2] = (blue << 3) | (blue >> 2);
                out[dest_offset + 3] = 255;
            } else {
                out[dest_offset] = input[src_offset + 2];
                out[dest_offset + 1] = input[src_offset + 1];
                out[dest_offset + 2] = input[src_offset];
                out[dest_offset + 3] = if bytes_per_pixel == 4 && format == LzImageType::Rgba as u8
                {
                    input[src_offset + 3]
                } else {
                    255
                };
            }
        }
    }

    out
}

#[wasm_bindgen]
pub fn bitmap_plt_decode(
    input: &[u8],
    width: u32,
    height: u32,
    stride: u32,
    format: u8,
    flags: u8,
    palette: &[u32],
) -> Vec<u8> {
    if width == 0 || height == 0 || stride == 0 {
        return Vec::new();
    }

    let pixels_per_byte = match format {
        x if x == LzImageType::Plt1Le as u8 || x == LzImageType::Plt1Be as u8 => 8usize,
        x if x == LzImageType::Plt4Le as u8 || x == LzImageType::Plt4Be as u8 => 2usize,
        x if x == LzImageType::Plt8 as u8 => 1usize,
        x if x == LzImageType::Xxxa as u8 => 1usize,
        _ => return Vec::new(),
    };

    if format != LzImageType::Xxxa as u8 && palette.is_empty() {
        return Vec::new();
    }

    let stride = stride as usize;
    let width = width as usize;
    let height = height as usize;
    let rows = usize::min(height, input.len() / stride);
    if rows == 0 {
        return Vec::new();
    }

    let top_down = (flags & 4) != 0;
    let mut out = vec![0u8; width.saturating_mul(rows).saturating_mul(4)];
    for visual_row in 0..rows {
        let source_row = if top_down {
            visual_row
        } else {
            rows - 1 - visual_row
        };
        let row_offset = source_row.saturating_mul(stride);
        for column in 0..width {
            let byte_offset = row_offset + column / pixels_per_byte;
            if byte_offset >= input.len() {
                return Vec::new();
            }
            let dest_offset = (visual_row * width + column) * 4;
            if format == LzImageType::Xxxa as u8 {
                out[dest_offset] = 255;
                out[dest_offset + 1] = 255;
                out[dest_offset + 2] = 255;
                out[dest_offset + 3] = input[byte_offset];
                continue;
            }

            let palette_index =
                palette_index_from_row_byte(format, input[byte_offset], column % pixels_per_byte)
                    as usize;
            let Some(color) = palette.get(palette_index).copied() else {
                return Vec::new();
            };
            write_palette_rgba(&mut out, dest_offset, color);
        }
    }

    out
}
