/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::Serialize;

use crate::display_events::DisplayEvent;

use super::audio::EngineAudioEvent;
use super::cursor::EngineCursorEvent;
use super::port::EnginePortEvent;
use super::record::EngineRecordEvent;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ChannelDescriptor {
    pub(super) channel_type: u8,
    pub(super) channel_id: u8,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EngineSessionUpdate {
    pub(super) session_id: Option<u32>,
    pub(super) current_mouse_mode: Option<u32>,
    pub(super) multimedia_time: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineEvents {
    pub(super) outbound: Vec<Vec<u8>>,
    pub(super) ticket_public_keys: Vec<Vec<u8>>,
    pub(super) ready_channels: Vec<String>,
    pub(super) channels_to_open: Vec<ChannelDescriptor>,
    pub(super) display_events: Vec<DisplayEvent>,
    pub(super) audio_events: Vec<EngineAudioEvent>,
    pub(super) record_events: Vec<EngineRecordEvent>,
    pub(super) cursor_events: Vec<EngineCursorEvent>,
    pub(super) port_events: Vec<EnginePortEvent>,
    pub(super) session_update: Option<EngineSessionUpdate>,
}

impl EngineEvents {
    pub(crate) fn empty() -> Self {
        Self {
            outbound: Vec::new(),
            ticket_public_keys: Vec::new(),
            ready_channels: Vec::new(),
            channels_to_open: Vec::new(),
            display_events: Vec::new(),
            audio_events: Vec::new(),
            record_events: Vec::new(),
            cursor_events: Vec::new(),
            port_events: Vec::new(),
            session_update: None,
        }
    }

    #[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
    pub(crate) fn display_events(&self) -> &[DisplayEvent] {
        &self.display_events
    }

    #[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
    pub(crate) fn display_events_mut(&mut self) -> &mut Vec<DisplayEvent> {
        &mut self.display_events
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EngineControlEvents {
    pub(super) channel_packets: Vec<EngineChannelPacket>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EngineChannelPacket {
    pub(super) channel_key: String,
    pub(super) packet: Vec<u8>,
}
