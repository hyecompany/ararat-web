/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use miniz_oxide::inflate::decompress_to_vec_zlib;

use super::glz::decode_glz_image;
use super::*;

fn literal_lz4_block(bytes: &[u8]) -> Vec<u8> {
    let mut block = Vec::new();
    if bytes.len() < 15 {
        block.push((bytes.len() as u8) << 4);
    } else {
        block.push(0xf0);
        let mut remaining = bytes.len() - 15;
        while remaining >= 255 {
            block.push(255);
            remaining -= 255;
        }
        block.push(remaining as u8);
    }
    block.extend_from_slice(bytes);
    block
}

fn append_be_sized_block(payload: &mut Vec<u8>, block: &[u8]) {
    payload.extend_from_slice(&(block.len() as u32).to_be_bytes());
    payload.extend_from_slice(block);
}

fn lz_alpha_payload(width: u32, height: u32, top_down: bool, encoded: &[u8]) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&0x2020_5a4cu32.to_be_bytes());
    payload.extend_from_slice(&0x0001_0001u32.to_be_bytes());
    payload.extend_from_slice(&(LzImageType::Xxxa as u32).to_be_bytes());
    payload.extend_from_slice(&width.to_be_bytes());
    payload.extend_from_slice(&height.to_be_bytes());
    payload.extend_from_slice(&(width.saturating_mul(4)).to_be_bytes());
    payload.extend_from_slice(&(u32::from(top_down)).to_be_bytes());
    payload.extend_from_slice(encoded);
    payload
}

fn glz_rgb24_payload() -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(&0x2020_5a4cu32.to_be_bytes());
    payload.extend_from_slice(&0x0001_0001u32.to_be_bytes());
    payload.push((LzImageType::Rgb24 as u8) | 0x10);
    payload.extend_from_slice(&1u32.to_be_bytes());
    payload.extend_from_slice(&1u32.to_be_bytes());
    payload.extend_from_slice(&3u32.to_be_bytes());
    payload.extend_from_slice(&1u64.to_be_bytes());
    payload.extend_from_slice(&0u32.to_be_bytes());
    payload.extend_from_slice(&[0, 0, 0, 255]);
    payload
}

#[test]
fn lz4_decode_converts_top_down_rgb24_to_rgba() {
    let raw = [
        0x00, 0x00, 0xff, // red
        0x00, 0xff, 0x00, // green
        0xff, 0x00, 0x00, // blue
        0xff, 0xff, 0xff, // white
    ];
    let mut payload = vec![1, LzImageType::Rgb24 as u8];
    append_be_sized_block(&mut payload, &literal_lz4_block(&raw));

    assert_eq!(
        lz4_decode(&payload, 2, 2),
        vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,],
    );
}

#[test]
fn lz_rgb_image_decode_parses_official_header() {
    let mut payload = Vec::new();
    payload.extend_from_slice(&4u32.to_be_bytes());
    payload.extend_from_slice(&0x2020_5a4cu32.to_be_bytes());
    payload.extend_from_slice(&0x0001_0001u32.to_be_bytes());
    payload.extend_from_slice(&(LzImageType::Rgb24 as u32).to_be_bytes());
    payload.extend_from_slice(&1u32.to_be_bytes());
    payload.extend_from_slice(&1u32.to_be_bytes());
    payload.extend_from_slice(&3u32.to_be_bytes());
    payload.extend_from_slice(&1u32.to_be_bytes());
    payload.extend_from_slice(&[0, 1, 2, 3]);

    assert_eq!(lz_rgb_image_decode(&payload, 1, 1), vec![3, 2, 1, 255]);
}

#[test]
fn lz4_decode_flips_bottom_up_rgb24_rows() {
    let raw = [
        0xff, 0x00, 0x00, // bottom row blue
        0xff, 0xff, 0xff, // bottom row white
        0x00, 0x00, 0xff, // top row red
        0x00, 0xff, 0x00, // top row green
    ];
    let mut payload = vec![0, LzImageType::Rgb24 as u8];
    append_be_sized_block(&mut payload, &literal_lz4_block(&raw));

    assert_eq!(
        lz4_decode(&payload, 2, 2),
        vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,],
    );
}

#[test]
fn lz4_decode_uses_previous_blocks_as_streaming_dictionary() {
    let first = literal_lz4_block(&[
        0x00, 0x00, 0xff, // red
        0x00, 0xff, 0x00, // green
    ]);
    let second = [0x02, 0x06, 0x00]; // match length 6, offset 6
    let mut payload = vec![1, LzImageType::Rgb24 as u8];
    append_be_sized_block(&mut payload, &first);
    append_be_sized_block(&mut payload, &second);

    assert_eq!(
        lz4_decode(&payload, 4, 1),
        vec![255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255,],
    );
}

#[test]
fn bitmap_plt_decode_expands_indexed_rows() {
    let palette = [0x00ff0000, 0x0000ff00, 0x000000ff, 0x00ffffff];
    let input = [0x10, 0x32];

    assert_eq!(
        bitmap_plt_decode(&input, 4, 1, 2, LzImageType::Plt4Be as u8, 4, &palette),
        vec![0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 255, 255,],
    );
}

#[test]
fn bitmap_plt_decode_expands_a8_rows() {
    assert_eq!(
        bitmap_plt_decode(&[0x20, 0x80], 2, 1, 2, LzImageType::Xxxa as u8, 4, &[]),
        vec![255, 255, 255, 0x20, 255, 255, 255, 0x80],
    );
}

#[test]
fn lz_alpha_mask_decode_expands_jpeg_alpha_xxxa_payload() {
    let payload = lz_alpha_payload(3, 1, true, &[0x02, 0x10, 0x80, 0xff]);

    assert_eq!(lz_alpha_mask_decode(&payload, 3, 1), vec![0x10, 0x80, 0xff]);
}

#[test]
fn apply_lz_alpha_mask_rgba_flips_bottom_up_alpha_rows() {
    let payload = lz_alpha_payload(2, 2, false, &[0x03, 0x10, 0x20, 0x30, 0x40]);
    let pixels = vec![1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255];

    assert_eq!(
        apply_lz_alpha_mask_rgba(&pixels, &payload, 2, 2),
        vec![1, 2, 3, 0x30, 4, 5, 6, 0x40, 7, 8, 9, 0x10, 10, 11, 12, 0x20,],
    );
}

#[test]
fn glz_rgb_decode_accepts_official_magic_and_direct_pixels() {
    let decoded = decode_glz_image(&glz_rgb24_payload(), &[]).expect("glz decode");

    assert_eq!(decoded.image_id, "1");
    assert_eq!(decoded.pixels, vec![255, 0, 0, 255]);
}

#[test]
fn zlib_glz_rgb_decode_inflates_direct_pixels() {
    let compressed = [
        120, 156, 83, 80, 136, 242, 97, 96, 100, 96, 20, 103, 96, 96, 96, 132, 98, 102, 6, 8, 96,
        132, 210, 255, 1, 35, 237, 2, 5,
    ];
    let inflated = decompress_to_vec_zlib(&compressed).expect("inflate glz");
    let decoded = decode_glz_image(&inflated, &[]).expect("zlib glz decode");

    assert_eq!(decoded.image_id, "1");
    assert_eq!(decoded.pixels, vec![255, 0, 0, 255]);
}
