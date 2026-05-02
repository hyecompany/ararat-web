/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::Serialize;

use crate::display_draw::{DrawImageEnvelope, DrawRect};
use crate::display_execution::VisualExecutionPlan;
use crate::gpu::GpuCommandBatch;

#[derive(Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DisplayEvent {
    Mode {
        sequence_id: u64,
        width: u32,
        height: u32,
        bits: u32,
    },
    Mark {
        sequence_id: u64,
    },
    Reset {
        sequence_id: u64,
    },
    SurfaceCreate {
        sequence_id: u64,
        surface_id: u32,
        surface_generation: u32,
        width: u32,
        height: u32,
        format: u32,
        flags: u32,
        primary: bool,
    },
    SurfaceDestroy {
        sequence_id: u64,
        surface_id: u32,
        surface_generation: u32,
    },
    MonitorsConfig {
        sequence_id: u64,
        count: u32,
        max_allowed: u32,
        heads: Vec<DisplayHead>,
    },
    CopyBits {
        sequence_id: u64,
        surface_id: u32,
        surface_generation: u32,
        commit_token: u64,
        bbox: DisplayRect,
        clip: DisplayClip,
        src_pos: DisplayPoint,
        #[serde(skip_serializing_if = "Option::is_none")]
        gpu_batch: Option<GpuCommandBatch>,
    },
    CacheInvalidateList {
        sequence_id: u64,
        resources: Vec<DisplayCacheResource>,
    },
    CacheInvalidateAllPixmaps {
        sequence_id: u64,
        epoch: Option<u64>,
        wait_barrier: u64,
        pending: bool,
        wait_list: Vec<DisplayWaitChannel>,
    },
    CacheInvalidatePalette {
        sequence_id: u64,
        #[serde(serialize_with = "serialize_u64_string")]
        id: u64,
        epoch: u64,
    },
    CacheInvalidateAllPalettes {
        sequence_id: u64,
        epoch: u64,
    },
    StreamCreate {
        sequence_id: u64,
        surface_id: u32,
        id: u32,
        flags: u8,
        codec_type: u8,
        #[serde(serialize_with = "serialize_u64_string")]
        stamp: u64,
        stream_width: u32,
        stream_height: u32,
        src_width: u32,
        src_height: u32,
        dest: DisplayRect,
        clip: DisplayClip,
    },
    StreamData {
        sequence_id: u64,
        surface_id: u32,
        surface_generation: u32,
        commit_token: u64,
        id: u32,
        codec_type: u8,
        multimedia_time: u32,
        width: u32,
        height: u32,
        dest: DisplayRect,
        byte_length: u32,
        data: Vec<u8>,
    },
    StreamDataSized {
        sequence_id: u64,
        surface_id: u32,
        surface_generation: u32,
        commit_token: u64,
        id: u32,
        codec_type: u8,
        multimedia_time: u32,
        width: u32,
        height: u32,
        dest: DisplayRect,
        byte_length: u32,
        data: Vec<u8>,
    },
    StreamClip {
        sequence_id: u64,
        id: u32,
        clip: DisplayClip,
    },
    StreamDestroy {
        sequence_id: u64,
        id: u32,
    },
    StreamDestroyAll {
        sequence_id: u64,
    },
    StreamActivateReport {
        sequence_id: u64,
        stream_id: u32,
        unique_id: u32,
        max_window_size: u32,
        timeout_ms: u32,
    },
    Draw {
        sequence_id: u64,
        message_type: u16,
        kind: &'static str,
        surface_id: u32,
        surface_generation: u32,
        commit_token: u64,
        bbox: DisplayRect,
        clip: DisplayClip,
        body_byte_length: u32,
        src_area: Option<DrawRect>,
        rop_descriptor: Option<u16>,
        scale_mode: Option<u8>,
        frame_hint: DisplayFrameHint,
        execution: VisualExecutionPlan,
        image: Option<DrawImageEnvelope>,
        #[serde(skip_serializing_if = "Option::is_none")]
        gpu_batch: Option<GpuCommandBatch>,
    },
    #[cfg_attr(
        not(all(feature = "webgpu-wgpu", target_arch = "wasm32")),
        allow(dead_code)
    )]
    NativeGpuCommit {
        sequence_id: u64,
        surface_id: u32,
        surface_generation: u32,
        commit_token: u64,
        bbox: DisplayRect,
        video_like: bool,
        presented: bool,
        byte_length: u32,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DisplayFrameHint {
    None,
    BitmapStrip {
        run_id: u64,
        starts_run: bool,
        closes_previous_run: bool,
        item_count: u32,
    },
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayRect {
    pub top: i32,
    pub left: i32,
    pub bottom: i32,
    pub right: i32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayClip {
    pub clip_type: u8,
    pub rects: Vec<DisplayRect>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayHead {
    pub monitor_id: u32,
    pub surface_id: u32,
    pub width: u32,
    pub height: u32,
    pub x: u32,
    pub y: u32,
    pub flags: u32,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayWaitChannel {
    pub channel_type: u8,
    pub channel_id: u8,
    #[serde(serialize_with = "serialize_u64_string")]
    pub message_serial: u64,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCacheResource {
    pub resource_type: u8,
    #[serde(serialize_with = "serialize_u64_string")]
    pub id: u64,
}

fn serialize_u64_string<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_str(&value.to_string())
}
