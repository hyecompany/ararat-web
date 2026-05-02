/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::capabilities::{
    SPICE_COMMON_CAP_AUTH_SPICE, SPICE_COMMON_CAP_MINI_HEADER,
    SPICE_COMMON_CAP_PROTOCOL_AUTH_SELECTION,
};

const SPICE_MAGIC: u32 = 0x5144_4552;
const SPICE_VERSION_MAJOR: u32 = 2;
const SPICE_VERSION_MINOR: u32 = 2;
const SPICE_TICKET_PUBKEY_BYTES: usize = 162;
pub(super) const SPICE_LINK_AUTH_SPICE: u32 = 1;

pub(super) struct LinkReply {
    pub(super) error: u32,
    pub(super) public_key: Vec<u8>,
    pub(super) channel_caps: Vec<u32>,
    pub(super) bytes_consumed: usize,
    pub(super) supports_auth_selection: bool,
    pub(super) supports_spice_auth: bool,
}

pub(super) fn build_link_message(
    channel_type: u8,
    channel_id: u8,
    connection_id: u32,
    common_caps: &[u32],
    channel_caps: &[u32],
) -> Vec<u8> {
    let common_caps = if common_caps.is_empty() {
        vec![
            (1u32 << SPICE_COMMON_CAP_PROTOCOL_AUTH_SELECTION)
                | (1u32 << SPICE_COMMON_CAP_MINI_HEADER),
        ]
    } else {
        common_caps.to_vec()
    };
    let body_size = 18 + (common_caps.len() + channel_caps.len()) * 4;
    let mut out = Vec::with_capacity(16 + body_size);
    out.extend_from_slice(&SPICE_MAGIC.to_le_bytes());
    out.extend_from_slice(&SPICE_VERSION_MAJOR.to_le_bytes());
    out.extend_from_slice(&SPICE_VERSION_MINOR.to_le_bytes());
    out.extend_from_slice(&(body_size as u32).to_le_bytes());
    out.extend_from_slice(&connection_id.to_le_bytes());
    out.push(channel_type);
    out.push(channel_id);
    out.extend_from_slice(&(common_caps.len() as u32).to_le_bytes());
    out.extend_from_slice(&(channel_caps.len() as u32).to_le_bytes());
    out.extend_from_slice(&18u32.to_le_bytes());
    for cap in common_caps {
        out.extend_from_slice(&cap.to_le_bytes());
    }
    for cap in channel_caps {
        out.extend_from_slice(&cap.to_le_bytes());
    }
    out
}

pub(super) fn try_parse_link_reply(buffer: &[u8]) -> Option<LinkReply> {
    if buffer.len() < 16 {
        return None;
    }
    let magic = u32::from_le_bytes(buffer[0..4].try_into().ok()?);
    if magic != SPICE_MAGIC {
        return None;
    }
    let size = u32::from_le_bytes(buffer[12..16].try_into().ok()?) as usize;
    if buffer.len() < 16 + size || size < 178 {
        return None;
    }
    let reply = &buffer[16..16 + size];
    let error = u32::from_le_bytes(reply[0..4].try_into().ok()?);
    let public_key = reply[4..4 + SPICE_TICKET_PUBKEY_BYTES].to_vec();
    let caps_base = 4 + SPICE_TICKET_PUBKEY_BYTES;
    let num_common_caps =
        u32::from_le_bytes(reply[caps_base..caps_base + 4].try_into().ok()?) as usize;
    let num_channel_caps =
        u32::from_le_bytes(reply[caps_base + 4..caps_base + 8].try_into().ok()?) as usize;
    let caps_offset =
        u32::from_le_bytes(reply[caps_base + 8..caps_base + 12].try_into().ok()?) as usize;
    let caps_len = (num_common_caps + num_channel_caps).saturating_mul(4);
    if caps_offset.saturating_add(caps_len) > reply.len() {
        return None;
    }
    let mut supports_auth_selection = false;
    let mut supports_spice_auth = false;
    for index in 0..num_common_caps {
        let start = caps_offset + index * 4;
        let cap = u32::from_le_bytes(reply[start..start + 4].try_into().ok()?);
        supports_auth_selection |= (cap & (1u32 << SPICE_COMMON_CAP_PROTOCOL_AUTH_SELECTION)) != 0;
        supports_spice_auth |= (cap & (1u32 << SPICE_COMMON_CAP_AUTH_SPICE)) != 0;
    }
    Some(LinkReply {
        error,
        public_key,
        channel_caps: read_caps(reply, caps_offset + num_common_caps * 4, num_channel_caps)?,
        bytes_consumed: 16 + size,
        supports_auth_selection,
        supports_spice_auth,
    })
}

fn read_caps(buffer: &[u8], offset: usize, count: usize) -> Option<Vec<u32>> {
    let mut caps = Vec::with_capacity(count);
    for index in 0..count {
        let start = offset + index * 4;
        caps.push(u32::from_le_bytes(
            buffer[start..start + 4].try_into().ok()?,
        ));
    }
    Some(caps)
}
