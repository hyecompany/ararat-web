/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use wasm_bindgen::prelude::*;

use super::util::{decode_lz_byte_stream, parse_lz_image_header};
use super::LzImageType;

fn decode_lz_alpha_mask_pass(input: &[u8], output: &mut [u8]) -> bool {
    let expected_pixels = output.len();
    let mut encoder = 0usize;
    let mut op = 0usize;

    while op < expected_pixels && encoder < input.len() {
        let mut ctrl = input[encoder] as u32;
        encoder += 1;

        let mut ref_pos = op;
        let mut len = ctrl >> 5;
        let mut ofs = (ctrl & 31) << 8;

        if ctrl >= 32 {
            len -= 1;
            if len == 6 {
                loop {
                    if encoder >= input.len() {
                        return false;
                    }
                    let code = input[encoder] as u32;
                    encoder += 1;
                    len += code;
                    if code != 255 {
                        break;
                    }
                }
            }

            if encoder >= input.len() {
                return false;
            }
            let code = input[encoder] as u32;
            encoder += 1;
            ofs += code;

            if code == 255 && (ofs - code) == (31 << 8) {
                if encoder + 1 >= input.len() {
                    return false;
                }
                ofs = (input[encoder] as u32) << 8;
                encoder += 1;
                ofs += input[encoder] as u32;
                encoder += 1;
                ofs += 8191;
            }

            len += 3;
            ofs += 1;
            if ofs as usize > ref_pos {
                return false;
            }
            ref_pos -= ofs as usize;

            for _ in 0..len {
                if op >= expected_pixels {
                    break;
                }
                if ref_pos >= output.len() {
                    return false;
                }
                output[op] = output[ref_pos];
                op += 1;
                ref_pos += 1;
            }
        } else {
            ctrl += 1;
            let count = ctrl as usize;
            if encoder + count > input.len() || op + count > expected_pixels {
                return false;
            }
            output[op..op + count].copy_from_slice(&input[encoder..encoder + count]);
            encoder += count;
            op += count;
        }
    }

    op == expected_pixels
}

fn flip_alpha_rows(alpha: &mut [u8], width: usize, height: usize) {
    if width == 0 || height <= 1 {
        return;
    }

    for top in 0..(height / 2) {
        let bottom = height - 1 - top;
        for column in 0..width {
            alpha.swap(top * width + column, bottom * width + column);
        }
    }
}

fn decode_lz_alpha_mask_internal(input: &[u8], width: u32, height: u32) -> Vec<u8> {
    let Some(header) = parse_lz_image_header(input) else {
        return Vec::new();
    };
    let expected_width = width as usize;
    let expected_height = height as usize;
    if expected_width == 0
        || expected_height == 0
        || header.width != expected_width
        || header.height != expected_height
    {
        return Vec::new();
    }

    let expected_pixels = expected_width.saturating_mul(expected_height);
    let body = &input[header.body_offset..];

    let mut alpha = if header.image_type == LzImageType::Xxxa as u8 {
        let mut decoded = vec![0u8; expected_pixels];
        if !decode_lz_alpha_mask_pass(body, &mut decoded) {
            return Vec::new();
        }
        decoded
    } else if header.image_type == LzImageType::A8 as u8 {
        if header.stride == 0 {
            return Vec::new();
        }
        let decoded = decode_lz_byte_stream(body, header.stride.saturating_mul(header.height));
        if decoded.is_empty() {
            return Vec::new();
        }
        let mut unpacked = vec![0u8; expected_pixels];
        for row in 0..expected_height {
            let source_offset = row.saturating_mul(header.stride);
            let source_end = source_offset.saturating_add(expected_width);
            let dest_offset = row.saturating_mul(expected_width);
            if source_end > decoded.len() {
                return Vec::new();
            }
            unpacked[dest_offset..dest_offset + expected_width]
                .copy_from_slice(&decoded[source_offset..source_end]);
        }
        unpacked
    } else {
        return Vec::new();
    };

    if !header.top_down {
        flip_alpha_rows(&mut alpha, expected_width, expected_height);
    }

    alpha
}

#[wasm_bindgen]
pub fn lz_alpha_mask_decode(input: &[u8], width: u32, height: u32) -> Vec<u8> {
    decode_lz_alpha_mask_internal(input, width, height)
}

#[wasm_bindgen]
pub fn apply_lz_alpha_mask_rgba(input: &[u8], alpha_lz: &[u8], width: u32, height: u32) -> Vec<u8> {
    if input.is_empty() {
        return Vec::new();
    }

    let alpha = decode_lz_alpha_mask_internal(alpha_lz, width, height);
    if alpha.is_empty() {
        return Vec::new();
    }

    let mut out = input.to_vec();
    let alpha_len = usize::min(alpha.len(), out.len() / 4);
    for index in 0..alpha_len {
        out[index * 4 + 3] = alpha[index];
    }
    out
}
