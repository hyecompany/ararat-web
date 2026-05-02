/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::protocol::build_spice_mini_packet;
use crate::wire;

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(super) enum EngineRecordEvent {
    Start {
        channels: u32,
        format: u16,
        frequency: u32,
    },
    Stop,
    Volume {
        volumes: Vec<u16>,
    },
    Mute {
        mute: u8,
    },
}

#[derive(Default)]
pub(super) struct RecordState {
    started_channels: HashSet<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "payload")]
pub(super) enum RecordControlMessage {
    #[serde(rename = "record_chunk")]
    Chunk(RecordChunkPayload),
    #[serde(rename = "record_error")]
    Error(RecordErrorPayload),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecordChunkPayload {
    pcm: Vec<u8>,
    multimedia_time: u32,
}

#[derive(Deserialize)]
pub(super) struct RecordErrorPayload {
    message: String,
}

impl RecordState {
    pub(super) fn handle_server_message(
        &mut self,
        channel_key: &str,
        message: u16,
        body: &[u8],
    ) -> wire::WireResult<Option<EngineRecordEvent>> {
        match message {
            wire::SPICE_MSG_RECORD_START => {
                self.started_channels.remove(channel_key);
                let start = wire::parse_record_start(body)?;
                Ok(Some(EngineRecordEvent::Start {
                    channels: start.channels,
                    format: start.format,
                    frequency: start.frequency,
                }))
            }
            wire::SPICE_MSG_RECORD_STOP => {
                self.started_channels.remove(channel_key);
                Ok(Some(EngineRecordEvent::Stop))
            }
            wire::SPICE_MSG_RECORD_VOLUME => {
                let volume = wire::parse_audio_volume(body)?;
                Ok(Some(EngineRecordEvent::Volume {
                    volumes: volume.volumes,
                }))
            }
            wire::SPICE_MSG_RECORD_MUTE => {
                let mute = wire::parse_audio_mute(body)?;
                Ok(Some(EngineRecordEvent::Mute { mute: mute.mute }))
            }
            _ => Ok(None),
        }
    }

    pub(super) fn clear(&mut self) {
        self.started_channels.clear();
    }

    pub(super) fn control_packets(
        &mut self,
        channel_key: &str,
        control: RecordControlMessage,
    ) -> Vec<Vec<u8>> {
        match control {
            RecordControlMessage::Chunk(payload) => {
                let mut packets = Vec::new();
                if !self.started_channels.contains(channel_key) {
                    packets.push(build_record_mode_packet(payload.multimedia_time));
                    packets.push(build_record_start_mark_packet(payload.multimedia_time));
                    self.started_channels.insert(channel_key.to_string());
                }
                packets.push(build_record_data_packet(
                    payload.multimedia_time,
                    &payload.pcm,
                ));
                packets
            }
            RecordControlMessage::Error(payload) => {
                let _ = payload.message;
                Vec::new()
            }
        }
    }
}

fn build_record_mode_packet(multimedia_time: u32) -> Vec<u8> {
    let mut body = Vec::with_capacity(6);
    body.extend_from_slice(&multimedia_time.to_le_bytes());
    body.extend_from_slice(&wire::SPICE_AUDIO_DATA_MODE_RAW.to_le_bytes());
    build_spice_mini_packet(wire::SPICE_MSGC_RECORD_MODE, &body)
}

fn build_record_start_mark_packet(multimedia_time: u32) -> Vec<u8> {
    build_spice_mini_packet(
        wire::SPICE_MSGC_RECORD_START_MARK,
        &multimedia_time.to_le_bytes(),
    )
}

fn build_record_data_packet(multimedia_time: u32, pcm: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(4 + pcm.len());
    body.extend_from_slice(&multimedia_time.to_le_bytes());
    body.extend_from_slice(pcm);
    build_spice_mini_packet(wire::SPICE_MSGC_RECORD_DATA, &body)
}
