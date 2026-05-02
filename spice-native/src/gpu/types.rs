/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::{Deserialize, Serialize};

use crate::display_draw::DrawRect;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSurfaceKey {
    pub surface_id: u32,
    pub generation: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuCommandToken {
    pub commit_token: u64,
    pub surface: GpuSurfaceKey,
    pub dest: DrawRect,
    pub cache_epoch: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuAtlasSlot {
    pub atlas_id: u32,
    pub layer: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub epoch: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuAtlasConfig {
    pub atlas_id: u32,
    pub width: u32,
    pub height: u32,
    pub layers: u32,
    pub format: GpuPixelFormat,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuDrawInstance {
    pub token: GpuCommandToken,
    pub atlas_slot: GpuAtlasSlot,
    pub source_rect: DrawRect,
    pub dest_rect: DrawRect,
    pub rop_descriptor: u16,
    pub scale_mode: u8,
    pub mask_slot: Option<GpuAtlasSlot>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GpuCommand {
    EnsureAtlas {
        config: GpuAtlasConfig,
    },
    UploadAtlas {
        slot: GpuAtlasSlot,
        source_handle: u64,
        byte_offset: u32,
        byte_length: u32,
        format: GpuPixelFormat,
    },
    DrawInstances {
        surface: GpuSurfaceKey,
        instances: Vec<GpuDrawInstance>,
    },
    Fill {
        token: GpuCommandToken,
        color: u32,
        rop_descriptor: u16,
    },
    CopyBitmap {
        token: GpuCommandToken,
        source_handle: u64,
        source_rect: DrawRect,
        rop_descriptor: u16,
        scale_mode: u8,
    },
    CopySurface {
        token: GpuCommandToken,
        source: GpuSurfaceKey,
        source_rect: DrawRect,
    },
    ComputeColorConvert {
        token: GpuCommandToken,
        source_handle: u64,
        source_format: GpuPixelFormat,
        target_format: GpuPixelFormat,
    },
    ComputeDirtyRectFlatten {
        surface: GpuSurfaceKey,
        batch_id: u64,
        rect_count: u32,
    },
    Present {
        surface: GpuSurfaceKey,
        batch_id: u64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GpuPixelFormat {
    Bgra8,
    Rgba8,
    Rgb24,
    Bgr24,
    A8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuCommandBatch {
    pub batch_id: u64,
    pub surface: GpuSurfaceKey,
    pub commands: Vec<GpuCommand>,
    pub dirty_rects: Vec<DrawRect>,
    pub byte_cost: u32,
    pub presentation_barrier: PresentationBarrier,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PresentationBarrier {
    Immediate,
    Mark,
    SurfaceLifecycle,
    CoherentFrame,
}
