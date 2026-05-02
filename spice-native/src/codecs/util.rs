/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use super::LzImageType;

pub(super) fn read_be_u32_at(input: &[u8], offset: usize) -> Option<u32> {
    let end = offset.checked_add(4)?;
    let bytes = input.get(offset..end)?;
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

#[derive(Clone, Copy)]
pub(super) struct LzImageHeader {
    pub(super) body_offset: usize,
    pub(super) image_type: u8,
    pub(super) width: usize,
    pub(super) height: usize,
    pub(super) stride: usize,
    pub(super) top_down: bool,
}

pub(super) fn parse_lz_image_header(input: &[u8]) -> Option<LzImageHeader> {
    const LZ_MAGIC: u32 = 0x2020_5a4c;
    const LZ_VERSION: u32 = 0x0001_0001;

    for offset in [0usize, 4usize] {
        if input.len() < offset + 28 {
            continue;
        }
        if read_be_u32_at(input, offset)? != LZ_MAGIC {
            continue;
        }
        if read_be_u32_at(input, offset + 4)? != LZ_VERSION {
            continue;
        }

        let image_type = read_be_u32_at(input, offset + 8)? as u8;
        let width = read_be_u32_at(input, offset + 12)? as usize;
        let height = read_be_u32_at(input, offset + 16)? as usize;
        let stride = read_be_u32_at(input, offset + 20)? as usize;
        let top_down = read_be_u32_at(input, offset + 24)? != 0;
        return Some(LzImageHeader {
            body_offset: offset + 28,
            image_type,
            width,
            height,
            stride,
            top_down,
        });
    }

    None
}

pub(super) fn decode_lz_byte_stream(input: &[u8], expected_len: usize) -> Vec<u8> {
    let mut encoder = 0usize;
    let mut op = 0usize;
    let mut out_buf = vec![0u8; expected_len];

    while op < expected_len && encoder < input.len() {
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
                        return Vec::new();
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
                return Vec::new();
            }
            let code = input[encoder] as u32;
            encoder += 1;
            ofs += code;

            if code == 255 && (ofs - code) == (31 << 8) {
                if encoder + 1 >= input.len() {
                    return Vec::new();
                }
                ofs = (input[encoder] as u32) << 8;
                encoder += 1;
                ofs += input[encoder] as u32;
                encoder += 1;
                ofs += 8191;
            }

            len += 1;
            ofs += 1;
            if ofs as usize > ref_pos {
                return Vec::new();
            }
            ref_pos -= ofs as usize;

            for _ in 0..len {
                if op >= expected_len {
                    break;
                }
                out_buf[op] = out_buf[ref_pos];
                op += 1;
                ref_pos += 1;
            }
        } else {
            ctrl += 1;
            let count = ctrl as usize;
            if encoder + count > input.len() || op + count > expected_len {
                return Vec::new();
            }
            out_buf[op..op + count].copy_from_slice(&input[encoder..encoder + count]);
            encoder += count;
            op += count;
        }
    }

    if op == expected_len {
        out_buf
    } else {
        Vec::new()
    }
}

pub(super) fn write_palette_rgba(output: &mut [u8], offset: usize, color: u32) {
    output[offset] = ((color >> 16) & 0xff) as u8;
    output[offset + 1] = ((color >> 8) & 0xff) as u8;
    output[offset + 2] = (color & 0xff) as u8;
    output[offset + 3] = 255;
}

pub(super) fn palette_index_from_row_byte(format: u8, value: u8, pixel_in_byte: usize) -> u8 {
    match format {
        x if x == LzImageType::Plt1Le as u8 => (value >> pixel_in_byte) & 0x01,
        x if x == LzImageType::Plt1Be as u8 => (value >> (7 - pixel_in_byte)) & 0x01,
        x if x == LzImageType::Plt4Le as u8 => {
            if pixel_in_byte == 0 {
                value & 0x0f
            } else {
                value >> 4
            }
        }
        x if x == LzImageType::Plt4Be as u8 => {
            if pixel_in_byte == 0 {
                value >> 4
            } else {
                value & 0x0f
            }
        }
        _ => value,
    }
}

pub(super) fn read_bytes<'a>(
    input: &'a [u8],
    position: &mut usize,
    length: usize,
) -> Result<&'a [u8], String> {
    if input.len().saturating_sub(*position) < length {
        return Err("Truncated codec payload.".into());
    }

    let start = *position;
    *position += length;
    Ok(&input[start..start + length])
}

pub(super) fn read_u8(input: &[u8], position: &mut usize) -> Result<u8, String> {
    Ok(read_bytes(input, position, 1)?[0])
}

pub(super) fn read_be_u16(input: &[u8], position: &mut usize) -> Result<u16, String> {
    let bytes = read_bytes(input, position, 2)?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}

pub(super) fn read_be_u32(input: &[u8], position: &mut usize) -> Result<u32, String> {
    let bytes = read_bytes(input, position, 4)?;
    Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

pub(super) fn read_be_u64(input: &[u8], position: &mut usize) -> Result<u64, String> {
    let bytes = read_bytes(input, position, 8)?;
    Ok(u64::from_be_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]))
}

pub(super) fn read_be_variable(
    input: &[u8],
    position: &mut usize,
    count: usize,
) -> Result<u64, String> {
    let mut value = 0u64;
    for _ in 0..count {
        value = (value << 8) | (read_u8(input, position)? as u64);
    }
    Ok(value)
}
