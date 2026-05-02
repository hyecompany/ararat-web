/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::capabilities::{
    cap_words_contain, SPICE_DISPLAY_CAP_PREF_COMPRESSION, SPICE_IMAGE_COMPRESSION_AUTO_LZ,
};

pub(super) const SPICE_MSG_SET_ACK: u16 = 3;
pub(super) const SPICE_MSG_PING: u16 = 4;
const SPICE_MSGC_MAIN_ATTACH_CHANNELS: u16 = 104;
const SPICE_MSGC_MAIN_MOUSE_MODE_REQUEST: u16 = 105;
const SPICE_MSGC_DISPLAY_INIT: u16 = 101;
const SPICE_MSGC_DISPLAY_PREFERRED_COMPRESSION: u16 = 103;
pub(super) const SPICE_MOUSE_MODE_CLIENT: u32 = 2;
const PIXMAP_CACHE_ID: u8 = 1;
const GLZ_DICTIONARY_ID: u8 = 0;
const PIXMAP_CACHE_BYTES: u64 = 128 * 1024 * 1024;
const GLZ_DICTIONARY_WINDOW_BYTES: u32 = 0;

pub(super) fn build_attach_channels_packet() -> Vec<u8> {
    crate::protocol::build_spice_mini_packet(SPICE_MSGC_MAIN_ATTACH_CHANNELS, &[])
}

pub(super) fn build_mouse_mode_request_packet(mouse_mode: u32) -> Vec<u8> {
    crate::protocol::build_spice_mini_packet(
        SPICE_MSGC_MAIN_MOUSE_MODE_REQUEST,
        &mouse_mode.to_le_bytes(),
    )
}

fn build_display_init_packet() -> Vec<u8> {
    let mut body = Vec::with_capacity(14);
    body.push(PIXMAP_CACHE_ID);
    body.extend_from_slice(&(PIXMAP_CACHE_BYTES / 4).to_le_bytes());
    body.push(GLZ_DICTIONARY_ID);
    body.extend_from_slice(&(GLZ_DICTIONARY_WINDOW_BYTES / 4).to_le_bytes());
    crate::protocol::build_spice_mini_packet(SPICE_MSGC_DISPLAY_INIT, &body)
}

pub(super) fn build_display_ready_packets(server_caps: &[u32]) -> Vec<Vec<u8>> {
    let mut packets = vec![build_display_init_packet()];
    if cap_words_contain(server_caps, SPICE_DISPLAY_CAP_PREF_COMPRESSION) {
        packets.push(build_display_preferred_compression_packet(
            SPICE_IMAGE_COMPRESSION_AUTO_LZ,
        ));
    }
    packets
}

fn build_display_preferred_compression_packet(image_compression: u8) -> Vec<u8> {
    crate::protocol::build_spice_mini_packet(
        SPICE_MSGC_DISPLAY_PREFERRED_COMPRESSION,
        &[image_compression],
    )
}
