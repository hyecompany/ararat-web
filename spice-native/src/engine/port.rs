/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::{Deserialize, Serialize};

use crate::protocol::build_spice_mini_packet;
use crate::wire;

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(super) enum EnginePortEvent {
    Init {
        channel_name: &'static str,
        channel_type: u8,
        channel_id: u8,
        port_name: String,
        opened: bool,
    },
    Data {
        channel_name: &'static str,
        channel_type: u8,
        channel_id: u8,
        data: Vec<u8>,
    },
    Event {
        channel_name: &'static str,
        channel_type: u8,
        channel_id: u8,
        event: u8,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "payload")]
pub(super) enum PortControlMessage {
    #[serde(rename = "port_data")]
    Data(PortDataPayload),
    #[serde(rename = "port_event")]
    Event(PortEventPayload),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PortDataPayload {
    channel_type: u8,
    channel_id: u8,
    data: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PortEventPayload {
    channel_type: u8,
    channel_id: u8,
    event: u8,
}

pub(super) fn port_event(
    channel_type: u8,
    channel_id: u8,
    message: u16,
    body: &[u8],
) -> wire::WireResult<Option<EnginePortEvent>> {
    let channel_name = if channel_type == wire::SPICE_CHANNEL_WEBDAV {
        "webdav"
    } else {
        "port"
    };
    match message {
        wire::SPICE_MSG_PORT_INIT => {
            let init = wire::parse_port_init(body)?;
            Ok(Some(EnginePortEvent::Init {
                channel_name,
                channel_type,
                channel_id,
                port_name: String::from_utf8_lossy(&init.name)
                    .trim_end_matches('\0')
                    .to_string(),
                opened: init.opened != 0,
            }))
        }
        wire::SPICE_MSG_SPICEVMC_DATA => Ok(Some(EnginePortEvent::Data {
            channel_name,
            channel_type,
            channel_id,
            data: body.to_vec(),
        })),
        wire::SPICE_MSG_PORT_EVENT => {
            let event = wire::parse_port_event(body)?;
            Ok(Some(EnginePortEvent::Event {
                channel_name,
                channel_type,
                channel_id,
                event: event.event,
            }))
        }
        wire::SPICE_MSG_SPICEVMC_COMPRESSED_DATA => Ok(None),
        _ => Ok(None),
    }
}

pub(super) fn build_port_control_packet(control: PortControlMessage) -> (u8, u8, Vec<u8>) {
    match control {
        PortControlMessage::Data(payload) => (
            payload.channel_type,
            payload.channel_id,
            build_spice_mini_packet(wire::SPICE_MSGC_SPICEVMC_DATA, &payload.data),
        ),
        PortControlMessage::Event(payload) => (
            payload.channel_type,
            payload.channel_id,
            build_spice_mini_packet(wire::SPICE_MSGC_PORT_EVENT, &[payload.event]),
        ),
    }
}
