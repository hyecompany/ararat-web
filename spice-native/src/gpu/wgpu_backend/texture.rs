/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::display_draw::DrawRect;

use super::GpuPixelFormat;

pub(super) struct PrimarySurface {
    texture: wgpu::Texture,
    width: u32,
    height: u32,
    format: wgpu::TextureFormat,
}

#[derive(Clone, Copy)]
pub(super) struct TextureRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy)]
pub(super) struct CopyRect {
    pub dest: TextureRect,
    pub source: TextureRect,
}

#[derive(Clone, Copy)]
pub(super) struct BlitRect {
    pub dest: TextureRect,
    pub uv: [f32; 4],
}

impl PrimarySurface {
    pub fn new(
        device: &wgpu::Device,
        width: u32,
        height: u32,
        format: wgpu::TextureFormat,
    ) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("spice-primary-surface"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        Self {
            texture,
            width: width.max(1),
            height: height.max(1),
            format,
        }
    }

    pub fn texture(&self) -> &wgpu::Texture {
        &self.texture
    }

    pub fn view(&self) -> wgpu::TextureView {
        self.texture
            .create_view(&wgpu::TextureViewDescriptor::default())
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn format(&self) -> wgpu::TextureFormat {
        self.format
    }
}

impl TextureRect {
    pub fn from_draw_rect(rect: DrawRect, target_width: u32, target_height: u32) -> Option<Self> {
        let left = rect.left.max(0).min(target_width as i32) as u32;
        let top = rect.top.max(0).min(target_height as i32) as u32;
        let right = rect.right.max(0).min(target_width as i32) as u32;
        let bottom = rect.bottom.max(0).min(target_height as i32) as u32;
        (right > left && bottom > top).then_some(Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        })
    }

    pub fn unit_uv() -> [f32; 4] {
        [0.0, 0.0, 1.0, 1.0]
    }

    pub fn copy_rect(
        dest: DrawRect,
        source: DrawRect,
        width: u32,
        height: u32,
    ) -> Option<CopyRect> {
        let dest = Self::from_draw_rect_exact(dest, width, height)?;
        let source = Self::from_draw_rect_exact(source, width, height)?;
        (dest.width == source.width && dest.height == source.height)
            .then_some(CopyRect { dest, source })
    }

    pub fn area(self) -> u64 {
        u64::from(self.width).saturating_mul(u64::from(self.height))
    }

    pub fn origin(self) -> wgpu::Origin3d {
        wgpu::Origin3d {
            x: self.x,
            y: self.y,
            z: 0,
        }
    }

    pub fn extent(self) -> wgpu::Extent3d {
        wgpu::Extent3d {
            width: self.width,
            height: self.height,
            depth_or_array_layers: 1,
        }
    }

    fn from_draw_rect_exact(rect: DrawRect, width: u32, height: u32) -> Option<Self> {
        if rect.left < 0 || rect.top < 0 || rect.right <= rect.left || rect.bottom <= rect.top {
            return None;
        }
        let right = u32::try_from(rect.right).ok()?;
        let bottom = u32::try_from(rect.bottom).ok()?;
        let left = u32::try_from(rect.left).ok()?;
        let top = u32::try_from(rect.top).ok()?;
        if right > width || bottom > height {
            return None;
        }
        Some(Self {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        })
    }
}

impl BlitRect {
    pub fn new(
        dest: DrawRect,
        source: DrawRect,
        target_width: u32,
        target_height: u32,
        source_width: u32,
        source_height: u32,
    ) -> Option<Self> {
        if dest.right <= dest.left
            || dest.bottom <= dest.top
            || source.right <= source.left
            || source.bottom <= source.top
        {
            return None;
        }
        let source = clamp_source_rect(source, source_width, source_height)?;
        let dest_width = (dest.right - dest.left) as f32;
        let dest_height = (dest.bottom - dest.top) as f32;
        let mut src_left = source.left as f32;
        let mut src_top = source.top as f32;
        let mut src_right = source.right as f32;
        let mut src_bottom = source.bottom as f32;

        let clipped_left = dest.left.max(0).min(target_width as i32);
        let clipped_top = dest.top.max(0).min(target_height as i32);
        let clipped_right = dest.right.max(0).min(target_width as i32);
        let clipped_bottom = dest.bottom.max(0).min(target_height as i32);
        if clipped_right <= clipped_left || clipped_bottom <= clipped_top {
            return None;
        }

        let src_width = src_right - src_left;
        let src_height = src_bottom - src_top;
        src_left += ((clipped_left - dest.left) as f32 / dest_width) * src_width;
        src_right -= ((dest.right - clipped_right) as f32 / dest_width) * src_width;
        src_top += ((clipped_top - dest.top) as f32 / dest_height) * src_height;
        src_bottom -= ((dest.bottom - clipped_bottom) as f32 / dest_height) * src_height;

        Some(Self {
            dest: TextureRect {
                x: clipped_left as u32,
                y: clipped_top as u32,
                width: (clipped_right - clipped_left) as u32,
                height: (clipped_bottom - clipped_top) as u32,
            },
            uv: [
                src_left / source_width as f32,
                src_top / source_height as f32,
                src_right / source_width as f32,
                src_bottom / source_height as f32,
            ],
        })
    }
}

pub(super) fn texture_format(format: GpuPixelFormat) -> wgpu::TextureFormat {
    match format {
        GpuPixelFormat::Bgra8 => wgpu::TextureFormat::Bgra8Unorm,
        GpuPixelFormat::Rgba8 | GpuPixelFormat::Rgb24 | GpuPixelFormat::Bgr24 => {
            wgpu::TextureFormat::Rgba8Unorm
        }
        GpuPixelFormat::A8 => wgpu::TextureFormat::R8Unorm,
    }
}

fn clamp_source_rect(rect: DrawRect, width: u32, height: u32) -> Option<DrawRect> {
    let left = rect.left.max(0).min(width as i32);
    let top = rect.top.max(0).min(height as i32);
    let right = rect.right.max(0).min(width as i32);
    let bottom = rect.bottom.max(0).min(height as i32);
    (right > left && bottom > top).then_some(DrawRect {
        left,
        top,
        right,
        bottom,
    })
}
