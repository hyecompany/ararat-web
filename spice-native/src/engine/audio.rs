/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::Serialize;

use crate::wire;

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(super) enum EngineAudioEvent {
    Start {
        channels: u32,
        format: u16,
        frequency: u32,
        time: u32,
    },
    Data {
        time: u32,
        data: Vec<u8>,
    },
    Mode {
        time: u32,
        mode: u16,
        data: Vec<u8>,
    },
    Stop,
    Volume {
        volumes: Vec<u16>,
    },
    Mute {
        mute: u8,
    },
    Latency {
        latency_ms: u32,
    },
}

pub(super) fn playback_event(
    message: u16,
    body: &[u8],
) -> wire::WireResult<Option<EngineAudioEvent>> {
    match message {
        wire::SPICE_MSG_PLAYBACK_START => {
            let start = wire::parse_playback_start(body)?;
            Ok(Some(EngineAudioEvent::Start {
                channels: start.channels,
                format: start.format,
                frequency: start.frequency,
                time: start.time,
            }))
        }
        wire::SPICE_MSG_PLAYBACK_DATA => {
            let data = wire::parse_audio_data(body)?;
            Ok(Some(EngineAudioEvent::Data {
                time: data.time,
                data: data.data,
            }))
        }
        wire::SPICE_MSG_PLAYBACK_MODE => {
            let mode = wire::parse_audio_mode(body)?;
            Ok(Some(EngineAudioEvent::Mode {
                time: mode.time,
                mode: mode.mode,
                data: mode.data,
            }))
        }
        wire::SPICE_MSG_PLAYBACK_STOP => Ok(Some(EngineAudioEvent::Stop)),
        wire::SPICE_MSG_PLAYBACK_VOLUME => {
            let volume = wire::parse_audio_volume(body)?;
            Ok(Some(EngineAudioEvent::Volume {
                volumes: volume.volumes,
            }))
        }
        wire::SPICE_MSG_PLAYBACK_MUTE => {
            let mute = wire::parse_audio_mute(body)?;
            Ok(Some(EngineAudioEvent::Mute { mute: mute.mute }))
        }
        wire::SPICE_MSG_PLAYBACK_LATENCY => {
            let latency = wire::parse_playback_latency(body)?;
            Ok(Some(EngineAudioEvent::Latency {
                latency_ms: latency.latency_ms,
            }))
        }
        _ => Ok(None),
    }
}
