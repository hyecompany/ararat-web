/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

mod atlas;
mod backend;
mod dirty;
mod types;
mod upload;

#[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
pub mod wgpu_backend;

pub use atlas::GpuAtlasAllocator;
pub use backend::{NullGpuBackend, SpiceGpuBackend};
pub use dirty::{dirty_rect_area, should_flatten_dirty_rects};
pub use types::{
    GpuAtlasConfig, GpuAtlasSlot, GpuCommand, GpuCommandBatch, GpuCommandToken, GpuDrawInstance,
    GpuPixelFormat, GpuSurfaceKey, PresentationBarrier,
};
pub use upload::{upload_plan_for_rgba, GpuUploadPlan, GpuUploadStrategy};

#[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
pub use wgpu_backend::{NativeBitmapBatchUpload, WgpuSpiceBackend, WgpuSpiceRuntime};
