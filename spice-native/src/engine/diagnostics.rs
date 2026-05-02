/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::collections::HashMap;

use serde::Serialize;

use crate::display_events::DisplayEvent;

use super::channel::{channel_phase_name, ChannelState};
use super::events::EngineSessionUpdate;

#[derive(Default, Serialize)]
pub(super) struct EnginePerformanceDiagnostics {
    pub(super) ingress_packets_consumed: u64,
    pub(super) ingress_bytes_consumed: u64,
    pub(super) ingress_ack_count: u64,
    pub(super) ingress_ack_sync_count: u64,
    pub(super) region_ownership_entries: u32,
    pub(super) region_ownership_pruned_entries: u32,
    pub(super) cache_epoch_resources: u32,
    pub(super) cache_epoch_kinds: u32,
    pub(super) unsupported_counts: HashMap<String, u64>,
    pub(super) display_message_counts: HashMap<String, u64>,
    pub(super) display_event_counts: HashMap<String, u64>,
    pub(super) display_error_counts: HashMap<String, u64>,
    pub(super) ordering_barriers: u32,
}

#[derive(Serialize)]
pub(super) struct EngineDiagnostics {
    pub(super) performance: EngineDiagnosticsPerformance,
    pub(super) unsupported: Vec<String>,
    pub(super) session: EngineSessionUpdate,
    pub(super) channel_diagnostics: Vec<EngineChannelDiagnostics>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EngineDiagnosticsPerformance {
    pub(super) ingress_packets_consumed: u64,
    pub(super) ingress_bytes_consumed: u64,
    pub(super) ingress_ack_count: u64,
    pub(super) ingress_ack_sync_count: u64,
    pub(super) region_ownership_entries: u32,
    pub(super) region_ownership_pruned_entries: u32,
    pub(super) cache_epoch_resources: u32,
    pub(super) cache_epoch_kinds: u32,
    pub(super) ordering_barriers: u32,
    pub(super) unsupported_counts: HashMap<String, u64>,
    pub(super) display_message_counts: HashMap<String, u64>,
    pub(super) display_event_counts: HashMap<String, u64>,
    pub(super) display_error_counts: HashMap<String, u64>,
}

pub(super) fn increment_count<K>(counts: &mut HashMap<String, u64>, key: K)
where
    K: ToString,
{
    *counts.entry(key.to_string()).or_insert(0) += 1;
}

pub(super) fn display_event_message_key(event: &DisplayEvent) -> &'static str {
    match event {
        DisplayEvent::Mode { .. } => "mode",
        DisplayEvent::Mark { .. } => "mark",
        DisplayEvent::Reset { .. } => "reset",
        DisplayEvent::SurfaceCreate { .. } => "surfaceCreate",
        DisplayEvent::SurfaceDestroy { .. } => "surfaceDestroy",
        DisplayEvent::MonitorsConfig { .. } => "monitorsConfig",
        DisplayEvent::CopyBits { .. } => "copyBits",
        DisplayEvent::CacheInvalidateList { .. } => "cacheInvalidateList",
        DisplayEvent::CacheInvalidateAllPixmaps { .. } => "cacheInvalidateAllPixmaps",
        DisplayEvent::CacheInvalidatePalette { .. } => "cacheInvalidatePalette",
        DisplayEvent::CacheInvalidateAllPalettes { .. } => "cacheInvalidateAllPalettes",
        DisplayEvent::StreamCreate { .. } => "streamCreate",
        DisplayEvent::StreamData { .. } => "streamData",
        DisplayEvent::StreamDataSized { .. } => "streamDataSized",
        DisplayEvent::StreamClip { .. } => "streamClip",
        DisplayEvent::StreamDestroy { .. } => "streamDestroy",
        DisplayEvent::StreamDestroyAll { .. } => "streamDestroyAll",
        DisplayEvent::StreamActivateReport { .. } => "streamActivateReport",
        DisplayEvent::Draw { .. } => "draw",
        DisplayEvent::NativeGpuCommit { .. } => "nativeGpuCommit",
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EngineChannelDiagnostics {
    pub(super) key: String,
    pub(super) channel_type: u8,
    pub(super) channel_id: u8,
    pub(super) phase: &'static str,
    pub(super) buffered_bytes: usize,
    pub(super) parsed_mini_messages: u64,
    pub(super) last_message_type: Option<u16>,
    pub(super) last_body_size: Option<u32>,
    pub(super) pending_message_type: Option<u16>,
    pub(super) pending_body_size: Option<u32>,
    pub(super) ack_window: u32,
    pub(super) packets_since_ack: u32,
}

pub(super) fn channel_diagnostics(key: &str, channel: &ChannelState) -> EngineChannelDiagnostics {
    let (pending_message_type, pending_body_size) = if channel.buffer.len() >= 6 {
        (
            Some(u16::from_le_bytes([channel.buffer[0], channel.buffer[1]])),
            Some(u32::from_le_bytes([
                channel.buffer[2],
                channel.buffer[3],
                channel.buffer[4],
                channel.buffer[5],
            ])),
        )
    } else {
        (None, None)
    };

    EngineChannelDiagnostics {
        key: key.to_string(),
        channel_type: channel.channel_type,
        channel_id: channel.channel_id,
        phase: channel_phase_name(channel.phase),
        buffered_bytes: channel.buffer.len(),
        parsed_mini_messages: channel.parsed_mini_messages,
        last_message_type: channel.last_message_type,
        last_body_size: channel.last_body_size,
        pending_message_type,
        pending_body_size,
        ack_window: channel.ack.window(),
        packets_since_ack: channel.ack.packets_since_ack(),
    }
}
