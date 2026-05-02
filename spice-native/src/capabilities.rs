/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::wire;

pub const SPICE_COMMON_CAP_PROTOCOL_AUTH_SELECTION: u32 = 0;
pub const SPICE_COMMON_CAP_AUTH_SPICE: u32 = 1;
pub const SPICE_COMMON_CAP_MINI_HEADER: u32 = 3;

pub const SPICE_DISPLAY_CAP_SIZED_STREAM: u32 = 0;
pub const SPICE_DISPLAY_CAP_MONITORS_CONFIG: u32 = 1;
pub const SPICE_DISPLAY_CAP_LZ4_COMPRESSION: u32 = 5;
pub const SPICE_DISPLAY_CAP_PREF_COMPRESSION: u32 = 6;
pub const SPICE_DISPLAY_CAP_MULTI_CODEC: u32 = 8;
pub const SPICE_DISPLAY_CAP_CODEC_MJPEG: u32 = 9;

pub const SPICE_IMAGE_COMPRESSION_AUTO_LZ: u8 = 3;

pub fn client_common_caps() -> Vec<u32> {
    cap_words(&[
        SPICE_COMMON_CAP_PROTOCOL_AUTH_SELECTION,
        SPICE_COMMON_CAP_MINI_HEADER,
    ])
}

pub fn client_channel_caps(channel_type: u8) -> Vec<u32> {
    match channel_type {
        wire::SPICE_CHANNEL_DISPLAY => cap_words(&[
            SPICE_DISPLAY_CAP_SIZED_STREAM,
            SPICE_DISPLAY_CAP_MONITORS_CONFIG,
            SPICE_DISPLAY_CAP_LZ4_COMPRESSION,
            SPICE_DISPLAY_CAP_MULTI_CODEC,
            SPICE_DISPLAY_CAP_CODEC_MJPEG,
        ]),
        _ => Vec::new(),
    }
}

pub fn cap_words(caps: &[u32]) -> Vec<u32> {
    let Some(max_cap) = caps.iter().max().copied() else {
        return Vec::new();
    };
    let mut words = vec![0u32; (max_cap as usize / 32) + 1];
    for cap in caps {
        words[*cap as usize / 32] |= 1u32 << (*cap % 32);
    }
    words
}

pub fn cap_words_contain(words: &[u32], cap: u32) -> bool {
    words
        .get(cap as usize / 32)
        .map(|word| (word & (1u32 << (cap % 32))) != 0)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPICE_DISPLAY_CAP_STREAM_REPORT: u32 = 4;
    const SPICE_DISPLAY_CAP_CODEC_VP8: u32 = 10;
    const SPICE_DISPLAY_CAP_CODEC_H264: u32 = 11;
    const SPICE_DISPLAY_CAP_PREF_VIDEO_CODEC_TYPE: u32 = 12;

    #[test]
    fn display_caps_advertise_truthful_mjpeg_stream_surface() {
        let caps = client_channel_caps(wire::SPICE_CHANNEL_DISPLAY);

        assert!(cap_words_contain(&caps, SPICE_DISPLAY_CAP_SIZED_STREAM));
        assert!(cap_words_contain(&caps, SPICE_DISPLAY_CAP_MONITORS_CONFIG));
        assert!(cap_words_contain(&caps, SPICE_DISPLAY_CAP_LZ4_COMPRESSION));
        assert!(cap_words_contain(&caps, SPICE_DISPLAY_CAP_MULTI_CODEC));
        assert!(cap_words_contain(&caps, SPICE_DISPLAY_CAP_CODEC_MJPEG));
        assert!(!cap_words_contain(&caps, SPICE_DISPLAY_CAP_CODEC_VP8));
        assert!(!cap_words_contain(&caps, SPICE_DISPLAY_CAP_CODEC_H264));
        assert!(!cap_words_contain(&caps, SPICE_DISPLAY_CAP_STREAM_REPORT));
        assert!(!cap_words_contain(
            &caps,
            SPICE_DISPLAY_CAP_PREF_VIDEO_CODEC_TYPE
        ));
    }

    #[test]
    fn cap_words_span_multiple_u32_words() {
        let caps = cap_words(&[0, 31, 32, 37]);

        assert_eq!(caps.len(), 2);
        assert!(cap_words_contain(&caps, 0));
        assert!(cap_words_contain(&caps, 31));
        assert!(cap_words_contain(&caps, 32));
        assert!(cap_words_contain(&caps, 37));
        assert!(!cap_words_contain(&caps, 36));
    }
}
