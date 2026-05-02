/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::collections::{HashMap, HashSet};

use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

mod pipeline;
mod texture;

use pipeline::{
    compute_bitmap_unpack_item_bytes, ComputeBitmapBlitPipeline, ComputeBitmapUnpackPipeline,
    ComputeBlitPipeline, ComputeRopBlitPipeline, FillDraw, FillPipeline, TextureFilter,
    TextureRectPipeline,
};
use texture::{texture_format, BlitRect, PrimarySurface, TextureRect};

use super::{
    GpuAtlasConfig, GpuCommand, GpuCommandBatch, GpuPixelFormat, GpuSurfaceKey, SpiceGpuBackend,
};
use crate::display_draw::DrawRect;

const PRIMARY_SURFACE_ID: u32 = 0;
const SPICE_ROPD_OP_PUT: u16 = 8;
const SPICE_BITMAP_FMT_32BIT: u8 = 8;
const SPICE_BITMAP_FMT_RGBA: u8 = 9;
const SPICE_BITMAP_FLAGS_TOP_DOWN: u8 = 4;
const SCALE_MODE_NEAREST: u8 = 0;
const SCALE_MODE_LINEAR: u8 = 1;
const MAX_UPLOAD_TEXTURE_CACHE_ENTRIES: usize = 24;

pub struct NativeBitmapBatchUpload<'a> {
    pub bytes: &'a [u8],
    pub source_width: u32,
    pub source_height: u32,
    pub stride: u32,
    pub format: u8,
    pub flags: u8,
    pub dest: DrawRect,
    pub source: DrawRect,
    pub rop_descriptor: u16,
    pub scale_mode: u8,
    pub mask_present: bool,
    pub present: bool,
    pub buffer_unpack: bool,
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
enum UploadTextureFormat {
    Rgba8Unorm,
    Bgra8Unorm,
}

impl UploadTextureFormat {
    fn texture_format(self) -> wgpu::TextureFormat {
        match self {
            Self::Rgba8Unorm => wgpu::TextureFormat::Rgba8Unorm,
            Self::Bgra8Unorm => wgpu::TextureFormat::Bgra8Unorm,
        }
    }
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
struct UploadTextureKey {
    width: u32,
    height: u32,
    format: UploadTextureFormat,
}

#[derive(Clone, Copy)]
enum UploadTextureCacheKind {
    Rgba,
    Bitmap,
    External,
}

pub struct WgpuSpiceBackend {
    epoch: u64,
    runtime: Option<WgpuRuntime>,
}

struct WgpuRuntime {
    surface: wgpu::Surface<'static>,
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    primary: PrimarySurface,
    fill_pipeline: FillPipeline,
    primary_rect_pipeline: TextureRectPipeline,
    compute_blit_pipeline: ComputeBlitPipeline,
    compute_rop_blit_pipeline: ComputeRopBlitPipeline,
    compute_bitmap_blit_pipeline: ComputeBitmapBlitPipeline,
    compute_bitmap_unpack_pipeline: ComputeBitmapUnpackPipeline,
    present_rect_pipeline: TextureRectPipeline,
    atlases: HashMap<u32, WgpuAtlas>,
    rgba_upload_textures: HashMap<UploadTextureKey, wgpu::Texture>,
    bitmap_upload_textures: HashMap<UploadTextureKey, wgpu::Texture>,
    external_upload_textures: HashMap<UploadTextureKey, wgpu::Texture>,
    submitted_batches: u64,
    presented_frames: u64,
    gpu_math_ops: u64,
    gpu_math_area: u64,
    gpu_compute_ops: u64,
    gpu_compute_area: u64,
    queue_submit_count: u64,
    empty_queue_submit_count: u64,
    texture_write_count: u64,
    texture_upload_bytes: u64,
    external_texture_copy_count: u64,
    compute_dispatch_count: u64,
    bitmap_compute_dispatch_count: u64,
    rgba_compute_dispatch_count: u64,
    rop_compute_dispatch_count: u64,
    render_pass_count: u64,
    present_render_pass_count: u64,
    upload_texture_cache_hits: u64,
    upload_texture_cache_misses: u64,
}

struct WgpuAtlas {
    config: GpuAtlasConfig,
    texture: wgpu::Texture,
}

struct PreparedBitmapUpload {
    index: usize,
    key: UploadTextureKey,
    texture: wgpu::Texture,
    blit: BlitRect,
    top_down: bool,
    preserve_alpha: bool,
    present: bool,
}

struct PreparedBitmapUnpackItem {
    index: usize,
    area: u64,
}

struct PreparedBitmapUnpackBatch {
    items: Vec<PreparedBitmapUnpackItem>,
    source_buffer: wgpu::Buffer,
    params_buffer: wgpu::Buffer,
    max_width: u32,
    max_height: u32,
    present: bool,
}

struct PendingBitmapUnpackBatch {
    source_bytes: Vec<u8>,
    params_bytes: Vec<u8>,
    items: Vec<PreparedBitmapUnpackItem>,
    rects: Vec<TextureRect>,
    max_width: u32,
    max_height: u32,
    present: bool,
}

enum PreparedBitmapWork {
    Texture(PreparedBitmapUpload),
    BufferUnpack(PreparedBitmapUnpackBatch),
}

impl PreparedBitmapWork {
    fn present(&self) -> bool {
        match self {
            Self::Texture(upload) => upload.present,
            Self::BufferUnpack(upload) => upload.present,
        }
    }
}

impl PendingBitmapUnpackBatch {
    fn new() -> Self {
        Self {
            source_bytes: Vec::new(),
            params_bytes: Vec::new(),
            items: Vec::new(),
            rects: Vec::new(),
            max_width: 0,
            max_height: 0,
            present: false,
        }
    }

    fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    fn can_append(&self, source_len: usize, dest: TextureRect, limits: &wgpu::Limits) -> bool {
        if self
            .rects
            .iter()
            .any(|rect| texture_rects_overlap(*rect, dest))
        {
            return false;
        }
        let Some(source_len) = self.source_bytes.len().checked_add(source_len) else {
            return false;
        };
        let Some(params_len) = self.params_bytes.len().checked_add(64) else {
            return false;
        };
        let Ok(source_size) = u64::try_from(source_len.max(4)) else {
            return false;
        };
        let Ok(params_size) = u64::try_from(params_len) else {
            return false;
        };
        source_size <= limits.max_storage_buffer_binding_size
            && source_size <= limits.max_buffer_size
            && params_size <= limits.max_storage_buffer_binding_size
            && params_size <= limits.max_buffer_size
            && self.items.len() < limits.max_compute_workgroups_per_dimension as usize
    }

    fn append(
        &mut self,
        index: usize,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        stride_words: u32,
        blit: BlitRect,
        top_down: bool,
        preserve_alpha: bool,
        present: bool,
    ) -> Result<(), String> {
        let source_offset_words = u32::try_from(self.source_bytes.len() / 4)
            .map_err(|_| "bitmap unpack source offset overflowed".to_string())?;
        self.params_bytes
            .extend_from_slice(&compute_bitmap_unpack_item_bytes(
                source_width,
                source_height,
                stride_words,
                blit,
                source_offset_words,
                top_down,
                preserve_alpha,
            ));
        self.source_bytes.extend_from_slice(bytes);
        self.items.push(PreparedBitmapUnpackItem {
            index,
            area: blit.dest.area(),
        });
        self.rects.push(blit.dest);
        self.max_width = self.max_width.max(blit.dest.width);
        self.max_height = self.max_height.max(blit.dest.height);
        self.present |= present;
        Ok(())
    }

    fn finish(
        self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
    ) -> Result<PreparedBitmapUnpackBatch, String> {
        let source_size = u64::try_from(self.source_bytes.len().max(4))
            .map_err(|_| "bitmap unpack source too large".to_string())?;
        let params_size = u64::try_from(self.params_bytes.len())
            .map_err(|_| "bitmap unpack params too large".to_string())?;
        let source_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spice-bitmap-unpack-source-batch"),
            size: source_size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&source_buffer, 0, &self.source_bytes);
        let params_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spice-bitmap-unpack-params-batch"),
            size: params_size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&params_buffer, 0, &self.params_bytes);
        Ok(PreparedBitmapUnpackBatch {
            items: self.items,
            source_buffer,
            params_buffer,
            max_width: self.max_width.max(1),
            max_height: self.max_height.max(1),
            present: self.present,
        })
    }
}

fn texture_rects_overlap(a: TextureRect, b: TextureRect) -> bool {
    let a_right = a.x.saturating_add(a.width);
    let a_bottom = a.y.saturating_add(a.height);
    let b_right = b.x.saturating_add(b.width);
    let b_bottom = b.y.saturating_add(b.height);
    a.x < b_right && b.x < a_right && a.y < b_bottom && b.y < a_bottom
}

fn flush_pending_bitmap_unpack_batch(
    pending: &mut PendingBitmapUnpackBatch,
    prepared: &mut Vec<PreparedBitmapWork>,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
) -> Result<(), String> {
    if pending.is_empty() {
        return Ok(());
    }
    let batch = std::mem::replace(pending, PendingBitmapUnpackBatch::new());
    prepared.push(PreparedBitmapWork::BufferUnpack(
        batch.finish(device, queue)?,
    ));
    Ok(())
}

impl WgpuAtlas {
    fn destroy(self) {
        self.texture.destroy();
    }
}

#[wasm_bindgen]
pub struct WgpuSpiceRuntime {
    backend: WgpuSpiceBackend,
}

#[wasm_bindgen]
impl WgpuSpiceRuntime {
    #[wasm_bindgen(js_name = createForOffscreenCanvas)]
    pub async fn create_for_offscreen_canvas(
        canvas: web_sys::OffscreenCanvas,
        width: u32,
        height: u32,
    ) -> Result<WgpuSpiceRuntime, JsValue> {
        Ok(WgpuSpiceRuntime {
            backend: WgpuSpiceBackend::from_offscreen_canvas(canvas, width, height).await?,
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        self.backend.resize(width, height).map_err(js_error)
    }

    #[wasm_bindgen(js_name = configureSurface)]
    pub fn configure_surface(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        self.resize(width, height)
    }

    #[wasm_bindgen(js_name = submitBatch)]
    pub fn submit_batch(&mut self, batch: JsValue) -> Result<(), JsValue> {
        let batch: GpuCommandBatch = serde_wasm_bindgen::from_value(batch)?;
        self.backend.submit_batch(&batch).map_err(js_error)
    }

    #[wasm_bindgen(js_name = fillRect)]
    pub fn fill_rect(
        &mut self,
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
        color: u32,
    ) -> Result<(), JsValue> {
        self.backend
            .render_fills(&[FillDraw {
                dest: DrawRect {
                    left,
                    top,
                    right,
                    bottom,
                },
                color,
            }])
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = uploadAndPresentRgbaRect)]
    #[allow(clippy::too_many_arguments)]
    pub fn upload_and_present_rgba_rect(
        &mut self,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        dest_left: i32,
        dest_top: i32,
        dest_right: i32,
        dest_bottom: i32,
        src_left: i32,
        src_top: i32,
        src_right: i32,
        src_bottom: i32,
        rop_descriptor: u16,
        scale_mode: u8,
        mask_present: bool,
    ) -> Result<bool, JsValue> {
        if mask_present {
            return Ok(false);
        }
        let Some(filter) = texture_filter(scale_mode) else {
            return Ok(false);
        };
        let dest = DrawRect {
            left: dest_left,
            top: dest_top,
            right: dest_right,
            bottom: dest_bottom,
        };
        let source = DrawRect {
            left: src_left,
            top: src_top,
            right: src_right,
            bottom: src_bottom,
        };
        self.backend
            .upload_rgba_rect(
                bytes,
                source_width,
                source_height,
                dest,
                source,
                filter,
                rop_descriptor,
                true,
            )
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = uploadAndPresentBitmapRect)]
    #[allow(clippy::too_many_arguments)]
    pub fn upload_and_present_bitmap_rect(
        &mut self,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        stride: u32,
        format: u8,
        flags: u8,
        dest_left: i32,
        dest_top: i32,
        dest_right: i32,
        dest_bottom: i32,
        src_left: i32,
        src_top: i32,
        src_right: i32,
        src_bottom: i32,
        rop_descriptor: u16,
        scale_mode: u8,
        mask_present: bool,
    ) -> Result<bool, JsValue> {
        if mask_present {
            return Ok(false);
        }
        let Some(filter) = texture_filter(scale_mode) else {
            return Ok(false);
        };
        let dest = DrawRect {
            left: dest_left,
            top: dest_top,
            right: dest_right,
            bottom: dest_bottom,
        };
        let source = DrawRect {
            left: src_left,
            top: src_top,
            right: src_right,
            bottom: src_bottom,
        };
        self.backend
            .upload_bitmap_rect(
                bytes,
                source_width,
                source_height,
                stride,
                format,
                flags,
                dest,
                source,
                filter,
                rop_descriptor,
                true,
            )
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = copySurfaceRect)]
    pub fn copy_surface_rect(
        &mut self,
        dest_left: i32,
        dest_top: i32,
        dest_right: i32,
        dest_bottom: i32,
        src_left: i32,
        src_top: i32,
    ) -> Result<bool, JsValue> {
        let dest = DrawRect {
            left: dest_left,
            top: dest_top,
            right: dest_right,
            bottom: dest_bottom,
        };
        self.backend
            .copy_primary_rect_from_origin(dest, src_left, src_top)
            .map_err(js_error)
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = uploadExternalImageAndPresent)]
    pub fn upload_external_image_and_present(
        &mut self,
        source: JsValue,
        source_width: u32,
        source_height: u32,
        dest_left: i32,
        dest_top: i32,
        dest_right: i32,
        dest_bottom: i32,
        src_left: i32,
        src_top: i32,
        src_right: i32,
        src_bottom: i32,
        rop_descriptor: u16,
        scale_mode: u8,
        mask_present: bool,
    ) -> Result<bool, JsValue> {
        let source = source
            .dyn_into::<web_sys::ImageBitmap>()
            .map_err(|_| js_error("external upload expects ImageBitmap"))?;
        let dest = DrawRect {
            left: dest_left,
            top: dest_top,
            right: dest_right,
            bottom: dest_bottom,
        };
        let source_rect = DrawRect {
            left: src_left,
            top: src_top,
            right: src_right,
            bottom: src_bottom,
        };
        if mask_present {
            return Ok(false);
        }
        let Some(filter) = texture_filter(scale_mode) else {
            return Ok(false);
        };
        self.backend
            .upload_external_image_rect(
                source,
                source_width,
                source_height,
                dest,
                source_rect,
                filter,
                rop_descriptor,
                true,
            )
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = presentPrimary)]
    pub fn present_primary(&mut self) -> Result<(), JsValue> {
        self.backend.present_primary_now().map_err(js_error)
    }

    pub fn diagnostics(&self) -> JsValue {
        serde_wasm_bindgen::to_value(&self.backend.diagnostics()).unwrap_or(JsValue::NULL)
    }
}

impl WgpuSpiceRuntime {
    pub(crate) fn submit_native_batch(&mut self, batch: &GpuCommandBatch) -> Result<(), String> {
        self.backend.submit_batch(batch)
    }

    pub(crate) fn resize_native(&mut self, width: u32, height: u32) -> Result<(), String> {
        self.backend.resize(width, height)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn upload_native_rgba_rect(
        &mut self,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        dest: DrawRect,
        source: DrawRect,
        rop_descriptor: u16,
        scale_mode: u8,
        mask_present: bool,
        present: bool,
    ) -> Result<bool, String> {
        if mask_present {
            return Ok(false);
        }
        let Some(filter) = texture_filter(scale_mode) else {
            return Ok(false);
        };
        self.backend.upload_rgba_rect(
            bytes,
            source_width,
            source_height,
            dest,
            source,
            filter,
            rop_descriptor,
            present,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn upload_native_bitmap_rect(
        &mut self,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        stride: u32,
        format: u8,
        flags: u8,
        dest: DrawRect,
        source: DrawRect,
        rop_descriptor: u16,
        scale_mode: u8,
        mask_present: bool,
        present: bool,
    ) -> Result<bool, String> {
        if mask_present {
            return Ok(false);
        }
        let Some(filter) = texture_filter(scale_mode) else {
            return Ok(false);
        };
        self.backend.upload_bitmap_rect(
            bytes,
            source_width,
            source_height,
            stride,
            format,
            flags,
            dest,
            source,
            filter,
            rop_descriptor,
            present,
        )
    }

    pub(crate) fn upload_native_bitmap_batch(
        &mut self,
        uploads: &[NativeBitmapBatchUpload<'_>],
    ) -> Result<Vec<bool>, String> {
        self.backend.upload_bitmap_batch(uploads)
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn upload_external_image_native(
        &mut self,
        source: JsValue,
        source_width: u32,
        source_height: u32,
        dest: DrawRect,
        source_rect: DrawRect,
        rop_descriptor: u16,
        scale_mode: u8,
        mask_present: bool,
        present: bool,
    ) -> Result<bool, JsValue> {
        let source = source
            .dyn_into::<web_sys::ImageBitmap>()
            .map_err(|_| js_error("external upload expects ImageBitmap"))?;
        if mask_present {
            return Ok(false);
        }
        let Some(filter) = texture_filter(scale_mode) else {
            return Ok(false);
        };
        self.backend
            .upload_external_image_rect(
                source,
                source_width,
                source_height,
                dest,
                source_rect,
                filter,
                rop_descriptor,
                present,
            )
            .map_err(js_error)
    }
}

impl WgpuSpiceBackend {
    pub async fn from_offscreen_canvas(
        canvas: web_sys::OffscreenCanvas,
        width: u32,
        height: u32,
    ) -> Result<Self, JsValue> {
        let instance = wgpu::Instance::default();
        let surface: wgpu::Surface<'static> = instance
            .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas))
            .map_err(|error| js_error(format!("wgpu surface creation failed: {error}")))?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|error| js_error(format!("wgpu adapter request failed: {error}")))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("spice-wgpu-device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                ..Default::default()
            })
            .await
            .map_err(|error| js_error(format!("wgpu device request failed: {error}")))?;
        let config = surface
            .get_default_config(&adapter, width.max(1), height.max(1))
            .ok_or_else(|| js_error("wgpu surface has no supported default configuration"))?;
        surface.configure(&device, &config);

        let primary = PrimarySurface::new(
            &device,
            config.width.max(1),
            config.height.max(1),
            wgpu::TextureFormat::Rgba8Unorm,
        );
        let fill_pipeline = FillPipeline::new(&device, primary.format());
        let primary_rect_pipeline = TextureRectPipeline::new(&device, primary.format());
        let compute_blit_pipeline = ComputeBlitPipeline::new(&device);
        let compute_rop_blit_pipeline = ComputeRopBlitPipeline::new(&device);
        let compute_bitmap_blit_pipeline = ComputeBitmapBlitPipeline::new(&device);
        let compute_bitmap_unpack_pipeline = ComputeBitmapUnpackPipeline::new(&device);
        let present_rect_pipeline = TextureRectPipeline::new(&device, config.format);
        let mut runtime = WgpuRuntime {
            surface,
            adapter,
            device,
            queue,
            config,
            primary,
            fill_pipeline,
            primary_rect_pipeline,
            compute_blit_pipeline,
            compute_rop_blit_pipeline,
            compute_bitmap_blit_pipeline,
            compute_bitmap_unpack_pipeline,
            present_rect_pipeline,
            atlases: HashMap::new(),
            rgba_upload_textures: HashMap::new(),
            bitmap_upload_textures: HashMap::new(),
            external_upload_textures: HashMap::new(),
            submitted_batches: 0,
            presented_frames: 0,
            gpu_math_ops: 0,
            gpu_math_area: 0,
            gpu_compute_ops: 0,
            gpu_compute_area: 0,
            queue_submit_count: 0,
            empty_queue_submit_count: 0,
            texture_write_count: 0,
            texture_upload_bytes: 0,
            external_texture_copy_count: 0,
            compute_dispatch_count: 0,
            bitmap_compute_dispatch_count: 0,
            rgba_compute_dispatch_count: 0,
            rop_compute_dispatch_count: 0,
            render_pass_count: 0,
            present_render_pass_count: 0,
            upload_texture_cache_hits: 0,
            upload_texture_cache_misses: 0,
        };
        runtime.clear_primary()?;
        runtime.present_primary()?;

        Ok(Self {
            epoch: 1,
            runtime: Some(runtime),
        })
    }

    pub fn resize(&mut self, width: u32, height: u32) -> Result<(), String> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        let width = width.max(1);
        let height = height.max(1);
        if runtime.config.width == width && runtime.config.height == height {
            return Ok(());
        }
        runtime.config.width = width;
        runtime.config.height = height;
        runtime.surface.configure(&runtime.device, &runtime.config);
        runtime.primary = PrimarySurface::new(
            &runtime.device,
            width,
            height,
            wgpu::TextureFormat::Rgba8Unorm,
        );
        runtime.clear_primary()?;
        runtime.present_primary()?;
        self.reset_epoch();
        Ok(())
    }

    fn diagnostics(&self) -> WgpuDiagnostics {
        let Some(runtime) = self.runtime.as_ref() else {
            return WgpuDiagnostics {
                initialized: false,
                epoch: self.epoch,
                width: 0,
                height: 0,
                atlas_count: 0,
                submitted_batches: 0,
                presented_frames: 0,
                gpu_math_ops: 0,
                gpu_math_area: 0,
                gpu_compute_ops: 0,
                gpu_compute_area: 0,
                queue_submit_count: 0,
                empty_queue_submit_count: 0,
                texture_write_count: 0,
                texture_upload_bytes: 0,
                external_texture_copy_count: 0,
                compute_dispatch_count: 0,
                bitmap_compute_dispatch_count: 0,
                rgba_compute_dispatch_count: 0,
                rop_compute_dispatch_count: 0,
                render_pass_count: 0,
                present_render_pass_count: 0,
                max_texture_dimension2d: 0,
                max_bind_groups: 0,
                upload_texture_cache_hits: 0,
                upload_texture_cache_misses: 0,
            };
        };
        let limits = runtime.adapter.limits();
        WgpuDiagnostics {
            initialized: true,
            epoch: self.epoch,
            width: runtime.primary.width(),
            height: runtime.primary.height(),
            atlas_count: runtime.atlases.len() as u32,
            submitted_batches: runtime.submitted_batches,
            presented_frames: runtime.presented_frames,
            gpu_math_ops: runtime.gpu_math_ops,
            gpu_math_area: runtime.gpu_math_area,
            gpu_compute_ops: runtime.gpu_compute_ops,
            gpu_compute_area: runtime.gpu_compute_area,
            queue_submit_count: runtime.queue_submit_count,
            empty_queue_submit_count: runtime.empty_queue_submit_count,
            texture_write_count: runtime.texture_write_count,
            texture_upload_bytes: runtime.texture_upload_bytes,
            external_texture_copy_count: runtime.external_texture_copy_count,
            compute_dispatch_count: runtime.compute_dispatch_count,
            bitmap_compute_dispatch_count: runtime.bitmap_compute_dispatch_count,
            rgba_compute_dispatch_count: runtime.rgba_compute_dispatch_count,
            rop_compute_dispatch_count: runtime.rop_compute_dispatch_count,
            render_pass_count: runtime.render_pass_count,
            present_render_pass_count: runtime.present_render_pass_count,
            max_texture_dimension2d: limits.max_texture_dimension_2d,
            max_bind_groups: limits.max_bind_groups,
            upload_texture_cache_hits: runtime.upload_texture_cache_hits,
            upload_texture_cache_misses: runtime.upload_texture_cache_misses,
        }
    }

    fn configure_atlas_runtime(runtime: &mut WgpuRuntime, config: GpuAtlasConfig) {
        if runtime
            .atlases
            .get(&config.atlas_id)
            .is_some_and(|atlas| atlas.config == config)
        {
            return;
        }
        let texture = runtime.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("spice-atlas"),
            size: wgpu::Extent3d {
                width: config.width.max(1),
                height: config.height.max(1),
                depth_or_array_layers: config.layers.max(1),
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: texture_format(config.format),
            usage: wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::STORAGE_BINDING,
            view_formats: &[],
        });
        if let Some(old) = runtime
            .atlases
            .insert(config.atlas_id, WgpuAtlas { config, texture })
        {
            old.destroy();
        }
    }

    fn render_fills(&mut self, fills: &[FillDraw]) -> Result<(), String> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        runtime.render_fills(fills)
    }

    fn upload_rgba_rect(
        &mut self,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        dest: DrawRect,
        source: DrawRect,
        filter: TextureFilter,
        rop_descriptor: u16,
        present: bool,
    ) -> Result<bool, String> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        runtime.upload_rgba_rect(
            bytes,
            source_width,
            source_height,
            dest,
            source,
            filter,
            rop_descriptor,
            present,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn upload_bitmap_rect(
        &mut self,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        stride: u32,
        format: u8,
        flags: u8,
        dest: DrawRect,
        source: DrawRect,
        filter: TextureFilter,
        rop_descriptor: u16,
        present: bool,
    ) -> Result<bool, String> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        runtime.upload_bitmap_rect(
            bytes,
            source_width,
            source_height,
            stride,
            format,
            flags,
            dest,
            source,
            filter,
            rop_descriptor,
            present,
        )
    }

    fn upload_bitmap_batch(
        &mut self,
        uploads: &[NativeBitmapBatchUpload<'_>],
    ) -> Result<Vec<bool>, String> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        runtime.upload_bitmap_batch(uploads)
    }

    fn upload_external_image_rect(
        &mut self,
        image: web_sys::ImageBitmap,
        source_width: u32,
        source_height: u32,
        dest: DrawRect,
        source: DrawRect,
        filter: TextureFilter,
        rop_descriptor: u16,
        present: bool,
    ) -> Result<bool, String> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        runtime.upload_external_image_rect(
            image,
            source_width,
            source_height,
            dest,
            source,
            filter,
            rop_descriptor,
            present,
        )
    }

    fn present_primary_now(&mut self) -> Result<(), String> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        runtime.present_primary()
    }

    fn copy_primary_rect_from_origin(
        &mut self,
        dest: DrawRect,
        src_left: i32,
        src_top: i32,
    ) -> Result<bool, String> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        let Some(source) = source_rect_from_dest(dest, src_left, src_top) else {
            return Ok(false);
        };
        runtime.copy_primary_rect(dest, source, true)
    }
}

impl SpiceGpuBackend for WgpuSpiceBackend {
    type Error = String;

    fn configure_surface(&mut self, surface: GpuSurfaceKey, width: u32, height: u32) {
        if is_primary_surface(surface) {
            let _ = self.resize(width, height);
        }
    }

    fn configure_atlas(&mut self, config: GpuAtlasConfig) {
        if let Some(runtime) = self.runtime.as_mut() {
            Self::configure_atlas_runtime(runtime, config);
        }
    }

    fn destroy_surface(&mut self, surface: GpuSurfaceKey) {
        if is_primary_surface(surface) {
            self.reset_epoch();
        }
    }

    fn submit_batch(&mut self, batch: &GpuCommandBatch) -> Result<(), Self::Error> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        if !is_primary_surface(batch.surface) {
            return Err(format!(
                "wgpu backend only supports display surface {PRIMARY_SURFACE_ID}"
            ));
        }

        let mut fills = Vec::new();
        let mut mutated = false;
        let mut presented = false;
        for command in &batch.commands {
            match command {
                GpuCommand::EnsureAtlas { config } => {
                    Self::configure_atlas_runtime(runtime, *config);
                }
                GpuCommand::Fill {
                    token,
                    color,
                    rop_descriptor,
                } => {
                    if !is_primary_surface(token.surface) {
                        return Err(format!(
                            "wgpu fill only supports display surface {PRIMARY_SURFACE_ID}"
                        ));
                    }
                    if *rop_descriptor != SPICE_ROPD_OP_PUT {
                        return Err(format!("unsupported wgpu fill ROP: {rop_descriptor}"));
                    }
                    fills.push(FillDraw {
                        dest: token.dest,
                        color: *color,
                    });
                }
                GpuCommand::CopySurface {
                    token,
                    source,
                    source_rect,
                } => {
                    flush_fills(runtime, &mut fills, &mut mutated)?;
                    if !is_primary_surface(token.surface) || !is_primary_surface(*source) {
                        return Err(format!(
                            "wgpu copySurface only supports display surface {PRIMARY_SURFACE_ID}"
                        ));
                    }
                    if !runtime.copy_primary_rect(token.dest, *source_rect, false)? {
                        return Err("unsupported wgpu copySurface rectangle".to_string());
                    }
                    mutated = true;
                }
                GpuCommand::Present { surface, .. } => {
                    flush_fills(runtime, &mut fills, &mut mutated)?;
                    if !is_primary_surface(*surface) {
                        return Err(format!(
                            "wgpu present only supports display surface {PRIMARY_SURFACE_ID}"
                        ));
                    }
                    runtime.present_primary()?;
                    presented = true;
                }
                _ => {
                    return Err(format!(
                        "wgpu backend command is not implemented yet: {}",
                        command_name(command)
                    ));
                }
            }
        }

        flush_fills(runtime, &mut fills, &mut mutated)?;
        if mutated && !presented {
            runtime.present_primary()?;
        }
        runtime.submitted_batches = runtime.submitted_batches.saturating_add(1);
        Ok(())
    }

    fn present(&mut self, surface: GpuSurfaceKey) -> Result<(), Self::Error> {
        let Some(runtime) = self.runtime.as_mut() else {
            return Err("wgpu backend is not initialized".to_string());
        };
        if !is_primary_surface(surface) {
            return Err(format!(
                "wgpu present only supports display surface {PRIMARY_SURFACE_ID}"
            ));
        }
        runtime.present_primary()
    }

    fn reset_epoch(&mut self) {
        self.epoch = self.epoch.saturating_add(1);
    }
}

impl WgpuRuntime {
    fn clear_primary(&mut self) -> Result<(), String> {
        let view = self.primary.view();
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("spice-clear-primary"),
            });
        {
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("spice-clear-primary-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
        }
        self.queue.submit(Some(encoder.finish()));
        self.queue_submit_count = self.queue_submit_count.saturating_add(1);
        self.render_pass_count = self.render_pass_count.saturating_add(1);
        Ok(())
    }

    fn render_fills(&mut self, fills: &[FillDraw]) -> Result<(), String> {
        self.draw_fills(fills)?;
        self.present_primary()
    }

    fn draw_fills(&mut self, fills: &[FillDraw]) -> Result<(), String> {
        if fills.is_empty() {
            return Ok(());
        }
        let view = self.primary.view();
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("spice-fill-primary-batch"),
            });
        let rendered = self.fill_pipeline.render(
            &self.device,
            &self.queue,
            &mut encoder,
            &view,
            self.primary.width(),
            self.primary.height(),
            fills,
        )?;
        self.queue.submit(Some(encoder.finish()));
        self.queue_submit_count = self.queue_submit_count.saturating_add(1);
        self.render_pass_count = self.render_pass_count.saturating_add(1);
        self.gpu_math_ops = self.gpu_math_ops.saturating_add(rendered as u64);
        for fill in fills {
            if let Some(rect) =
                TextureRect::from_draw_rect(fill.dest, self.primary.width(), self.primary.height())
            {
                self.gpu_math_area = self.gpu_math_area.saturating_add(rect.area());
            }
        }
        Ok(())
    }

    fn upload_rgba_rect(
        &mut self,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        dest: DrawRect,
        source: DrawRect,
        filter: TextureFilter,
        rop_descriptor: u16,
        present: bool,
    ) -> Result<bool, String> {
        let source_width = source_width.max(1);
        let source_height = source_height.max(1);
        let expected_len = rgba_len(source_width, source_height)?;
        if bytes.len() != expected_len {
            return Ok(false);
        }
        let Some(blit) = BlitRect::new(
            dest,
            source,
            self.primary.width(),
            self.primary.height(),
            source_width,
            source_height,
        ) else {
            return Ok(false);
        };
        let key = UploadTextureKey {
            width: source_width,
            height: source_height,
            format: UploadTextureFormat::Rgba8Unorm,
        };
        let upload =
            self.take_upload_texture(UploadTextureCacheKind::Rgba, key, "spice-rgba-upload");
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &upload,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(source_width * 4),
                rows_per_image: Some(source_height),
            },
            wgpu::Extent3d {
                width: source_width,
                height: source_height,
                depth_or_array_layers: 1,
            },
        );
        self.texture_write_count = self.texture_write_count.saturating_add(1);
        self.texture_upload_bytes = self.texture_upload_bytes.saturating_add(bytes.len() as u64);
        self.render_texture_to_primary(&upload, blit, filter, rop_descriptor, present)?;
        self.recycle_upload_texture(UploadTextureCacheKind::Rgba, key, upload);
        Ok(true)
    }

    #[allow(clippy::too_many_arguments)]
    fn upload_bitmap_rect(
        &mut self,
        bytes: &[u8],
        source_width: u32,
        source_height: u32,
        stride: u32,
        format: u8,
        flags: u8,
        dest: DrawRect,
        source: DrawRect,
        _filter: TextureFilter,
        rop_descriptor: u16,
        present: bool,
    ) -> Result<bool, String> {
        if format != SPICE_BITMAP_FMT_32BIT && format != SPICE_BITMAP_FMT_RGBA {
            return Ok(false);
        }
        let source_width = source_width.max(1);
        let source_height = source_height.max(1);
        let min_stride = source_width
            .checked_mul(4)
            .ok_or_else(|| "bitmap stride overflowed".to_string())?;
        if stride < min_stride {
            return Ok(false);
        }
        let min_len = stride
            .checked_mul(source_height.saturating_sub(1))
            .and_then(|len| len.checked_add(min_stride))
            .and_then(|len| usize::try_from(len).ok())
            .ok_or_else(|| "bitmap upload dimensions overflowed".to_string())?;
        if bytes.len() < min_len {
            return Ok(false);
        }
        let Some(blit) = BlitRect::new(
            dest,
            source,
            self.primary.width(),
            self.primary.height(),
            source_width,
            source_height,
        ) else {
            return Ok(false);
        };
        let key = UploadTextureKey {
            width: source_width,
            height: source_height,
            format: UploadTextureFormat::Bgra8Unorm,
        };
        let upload = self.take_upload_texture(
            UploadTextureCacheKind::Bitmap,
            key,
            "spice-bitmap-upload-bgra",
        );
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &upload,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(stride),
                rows_per_image: Some(source_height),
            },
            wgpu::Extent3d {
                width: source_width,
                height: source_height,
                depth_or_array_layers: 1,
            },
        );
        self.texture_write_count = self.texture_write_count.saturating_add(1);
        self.texture_upload_bytes = self.texture_upload_bytes.saturating_add(bytes.len() as u64);
        let top_down =
            (flags & SPICE_BITMAP_FLAGS_TOP_DOWN) != 0 || format == SPICE_BITMAP_FMT_RGBA;
        let preserve_alpha = format == SPICE_BITMAP_FMT_RGBA;
        self.render_bitmap_texture_to_primary(
            &upload,
            blit,
            rop_descriptor,
            top_down,
            preserve_alpha,
            present,
        )?;
        self.recycle_upload_texture(UploadTextureCacheKind::Bitmap, key, upload);
        Ok(true)
    }

    fn upload_bitmap_batch(
        &mut self,
        uploads: &[NativeBitmapBatchUpload<'_>],
    ) -> Result<Vec<bool>, String> {
        let mut results = vec![false; uploads.len()];
        let mut prepared = Vec::with_capacity(uploads.len().min(256));
        let mut pending_unpack = PendingBitmapUnpackBatch::new();
        let limits = self.device.limits();
        for (index, upload) in uploads.iter().enumerate() {
            if upload.mask_present
                || upload.rop_descriptor != SPICE_ROPD_OP_PUT
                || texture_filter(upload.scale_mode).is_none()
                || (upload.format != SPICE_BITMAP_FMT_32BIT
                    && upload.format != SPICE_BITMAP_FMT_RGBA)
            {
                continue;
            }
            let source_width = upload.source_width.max(1);
            let source_height = upload.source_height.max(1);
            let min_stride = source_width
                .checked_mul(4)
                .ok_or_else(|| "bitmap batch stride overflowed".to_string())?;
            if upload.stride < min_stride {
                continue;
            }
            let min_len = upload
                .stride
                .checked_mul(source_height.saturating_sub(1))
                .and_then(|len| len.checked_add(min_stride))
                .and_then(|len| usize::try_from(len).ok())
                .ok_or_else(|| "bitmap batch upload dimensions overflowed".to_string())?;
            if upload.bytes.len() < min_len {
                continue;
            }
            let Some(blit) = BlitRect::new(
                upload.dest,
                upload.source,
                self.primary.width(),
                self.primary.height(),
                source_width,
                source_height,
            ) else {
                continue;
            };
            let top_down = (upload.flags & SPICE_BITMAP_FLAGS_TOP_DOWN) != 0
                || upload.format == SPICE_BITMAP_FMT_RGBA;
            let preserve_alpha = upload.format == SPICE_BITMAP_FMT_RGBA;
            let unpack_buffer_size = u64::try_from(min_len.max(4))
                .map_err(|_| "bitmap unpack source too large".to_string())?;
            let can_buffer_unpack = upload.buffer_unpack
                && upload.stride % 4 == 0
                && unpack_buffer_size <= limits.max_storage_buffer_binding_size
                && unpack_buffer_size <= limits.max_buffer_size;

            if can_buffer_unpack {
                if !pending_unpack.can_append(min_len, blit.dest, &limits) {
                    flush_pending_bitmap_unpack_batch(
                        &mut pending_unpack,
                        &mut prepared,
                        &self.device,
                        &self.queue,
                    )?;
                }
                if pending_unpack.can_append(min_len, blit.dest, &limits) {
                    pending_unpack.append(
                        index,
                        &upload.bytes[..min_len],
                        source_width,
                        source_height,
                        upload.stride / 4,
                        blit,
                        top_down,
                        preserve_alpha,
                        upload.present,
                    )?;
                    self.texture_upload_bytes =
                        self.texture_upload_bytes.saturating_add(min_len as u64);
                    continue;
                }
            }

            flush_pending_bitmap_unpack_batch(
                &mut pending_unpack,
                &mut prepared,
                &self.device,
                &self.queue,
            )?;

            let key = UploadTextureKey {
                width: source_width,
                height: source_height,
                format: UploadTextureFormat::Bgra8Unorm,
            };
            let texture = self.take_upload_texture(
                UploadTextureCacheKind::Bitmap,
                key,
                "spice-bitmap-batch-upload-bgra",
            );
            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                upload.bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(upload.stride),
                    rows_per_image: Some(source_height),
                },
                wgpu::Extent3d {
                    width: source_width,
                    height: source_height,
                    depth_or_array_layers: 1,
                },
            );
            self.texture_write_count = self.texture_write_count.saturating_add(1);
            self.texture_upload_bytes = self
                .texture_upload_bytes
                .saturating_add(upload.bytes.len() as u64);
            prepared.push(PreparedBitmapWork::Texture(PreparedBitmapUpload {
                index,
                key,
                texture,
                blit,
                top_down,
                preserve_alpha,
                present: upload.present,
            }));
        }
        flush_pending_bitmap_unpack_batch(
            &mut pending_unpack,
            &mut prepared,
            &self.device,
            &self.queue,
        )?;

        if prepared.is_empty() {
            return Ok(results);
        }

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("spice-compute-bitmap-primary-batch"),
            });
        for upload in &prepared {
            match upload {
                PreparedBitmapWork::Texture(upload) => {
                    self.compute_bitmap_blit_pipeline.dispatch(
                        &self.device,
                        &mut encoder,
                        &upload.texture,
                        &upload.texture,
                        self.primary.texture(),
                        upload.blit,
                        SPICE_ROPD_OP_PUT,
                        upload.top_down,
                        upload.preserve_alpha,
                    );
                    let area = upload.blit.dest.area();
                    self.gpu_math_ops = self.gpu_math_ops.saturating_add(1);
                    self.gpu_math_area = self.gpu_math_area.saturating_add(area);
                    self.gpu_compute_ops = self.gpu_compute_ops.saturating_add(1);
                    self.gpu_compute_area = self.gpu_compute_area.saturating_add(area);
                    self.compute_dispatch_count = self.compute_dispatch_count.saturating_add(1);
                    self.bitmap_compute_dispatch_count =
                        self.bitmap_compute_dispatch_count.saturating_add(1);
                    results[upload.index] = true;
                }
                PreparedBitmapWork::BufferUnpack(upload) => {
                    self.compute_bitmap_unpack_pipeline.dispatch(
                        &self.device,
                        &mut encoder,
                        &upload.source_buffer,
                        &upload.params_buffer,
                        self.primary.texture(),
                        upload.max_width,
                        upload.max_height,
                        upload.items.len() as u32,
                    );
                    self.compute_dispatch_count = self.compute_dispatch_count.saturating_add(1);
                    self.bitmap_compute_dispatch_count =
                        self.bitmap_compute_dispatch_count.saturating_add(1);
                    for item in &upload.items {
                        self.gpu_math_ops = self.gpu_math_ops.saturating_add(1);
                        self.gpu_math_area = self.gpu_math_area.saturating_add(item.area);
                        self.gpu_compute_ops = self.gpu_compute_ops.saturating_add(1);
                        self.gpu_compute_area = self.gpu_compute_area.saturating_add(item.area);
                        results[item.index] = true;
                    }
                }
            }
        }
        let present_frame = if prepared.iter().any(PreparedBitmapWork::present) {
            Some(self.encode_present_primary(&mut encoder)?)
        } else {
            None
        };
        self.queue.submit(Some(encoder.finish()));
        self.queue_submit_count = self.queue_submit_count.saturating_add(1);
        if let Some((frame, present_area)) = present_frame {
            self.finish_encoded_present(frame, present_area);
        }

        let mut recycled_keys = HashSet::new();
        for upload in prepared {
            match upload {
                PreparedBitmapWork::Texture(upload) => {
                    if recycled_keys.insert(upload.key) {
                        self.recycle_upload_texture(
                            UploadTextureCacheKind::Bitmap,
                            upload.key,
                            upload.texture,
                        );
                    }
                }
                PreparedBitmapWork::BufferUnpack(upload) => {
                    upload.source_buffer.destroy();
                    upload.params_buffer.destroy();
                }
            }
        }

        Ok(results)
    }

    fn upload_external_image_rect(
        &mut self,
        image: web_sys::ImageBitmap,
        source_width: u32,
        source_height: u32,
        dest: DrawRect,
        source: DrawRect,
        filter: TextureFilter,
        rop_descriptor: u16,
        present: bool,
    ) -> Result<bool, String> {
        let source_width = source_width.max(1).min(image.width().max(1));
        let source_height = source_height.max(1).min(image.height().max(1));
        let Some(blit) = BlitRect::new(
            dest,
            source,
            self.primary.width(),
            self.primary.height(),
            source_width,
            source_height,
        ) else {
            return Ok(false);
        };
        let key = UploadTextureKey {
            width: source_width,
            height: source_height,
            format: UploadTextureFormat::Rgba8Unorm,
        };
        let upload = self.take_upload_texture(
            UploadTextureCacheKind::External,
            key,
            "spice-external-image-upload",
        );
        self.queue.copy_external_image_to_texture(
            &wgpu::CopyExternalImageSourceInfo {
                source: wgpu::ExternalImageSource::ImageBitmap(image),
                origin: wgpu::Origin2d::ZERO,
                flip_y: false,
            },
            wgpu::CopyExternalImageDestInfo {
                texture: &upload,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
                color_space: wgpu::PredefinedColorSpace::Srgb,
                premultiplied_alpha: false,
            },
            wgpu::Extent3d {
                width: source_width,
                height: source_height,
                depth_or_array_layers: 1,
            },
        );
        self.external_texture_copy_count = self.external_texture_copy_count.saturating_add(1);
        self.queue.submit([]);
        self.queue_submit_count = self.queue_submit_count.saturating_add(1);
        self.empty_queue_submit_count = self.empty_queue_submit_count.saturating_add(1);
        self.render_texture_to_primary(&upload, blit, filter, rop_descriptor, present)?;
        self.recycle_upload_texture(UploadTextureCacheKind::External, key, upload);
        Ok(true)
    }

    fn copy_primary_rect(
        &mut self,
        dest: DrawRect,
        source: DrawRect,
        present: bool,
    ) -> Result<bool, String> {
        let Some(copy) =
            TextureRect::copy_rect(dest, source, self.primary.width(), self.primary.height())
        else {
            return Ok(false);
        };
        let scratch = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("spice-primary-copy-scratch"),
            size: wgpu::Extent3d {
                width: copy.source.width,
                height: copy.source.height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.primary.format(),
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("spice-copy-primary-rect"),
            });
        encoder.copy_texture_to_texture(
            wgpu::TexelCopyTextureInfo {
                texture: self.primary.texture(),
                mip_level: 0,
                origin: copy.source.origin(),
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyTextureInfo {
                texture: &scratch,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            copy.source.extent(),
        );
        let target_view = self.primary.view();
        self.primary_rect_pipeline.render(
            &self.device,
            &mut encoder,
            &scratch,
            &target_view,
            copy.dest,
            TextureRect::unit_uv(),
            TextureFilter::Nearest,
        );
        self.queue.submit(Some(encoder.finish()));
        self.queue_submit_count = self.queue_submit_count.saturating_add(1);
        self.render_pass_count = self.render_pass_count.saturating_add(1);
        self.gpu_math_ops = self.gpu_math_ops.saturating_add(1);
        self.gpu_math_area = self.gpu_math_area.saturating_add(copy.dest.area());
        if present {
            self.present_primary()?;
        }
        Ok(true)
    }

    fn render_texture_to_primary(
        &mut self,
        source_texture: &wgpu::Texture,
        blit: BlitRect,
        _filter: TextureFilter,
        rop_descriptor: u16,
        present: bool,
    ) -> Result<(), String> {
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("spice-compute-upload-rgba-primary"),
            });
        if rop_descriptor == SPICE_ROPD_OP_PUT {
            self.compute_blit_pipeline.dispatch(
                &self.device,
                &mut encoder,
                source_texture,
                self.primary.texture(),
                blit,
            );
            self.rgba_compute_dispatch_count = self.rgba_compute_dispatch_count.saturating_add(1);
        } else {
            let dest_snapshot = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("spice-rop-dest-snapshot"),
                size: wgpu::Extent3d {
                    width: blit.dest.width,
                    height: blit.dest.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.primary.format(),
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: self.primary.texture(),
                    mip_level: 0,
                    origin: blit.dest.origin(),
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: &dest_snapshot,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                blit.dest.extent(),
            );
            self.compute_rop_blit_pipeline.dispatch(
                &self.device,
                &mut encoder,
                source_texture,
                &dest_snapshot,
                self.primary.texture(),
                blit,
                rop_descriptor,
            );
            self.rop_compute_dispatch_count = self.rop_compute_dispatch_count.saturating_add(1);
        }
        let present_frame = if present {
            Some(self.encode_present_primary(&mut encoder)?)
        } else {
            None
        };
        self.queue.submit(Some(encoder.finish()));
        self.queue_submit_count = self.queue_submit_count.saturating_add(1);
        self.gpu_math_ops = self.gpu_math_ops.saturating_add(1);
        self.gpu_math_area = self.gpu_math_area.saturating_add(blit.dest.area());
        self.gpu_compute_ops = self.gpu_compute_ops.saturating_add(1);
        self.gpu_compute_area = self.gpu_compute_area.saturating_add(blit.dest.area());
        self.compute_dispatch_count = self.compute_dispatch_count.saturating_add(1);
        if let Some((frame, present_area)) = present_frame {
            self.finish_encoded_present(frame, present_area);
        }
        Ok(())
    }

    fn render_bitmap_texture_to_primary(
        &mut self,
        source_texture: &wgpu::Texture,
        blit: BlitRect,
        rop_descriptor: u16,
        top_down: bool,
        preserve_alpha: bool,
        present: bool,
    ) -> Result<(), String> {
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("spice-compute-upload-bitmap-primary"),
            });
        let dest_snapshot;
        let dest_texture = if rop_descriptor == SPICE_ROPD_OP_PUT {
            source_texture
        } else {
            dest_snapshot = self.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("spice-bitmap-rop-dest-snapshot"),
                size: wgpu::Extent3d {
                    width: blit.dest.width,
                    height: blit.dest.height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.primary.format(),
                usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            encoder.copy_texture_to_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: self.primary.texture(),
                    mip_level: 0,
                    origin: blit.dest.origin(),
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyTextureInfo {
                    texture: &dest_snapshot,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                blit.dest.extent(),
            );
            &dest_snapshot
        };
        self.compute_bitmap_blit_pipeline.dispatch(
            &self.device,
            &mut encoder,
            source_texture,
            dest_texture,
            self.primary.texture(),
            blit,
            rop_descriptor,
            top_down,
            preserve_alpha,
        );
        let present_frame = if present {
            Some(self.encode_present_primary(&mut encoder)?)
        } else {
            None
        };
        self.queue.submit(Some(encoder.finish()));
        self.queue_submit_count = self.queue_submit_count.saturating_add(1);
        self.gpu_math_ops = self.gpu_math_ops.saturating_add(1);
        self.gpu_math_area = self.gpu_math_area.saturating_add(blit.dest.area());
        self.gpu_compute_ops = self.gpu_compute_ops.saturating_add(1);
        self.gpu_compute_area = self.gpu_compute_area.saturating_add(blit.dest.area());
        self.compute_dispatch_count = self.compute_dispatch_count.saturating_add(1);
        self.bitmap_compute_dispatch_count = self.bitmap_compute_dispatch_count.saturating_add(1);
        if let Some((frame, present_area)) = present_frame {
            self.finish_encoded_present(frame, present_area);
        }
        Ok(())
    }

    fn present_primary(&mut self) -> Result<(), String> {
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("spice-present-primary"),
            });
        let (frame, present_area) = self.encode_present_primary(&mut encoder)?;
        self.queue.submit(Some(encoder.finish()));
        self.queue_submit_count = self.queue_submit_count.saturating_add(1);
        self.finish_encoded_present(frame, present_area);
        Ok(())
    }

    fn encode_present_primary(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
    ) -> Result<(wgpu::SurfaceTexture, u64), String> {
        let frame = self.current_surface_texture()?;
        let dest = TextureRect {
            x: 0,
            y: 0,
            width: self.config.width,
            height: self.config.height,
        };
        {
            let view = frame
                .texture
                .create_view(&wgpu::TextureViewDescriptor::default());
            self.present_rect_pipeline.render(
                &self.device,
                encoder,
                self.primary.texture(),
                &view,
                dest,
                TextureRect::unit_uv(),
                TextureFilter::Nearest,
            );
        }
        Ok((
            frame,
            u64::from(dest.width).saturating_mul(u64::from(dest.height)),
        ))
    }

    fn finish_encoded_present(&mut self, frame: wgpu::SurfaceTexture, present_area: u64) {
        self.render_pass_count = self.render_pass_count.saturating_add(1);
        self.present_render_pass_count = self.present_render_pass_count.saturating_add(1);
        frame.present();
        self.presented_frames = self.presented_frames.saturating_add(1);
        self.gpu_math_ops = self.gpu_math_ops.saturating_add(1);
        self.gpu_math_area = self.gpu_math_area.saturating_add(present_area);
    }

    fn current_surface_texture(&mut self) -> Result<wgpu::SurfaceTexture, String> {
        match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => Ok(frame),
            wgpu::CurrentSurfaceTexture::Outdated | wgpu::CurrentSurfaceTexture::Lost => {
                self.surface.configure(&self.device, &self.config);
                match self.surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(frame)
                    | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => Ok(frame),
                    _ => Err("wgpu surface texture unavailable after reconfigure".to_string()),
                }
            }
            wgpu::CurrentSurfaceTexture::Timeout => {
                Err("wgpu surface texture acquisition timed out".to_string())
            }
            wgpu::CurrentSurfaceTexture::Occluded => {
                Err("wgpu surface is occluded; skipping present".to_string())
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                Err("wgpu surface texture validation failed".to_string())
            }
        }
    }

    fn take_upload_texture(
        &mut self,
        kind: UploadTextureCacheKind,
        key: UploadTextureKey,
        label: &'static str,
    ) -> wgpu::Texture {
        let cached = match kind {
            UploadTextureCacheKind::Rgba => self.rgba_upload_textures.remove(&key),
            UploadTextureCacheKind::Bitmap => self.bitmap_upload_textures.remove(&key),
            UploadTextureCacheKind::External => self.external_upload_textures.remove(&key),
        };
        if let Some(texture) = cached {
            self.upload_texture_cache_hits = self.upload_texture_cache_hits.saturating_add(1);
            return texture;
        }

        self.upload_texture_cache_misses = self.upload_texture_cache_misses.saturating_add(1);
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: key.width.max(1),
                height: key.height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: key.format.texture_format(),
            usage: wgpu::TextureUsages::COPY_DST | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
    }

    fn recycle_upload_texture(
        &mut self,
        kind: UploadTextureCacheKind,
        key: UploadTextureKey,
        texture: wgpu::Texture,
    ) {
        let cache = match kind {
            UploadTextureCacheKind::Rgba => &mut self.rgba_upload_textures,
            UploadTextureCacheKind::Bitmap => &mut self.bitmap_upload_textures,
            UploadTextureCacheKind::External => &mut self.external_upload_textures,
        };
        if cache.len() >= MAX_UPLOAD_TEXTURE_CACHE_ENTRIES {
            cache.clear();
        }
        if let Some(old) = cache.insert(key, texture) {
            old.destroy();
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WgpuDiagnostics {
    initialized: bool,
    epoch: u64,
    width: u32,
    height: u32,
    atlas_count: u32,
    submitted_batches: u64,
    presented_frames: u64,
    gpu_math_ops: u64,
    gpu_math_area: u64,
    gpu_compute_ops: u64,
    gpu_compute_area: u64,
    queue_submit_count: u64,
    empty_queue_submit_count: u64,
    texture_write_count: u64,
    texture_upload_bytes: u64,
    external_texture_copy_count: u64,
    compute_dispatch_count: u64,
    bitmap_compute_dispatch_count: u64,
    rgba_compute_dispatch_count: u64,
    rop_compute_dispatch_count: u64,
    render_pass_count: u64,
    present_render_pass_count: u64,
    max_texture_dimension2d: u32,
    max_bind_groups: u32,
    upload_texture_cache_hits: u64,
    upload_texture_cache_misses: u64,
}

fn flush_fills(
    runtime: &mut WgpuRuntime,
    fills: &mut Vec<FillDraw>,
    mutated: &mut bool,
) -> Result<(), String> {
    if fills.is_empty() {
        return Ok(());
    }
    runtime.draw_fills(fills)?;
    fills.clear();
    *mutated = true;
    Ok(())
}

fn source_rect_from_dest(dest: DrawRect, src_left: i32, src_top: i32) -> Option<DrawRect> {
    let width = dest.right.checked_sub(dest.left)?;
    let height = dest.bottom.checked_sub(dest.top)?;
    if width <= 0 || height <= 0 {
        return None;
    }
    Some(DrawRect {
        left: src_left,
        top: src_top,
        right: src_left.checked_add(width)?,
        bottom: src_top.checked_add(height)?,
    })
}

fn rgba_len(width: u32, height: u32) -> Result<usize, String> {
    width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .map(|len| len as usize)
        .ok_or_else(|| "RGBA upload dimensions overflowed".to_string())
}

fn texture_filter(scale_mode: u8) -> Option<TextureFilter> {
    match scale_mode {
        SCALE_MODE_NEAREST => Some(TextureFilter::Nearest),
        SCALE_MODE_LINEAR => Some(TextureFilter::Linear),
        _ => None,
    }
}

fn is_primary_surface(surface: GpuSurfaceKey) -> bool {
    surface.surface_id == PRIMARY_SURFACE_ID
}

fn command_name(command: &GpuCommand) -> &'static str {
    match command {
        GpuCommand::EnsureAtlas { .. } => "ensureAtlas",
        GpuCommand::UploadAtlas { .. } => "uploadAtlas",
        GpuCommand::DrawInstances { .. } => "drawInstances",
        GpuCommand::Fill { .. } => "fill",
        GpuCommand::CopyBitmap { .. } => "copyBitmap",
        GpuCommand::CopySurface { .. } => "copySurface",
        GpuCommand::ComputeColorConvert { .. } => "computeColorConvert",
        GpuCommand::ComputeDirtyRectFlatten { .. } => "computeDirtyRectFlatten",
        GpuCommand::Present { .. } => "present",
    }
}

fn js_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}
