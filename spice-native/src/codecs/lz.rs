/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use wasm_bindgen::prelude::*;

use super::util::parse_lz_image_header;
use super::LzImageType;

#[wasm_bindgen]
pub fn lz_rgb_decode(
    input: &[u8],
    width: u32,
    height: u32,
    stride: u32,
    type_val: u8,
    opaque: bool,
    top_down: bool,
) -> Vec<u8> {
    if width == 0 || height == 0 {
        return Vec::new();
    }

    let width = width as usize;
    let height = height as usize;
    let _declared_stride = stride;
    let expected_pixels = width.saturating_mul(height);
    let mut output = vec![0u8; expected_pixels.saturating_mul(4)];

    match type_val {
        x if x == LzImageType::Rgb24 as u8 || x == LzImageType::Rgb32 as u8 => {
            if decode_lz_rgb32_pass(input, 0, &mut output, expected_pixels, false, opaque).is_none()
            {
                return Vec::new();
            }
        }
        x if x == LzImageType::Rgba as u8 => {
            let Some(alpha_start) =
                decode_lz_rgb32_pass(input, 0, &mut output, expected_pixels, false, false)
            else {
                return Vec::new();
            };
            if decode_lz_rgb32_pass(
                input,
                alpha_start,
                &mut output,
                expected_pixels,
                true,
                false,
            )
            .is_none()
            {
                return Vec::new();
            }
        }
        x if x == LzImageType::Xxxa as u8 => {
            if decode_lz_rgb32_pass(input, 0, &mut output, expected_pixels, true, false).is_none() {
                return Vec::new();
            }
        }
        _ => return Vec::new(),
    }

    if top_down || height <= 1 {
        return output;
    }

    let row_bytes = width.saturating_mul(4);
    let mut flipped = vec![0u8; output.len()];
    for visual_row in 0..height {
        let source = visual_row.saturating_mul(row_bytes);
        let dest = (height - 1 - visual_row).saturating_mul(row_bytes);
        flipped[dest..dest + row_bytes].copy_from_slice(&output[source..source + row_bytes]);
    }

    flipped
}

#[wasm_bindgen]
pub fn lz_rgb_image_decode(input: &[u8], expected_width: u32, expected_height: u32) -> Vec<u8> {
    let Some(header) = parse_lz_image_header(input) else {
        return Vec::new();
    };
    if expected_width != 0
        && expected_height != 0
        && (header.width != expected_width as usize || header.height != expected_height as usize)
    {
        return Vec::new();
    }
    let body = &input[header.body_offset..];
    lz_rgb_decode(
        body,
        header.width as u32,
        header.height as u32,
        header.stride as u32,
        header.image_type,
        header.image_type != LzImageType::Rgba as u8,
        header.top_down,
    )
}

fn decode_lz_rgb32_pass(
    input: &[u8],
    start: usize,
    output: &mut [u8],
    expected_pixels: usize,
    alpha_only: bool,
    default_alpha: bool,
) -> Option<usize> {
    let mut encoder = start;
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
                        return None;
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
                return None;
            }
            let code = input[encoder] as u32;
            encoder += 1;
            ofs += code;

            if code == 255 && (ofs - code) == (31 << 8) {
                if encoder + 1 >= input.len() {
                    return None;
                }
                ofs = (input[encoder] as u32) << 8;
                encoder += 1;
                ofs += input[encoder] as u32;
                encoder += 1;
                ofs += 8191;
            }

            len += 1;
            if alpha_only {
                len += 2;
            }
            ofs += 1;
            if ofs as usize > ref_pos {
                return None;
            }
            ref_pos -= ofs as usize;

            for _ in 0..len {
                if op >= expected_pixels {
                    break;
                }
                let dest = op.saturating_mul(4);
                let source = ref_pos.saturating_mul(4);
                if source + 4 > output.len() || dest + 4 > output.len() {
                    return None;
                }
                if alpha_only {
                    output[dest + 3] = output[source + 3];
                } else {
                    output.copy_within(source..source + 4, dest);
                }
                op += 1;
                ref_pos += 1;
            }
        } else {
            ctrl += 1;
            let count = ctrl as usize;
            for _ in 0..count {
                if op >= expected_pixels {
                    break;
                }
                let dest = op.saturating_mul(4);
                if dest + 4 > output.len() {
                    return None;
                }
                if alpha_only {
                    if encoder >= input.len() {
                        return None;
                    }
                    output[dest + 3] = input[encoder];
                    encoder += 1;
                } else {
                    if encoder + 3 > input.len() {
                        return None;
                    }
                    output[dest] = input[encoder + 2];
                    output[dest + 1] = input[encoder + 1];
                    output[dest + 2] = input[encoder];
                    if default_alpha {
                        output[dest + 3] = 255;
                    }
                    encoder += 3;
                }
                op += 1;
            }
        }
    }

    if op == expected_pixels {
        Some(encoder)
    } else {
        None
    }
}
