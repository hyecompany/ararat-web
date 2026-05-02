/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

mod cache;
mod capabilities;
mod codecs;
#[cfg(test)]
#[cfg_attr(test, allow(dead_code))]
mod decoded_frame;
mod display_draw;
mod display_events;
mod display_execution;
mod display_planner;
mod display_state;
mod engine;
mod gpu;
mod inputs;
mod mutation_graph;
mod pixel;
mod protocol;
#[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
mod runtime;
pub mod wire;

pub use cache::{
    spice_cache_resource_cursor, spice_cache_resource_decode, spice_cache_resource_glz,
    spice_cache_resource_gpu, spice_cache_resource_image, spice_cache_resource_palette,
    spice_cache_resource_pixmap, ProtocolCacheInsert, ProtocolCacheKind, ProtocolCacheRecord,
    ProtocolCacheTable, SpiceCacheEpochs,
};
pub use codecs::*;
pub use engine::SpiceEngine;
pub use gpu::{
    dirty_rect_area, should_flatten_dirty_rects, upload_plan_for_rgba, GpuAtlasAllocator,
    GpuAtlasConfig, GpuAtlasSlot, GpuCommand, GpuCommandBatch, GpuCommandToken, GpuDrawInstance,
    GpuPixelFormat, GpuSurfaceKey, GpuUploadPlan, GpuUploadStrategy, NullGpuBackend,
    PresentationBarrier, SpiceGpuBackend,
};
#[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
pub use gpu::{WgpuSpiceBackend, WgpuSpiceRuntime};
pub use mutation_graph::SpiceMutationGraph;
pub use pixel::{
    apply_alpha_mask_rgba, apply_draw_copy_rop_rgba, apply_rop_rgba, mono_cursor_to_rgba,
};
pub use protocol::{
    build_spice_ack_packet, build_spice_ack_sync_packet, build_spice_mini_packet,
    build_spice_pong_packet, parse_spice_mini_header, parse_spice_set_ack, spice_ack_decision_none,
    spice_ack_decision_sync, spice_ack_decision_window, SpiceAckState, SpiceMiniHeader,
    SpiceSetAck,
};
#[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
pub use runtime::SpiceNativeRuntime;

#[cfg(all(feature = "wasm-thread-pool", target_arch = "wasm32"))]
pub use wasm_bindgen_rayon::init_thread_pool;
