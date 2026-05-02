/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use super::types::{GpuAtlasConfig, GpuCommandBatch, GpuSurfaceKey};

pub trait SpiceGpuBackend {
    type Error;

    fn configure_surface(&mut self, surface: GpuSurfaceKey, width: u32, height: u32);
    fn configure_atlas(&mut self, config: GpuAtlasConfig);
    fn destroy_surface(&mut self, surface: GpuSurfaceKey);
    fn submit_batch(&mut self, batch: &GpuCommandBatch) -> Result<(), Self::Error>;
    fn present(&mut self, surface: GpuSurfaceKey) -> Result<(), Self::Error>;
    fn reset_epoch(&mut self);
}

#[derive(Default)]
pub struct NullGpuBackend {
    submitted_batches: u64,
    presented_frames: u64,
    gpu_epoch: u64,
}

impl NullGpuBackend {
    pub fn submitted_batches(&self) -> u64 {
        self.submitted_batches
    }

    pub fn presented_frames(&self) -> u64 {
        self.presented_frames
    }

    pub fn gpu_epoch(&self) -> u64 {
        self.gpu_epoch
    }
}

impl SpiceGpuBackend for NullGpuBackend {
    type Error = ();

    fn configure_surface(&mut self, _surface: GpuSurfaceKey, _width: u32, _height: u32) {}

    fn configure_atlas(&mut self, _config: GpuAtlasConfig) {}

    fn destroy_surface(&mut self, _surface: GpuSurfaceKey) {}

    fn submit_batch(&mut self, _batch: &GpuCommandBatch) -> Result<(), Self::Error> {
        self.submitted_batches = self.submitted_batches.saturating_add(1);
        Ok(())
    }

    fn present(&mut self, _surface: GpuSurfaceKey) -> Result<(), Self::Error> {
        self.presented_frames = self.presented_frames.saturating_add(1);
        Ok(())
    }

    fn reset_epoch(&mut self) {
        self.gpu_epoch = self.gpu_epoch.saturating_add(1);
    }
}
