/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use super::types::{GpuAtlasConfig, GpuAtlasSlot};

#[derive(Clone, Debug)]
pub struct GpuAtlasAllocator {
    config: GpuAtlasConfig,
    cursor_x: u32,
    cursor_y: u32,
    row_height: u32,
    layer: u32,
    epoch: u64,
}

impl GpuAtlasAllocator {
    pub fn new(config: GpuAtlasConfig) -> Self {
        Self {
            config,
            cursor_x: 0,
            cursor_y: 0,
            row_height: 0,
            layer: 0,
            epoch: 1,
        }
    }

    pub fn config(&self) -> GpuAtlasConfig {
        self.config
    }

    pub fn allocate(&mut self, width: u32, height: u32) -> Option<GpuAtlasSlot> {
        if width == 0 || height == 0 || width > self.config.width || height > self.config.height {
            return None;
        }
        if self.cursor_x.saturating_add(width) > self.config.width {
            self.cursor_x = 0;
            self.cursor_y = self.cursor_y.saturating_add(self.row_height);
            self.row_height = 0;
        }
        if self.cursor_y.saturating_add(height) > self.config.height {
            self.layer = self.layer.saturating_add(1);
            self.cursor_x = 0;
            self.cursor_y = 0;
            self.row_height = 0;
        }
        if self.layer >= self.config.layers {
            return None;
        }
        let slot = GpuAtlasSlot {
            atlas_id: self.config.atlas_id,
            layer: self.layer,
            x: self.cursor_x,
            y: self.cursor_y,
            width,
            height,
            epoch: self.epoch,
        };
        self.cursor_x = self.cursor_x.saturating_add(width);
        self.row_height = self.row_height.max(height);
        self.epoch = self.epoch.saturating_add(1);
        Some(slot)
    }

    pub fn reset(&mut self) {
        self.cursor_x = 0;
        self.cursor_y = 0;
        self.row_height = 0;
        self.layer = 0;
        self.epoch = self.epoch.saturating_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpu::GpuPixelFormat;

    #[test]
    fn atlas_allocator_packs_without_texture_churn() {
        let mut allocator = GpuAtlasAllocator::new(GpuAtlasConfig {
            atlas_id: 7,
            width: 64,
            height: 64,
            layers: 2,
            format: GpuPixelFormat::Rgba8,
        });

        let first = allocator.allocate(32, 16).unwrap();
        let second = allocator.allocate(32, 16).unwrap();
        let third = allocator.allocate(48, 16).unwrap();

        assert_eq!(first.atlas_id, 7);
        assert_eq!(first.x, 0);
        assert_eq!(second.x, 32);
        assert_eq!(third.x, 0);
        assert_eq!(third.y, 16);
    }
}
