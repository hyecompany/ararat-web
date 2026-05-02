/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::collections::VecDeque;

use wasm_bindgen::prelude::*;

use crate::display_draw::{DrawRect, ImagePayloadEnvelope};
use crate::display_events::{DisplayEvent, DisplayFrameHint, DisplayRect};
use crate::display_execution::{DrawCopyComposePlan, VisualExecutionPlan};
use crate::engine::{EngineEvents, SpiceEngine};
use crate::gpu::{NativeBitmapBatchUpload, WgpuSpiceRuntime};

const SPICE_BITMAP_FMT_32BIT: u8 = 8;
const SPICE_BITMAP_FMT_RGBA: u8 = 9;
const SPICE_BITMAP_FLAGS_TOP_DOWN: u8 = 4;
const SPICE_ROPD_OP_PUT: u16 = 8;
const MAX_PENDING_NATIVE_BITMAP_UPLOADS: usize = 2048;
const MAX_PENDING_NATIVE_BITMAP_UPLOAD_BYTES: usize = 160 * 1024 * 1024;

#[wasm_bindgen]
pub struct SpiceNativeRuntime {
    engine: SpiceEngine,
    gpu: WgpuSpiceRuntime,
    gpu_submitted_batches: u64,
    gpu_rejected_batches: u64,
    gpu_committed_tokens: u64,
    gpu_failed_commits: u64,
    native_decode_uploads: u64,
    native_decode_upload_rejects: u64,
    native_direct_bitmap_uploads: u64,
    pending_native_bitmap_uploads: VecDeque<PendingNativeBitmapUpload>,
    pending_native_bitmap_upload_bytes: usize,
    native_deferred_bitmap_uploads: u64,
    native_deferred_bitmap_commits: u64,
    native_deferred_bitmap_drops: u64,
    native_deferred_bitmap_peak_uploads: u64,
    native_deferred_bitmap_peak_bytes: u64,
    native_deferred_bitmap_flushes: u64,
    native_deferred_bitmap_flush_items: u64,
    native_deferred_bitmap_max_flush_items: u64,
    raw_bitmap_coalesce_mode: bool,
}

#[derive(Clone, Copy)]
struct NativeBitmapDrawMetadata {
    source: DrawRect,
    flags: u8,
    width: u32,
    height: u32,
    stride: u32,
    format: u8,
    data_length: u32,
    compose: DrawCopyComposePlan,
    video_like: bool,
    presented: bool,
    should_defer: bool,
}

struct PendingNativeBitmapUpload {
    sequence_id: u64,
    surface_id: u32,
    surface_generation: u32,
    commit_token: u64,
    bbox: DisplayRect,
    data_length: u32,
    source: DrawRect,
    compose: DrawCopyComposePlan,
    width: u32,
    height: u32,
    stride: u32,
    format: u8,
    flags: u8,
    video_like: bool,
    presented: bool,
    safe_replacement: bool,
    safe_to_drop_if_covered: bool,
    commit_tokens: Vec<u64>,
    data: Vec<u8>,
}

impl PendingNativeBitmapUpload {
    fn from_event(event: DisplayEvent, metadata: NativeBitmapDrawMetadata) -> Option<Self> {
        let DisplayEvent::Draw {
            sequence_id,
            surface_id,
            surface_generation,
            commit_token,
            bbox,
            image: Some(image),
            ..
        } = event
        else {
            return None;
        };
        let ImagePayloadEnvelope::Bitmap { data, .. } = image.payload else {
            return None;
        };
        Some(Self {
            sequence_id,
            surface_id,
            surface_generation,
            commit_token,
            bbox,
            data_length: metadata.data_length,
            source: metadata.source,
            compose: metadata.compose,
            width: metadata.width,
            height: metadata.height,
            stride: metadata.stride,
            format: metadata.format,
            flags: metadata.flags,
            video_like: metadata.video_like,
            presented: metadata.presented,
            safe_replacement: metadata.compose.rop_descriptor == SPICE_ROPD_OP_PUT,
            safe_to_drop_if_covered: metadata.compose.rop_descriptor == SPICE_ROPD_OP_PUT,
            commit_tokens: vec![commit_token],
            data,
        })
    }

    fn byte_len(&self) -> usize {
        self.data.len()
    }

    fn release_token_count(&self) -> u64 {
        self.commit_tokens.len() as u64
    }

    fn try_merge_adjacent_right(
        &mut self,
        mut right: PendingNativeBitmapUpload,
    ) -> Result<(), PendingNativeBitmapUpload> {
        if !can_merge_adjacent_pending_bitmap_uploads(self, &right) {
            return Err(right);
        }

        let left_row_bytes = match row_bytes(self.width) {
            Some(bytes) => bytes,
            None => return Err(right),
        };
        let right_row_bytes = match row_bytes(right.width) {
            Some(bytes) => bytes,
            None => return Err(right),
        };
        let combined_width = match self.width.checked_add(right.width) {
            Some(width) => width,
            None => return Err(right),
        };
        let combined_stride = match combined_width.checked_mul(4) {
            Some(stride) => stride,
            None => return Err(right),
        };
        let height = self.height as usize;
        let combined_stride_len = combined_stride as usize;
        let combined_len = match combined_stride_len.checked_mul(height) {
            Some(len) => len,
            None => return Err(right),
        };
        if combined_len > u32::MAX as usize {
            return Err(right);
        }
        if !bitmap_rows_are_readable(&self.data, self.stride, self.height, left_row_bytes)
            || !bitmap_rows_are_readable(&right.data, right.stride, right.height, right_row_bytes)
        {
            return Err(right);
        }

        let mut combined = vec![0; combined_len];
        for row in 0..height {
            let left_src = row * self.stride as usize;
            let right_src = row * right.stride as usize;
            let dst = row * combined_stride_len;
            combined[dst..dst + left_row_bytes]
                .copy_from_slice(&self.data[left_src..left_src + left_row_bytes]);
            combined[dst + left_row_bytes..dst + left_row_bytes + right_row_bytes]
                .copy_from_slice(&right.data[right_src..right_src + right_row_bytes]);
        }

        self.sequence_id = right.sequence_id;
        self.commit_token = right.commit_token;
        self.bbox.right = right.bbox.right;
        self.data_length = combined_len as u32;
        self.source.right = i32::try_from(combined_width).unwrap_or(i32::MAX);
        self.width = combined_width;
        self.stride = combined_stride;
        self.safe_replacement = self.safe_replacement && right.safe_replacement;
        self.safe_to_drop_if_covered =
            self.safe_to_drop_if_covered && right.safe_to_drop_if_covered;
        self.commit_tokens.append(&mut right.commit_tokens);
        self.data = combined;
        Ok(())
    }
}

#[wasm_bindgen]
impl SpiceNativeRuntime {
    #[wasm_bindgen(js_name = createForOffscreenCanvas)]
    pub async fn create_for_offscreen_canvas(
        canvas: web_sys::OffscreenCanvas,
        width: u32,
        height: u32,
    ) -> Result<SpiceNativeRuntime, JsValue> {
        Ok(Self {
            engine: SpiceEngine::new(),
            gpu: WgpuSpiceRuntime::create_for_offscreen_canvas(canvas, width, height).await?,
            gpu_submitted_batches: 0,
            gpu_rejected_batches: 0,
            gpu_committed_tokens: 0,
            gpu_failed_commits: 0,
            native_decode_uploads: 0,
            native_decode_upload_rejects: 0,
            native_direct_bitmap_uploads: 0,
            pending_native_bitmap_uploads: VecDeque::new(),
            pending_native_bitmap_upload_bytes: 0,
            native_deferred_bitmap_uploads: 0,
            native_deferred_bitmap_commits: 0,
            native_deferred_bitmap_drops: 0,
            native_deferred_bitmap_peak_uploads: 0,
            native_deferred_bitmap_peak_bytes: 0,
            native_deferred_bitmap_flushes: 0,
            native_deferred_bitmap_flush_items: 0,
            native_deferred_bitmap_max_flush_items: 0,
            raw_bitmap_coalesce_mode: false,
        })
    }

    pub fn open_channel(
        &mut self,
        channel_key: String,
        channel_type: u8,
        channel_id: u8,
        connection_id: u32,
    ) -> Vec<u8> {
        self.engine
            .open_channel(channel_key, channel_type, channel_id, connection_id)
    }

    pub fn submit_encrypted_ticket(&mut self, channel_key: String, ticket: &[u8]) -> Vec<u8> {
        self.engine.submit_encrypted_ticket(channel_key, ticket)
    }

    pub fn ingest_channel_bytes(&mut self, channel_key: String, bytes: &[u8]) -> JsValue {
        let mut events = self.engine.ingest_channel_bytes_native(channel_key, bytes);
        self.apply_native_display_hot_path(&mut events);
        self.engine.events_to_js(events)
    }

    #[wasm_bindgen(js_name = flushPendingNativeBitmapUploads)]
    pub fn flush_pending_native_bitmap_uploads(&mut self, max_items: u32) -> JsValue {
        let display_events =
            self.flush_pending_native_bitmap_uploads_internal(max_items.max(1) as usize);
        let mut events = EngineEvents::empty();
        *events.display_events_mut() = display_events;
        self.engine.events_to_js(events)
    }

    #[wasm_bindgen(js_name = setRawBitmapCoalesceMode)]
    pub fn set_raw_bitmap_coalesce_mode(&mut self, enabled: bool) {
        self.raw_bitmap_coalesce_mode = enabled;
    }

    #[wasm_bindgen(js_name = resizeNative)]
    pub fn resize_native(&mut self, width: u32, height: u32) -> Result<(), JsValue> {
        let _ = self.flush_pending_native_bitmap_uploads_internal(usize::MAX);
        self.gpu
            .resize_native(width.max(1), height.max(1))
            .map_err(|error| JsValue::from_str(&error))
    }

    pub fn control(&mut self, message: JsValue) -> JsValue {
        self.engine.control(message)
    }

    pub fn check_visual_token(&self, token: u64) -> bool {
        self.engine.check_visual_token_native(token)
    }

    pub fn commit_visual_token(&mut self, token: u64) -> bool {
        self.engine.commit_visual_token_native(token)
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = uploadExternalImageAndCommit)]
    pub fn upload_external_image_and_commit(
        &mut self,
        token: u64,
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
        present: bool,
    ) -> Result<bool, JsValue> {
        let _ = self.flush_pending_native_bitmap_uploads_internal(usize::MAX);
        if !self.engine.check_visual_token_native(token) {
            self.native_decode_upload_rejects = self.native_decode_upload_rejects.saturating_add(1);
            return Ok(false);
        }
        let uploaded = self.gpu.upload_external_image_native(
            source,
            source_width,
            source_height,
            DrawRect {
                left: dest_left,
                top: dest_top,
                right: dest_right,
                bottom: dest_bottom,
            },
            DrawRect {
                left: src_left,
                top: src_top,
                right: src_right,
                bottom: src_bottom,
            },
            rop_descriptor,
            scale_mode,
            mask_present,
            present,
        )?;
        if !uploaded {
            self.native_decode_upload_rejects = self.native_decode_upload_rejects.saturating_add(1);
            return Ok(false);
        }
        self.native_decode_uploads = self.native_decode_uploads.saturating_add(1);
        if self.engine.commit_visual_token_native(token) {
            self.gpu_committed_tokens = self.gpu_committed_tokens.saturating_add(1);
            Ok(true)
        } else {
            self.gpu_failed_commits = self.gpu_failed_commits.saturating_add(1);
            Ok(false)
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = uploadBitmapAndCommit)]
    pub fn upload_bitmap_and_commit(
        &mut self,
        token: u64,
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
        present: bool,
    ) -> Result<bool, JsValue> {
        let _ = self.flush_pending_native_bitmap_uploads_internal(usize::MAX);
        if !self.engine.check_visual_token_native(token) {
            self.native_decode_upload_rejects = self.native_decode_upload_rejects.saturating_add(1);
            return Ok(false);
        }
        let uploaded = self
            .gpu
            .upload_native_bitmap_rect(
                bytes,
                source_width,
                source_height,
                stride,
                format,
                flags,
                DrawRect {
                    left: dest_left,
                    top: dest_top,
                    right: dest_right,
                    bottom: dest_bottom,
                },
                DrawRect {
                    left: src_left,
                    top: src_top,
                    right: src_right,
                    bottom: src_bottom,
                },
                rop_descriptor,
                scale_mode,
                mask_present,
                present,
            )
            .map_err(|error| JsValue::from_str(&error))?;
        if !uploaded {
            self.native_decode_upload_rejects = self.native_decode_upload_rejects.saturating_add(1);
            return Ok(false);
        }
        self.native_decode_uploads = self.native_decode_uploads.saturating_add(1);
        self.native_direct_bitmap_uploads = self.native_direct_bitmap_uploads.saturating_add(1);
        if self.engine.commit_visual_token_native(token) {
            self.gpu_committed_tokens = self.gpu_committed_tokens.saturating_add(1);
            Ok(true)
        } else {
            self.gpu_failed_commits = self.gpu_failed_commits.saturating_add(1);
            Ok(false)
        }
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = uploadRgbaAndCommit)]
    pub fn upload_rgba_and_commit(
        &mut self,
        token: u64,
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
        present: bool,
    ) -> Result<bool, JsValue> {
        let _ = self.flush_pending_native_bitmap_uploads_internal(usize::MAX);
        if !self.engine.check_visual_token_native(token) {
            self.native_decode_upload_rejects = self.native_decode_upload_rejects.saturating_add(1);
            return Ok(false);
        }
        let uploaded = self
            .gpu
            .upload_native_rgba_rect(
                bytes,
                source_width,
                source_height,
                DrawRect {
                    left: dest_left,
                    top: dest_top,
                    right: dest_right,
                    bottom: dest_bottom,
                },
                DrawRect {
                    left: src_left,
                    top: src_top,
                    right: src_right,
                    bottom: src_bottom,
                },
                rop_descriptor,
                scale_mode,
                mask_present,
                present,
            )
            .map_err(|error| JsValue::from_str(&error))?;
        if !uploaded {
            self.native_decode_upload_rejects = self.native_decode_upload_rejects.saturating_add(1);
            return Ok(false);
        }
        self.native_decode_uploads = self.native_decode_uploads.saturating_add(1);
        if self.engine.commit_visual_token_native(token) {
            self.gpu_committed_tokens = self.gpu_committed_tokens.saturating_add(1);
            Ok(true)
        } else {
            self.gpu_failed_commits = self.gpu_failed_commits.saturating_add(1);
            Ok(false)
        }
    }

    #[wasm_bindgen(js_name = presentPrimary)]
    pub fn present_primary(&mut self) -> Result<bool, JsValue> {
        self.gpu.present_primary()?;
        Ok(true)
    }

    pub fn diagnostics(&mut self) -> JsValue {
        let engine = self.engine.diagnostics();
        let gpu = self.gpu.diagnostics();
        let out = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("engine"), &engine);
        let _ = js_sys::Reflect::set(&out, &JsValue::from_str("gpu"), &gpu);
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("gpuSubmittedBatches"),
            &JsValue::from_f64(self.gpu_submitted_batches as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("gpuRejectedBatches"),
            &JsValue::from_f64(self.gpu_rejected_batches as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("gpuCommittedTokens"),
            &JsValue::from_f64(self.gpu_committed_tokens as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("gpuFailedCommits"),
            &JsValue::from_f64(self.gpu_failed_commits as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDecodeUploads"),
            &JsValue::from_f64(self.native_decode_uploads as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDecodeUploadRejects"),
            &JsValue::from_f64(self.native_decode_upload_rejects as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDirectBitmapUploads"),
            &JsValue::from_f64(self.native_direct_bitmap_uploads as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativePendingBitmapUploads"),
            &JsValue::from_f64(self.pending_native_bitmap_uploads.len() as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativePendingBitmapUploadBytes"),
            &JsValue::from_f64(self.pending_native_bitmap_upload_bytes as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDeferredBitmapUploads"),
            &JsValue::from_f64(self.native_deferred_bitmap_uploads as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDeferredBitmapCommits"),
            &JsValue::from_f64(self.native_deferred_bitmap_commits as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDeferredBitmapDrops"),
            &JsValue::from_f64(self.native_deferred_bitmap_drops as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDeferredBitmapPeakUploads"),
            &JsValue::from_f64(self.native_deferred_bitmap_peak_uploads as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDeferredBitmapPeakBytes"),
            &JsValue::from_f64(self.native_deferred_bitmap_peak_bytes as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDeferredBitmapFlushes"),
            &JsValue::from_f64(self.native_deferred_bitmap_flushes as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDeferredBitmapFlushItems"),
            &JsValue::from_f64(self.native_deferred_bitmap_flush_items as f64),
        );
        let _ = js_sys::Reflect::set(
            &out,
            &JsValue::from_str("nativeDeferredBitmapMaxFlushItems"),
            &JsValue::from_f64(self.native_deferred_bitmap_max_flush_items as f64),
        );
        out.into()
    }

    pub fn dispose(&mut self) {
        self.clear_pending_native_bitmap_uploads();
        self.engine.dispose();
    }
}

impl SpiceNativeRuntime {
    fn apply_native_display_hot_path(&mut self, events: &mut EngineEvents) {
        let display_event_count = events.display_events().len();
        let display_events = std::mem::take(events.display_events_mut());
        let mut retained = Vec::with_capacity(display_event_count);
        for event in display_events {
            self.apply_surface_lifecycle(&event);
            if let Some(token) = visual_commit_token(&event) {
                if !self.engine.check_visual_token_native(token) {
                    self.gpu_rejected_batches = self.gpu_rejected_batches.saturating_add(1);
                    continue;
                }
            }
            if let Some(metadata) = native_bitmap_draw_metadata(&event) {
                if metadata.should_defer {
                    if let Some(mut pending) =
                        PendingNativeBitmapUpload::from_event(event, metadata)
                    {
                        if self.raw_bitmap_coalesce_mode {
                            pending.presented = true;
                        }
                        self.enqueue_pending_native_bitmap_upload(pending);
                    }
                    continue;
                }
                if !self.pending_native_bitmap_uploads.is_empty() {
                    retained.extend(self.flush_pending_native_bitmap_uploads_internal(usize::MAX));
                }
                if let Some(committed) = self.try_apply_native_bitmap_draw(&event) {
                    retained.push(committed);
                    continue;
                }
            } else if !self.pending_native_bitmap_uploads.is_empty() {
                retained.extend(self.flush_pending_native_bitmap_uploads_internal(usize::MAX));
            }
            self.apply_gpu_event_batch(&event);
            retained.push(event);
        }
        *events.display_events_mut() = retained;
    }

    fn enqueue_pending_native_bitmap_upload(&mut self, pending: PendingNativeBitmapUpload) {
        self.drop_covered_pending_native_bitmap_uploads(&pending);
        self.pending_native_bitmap_upload_bytes = self
            .pending_native_bitmap_upload_bytes
            .saturating_add(pending.byte_len());
        self.pending_native_bitmap_uploads.push_back(pending);
        self.native_deferred_bitmap_uploads = self.native_deferred_bitmap_uploads.saturating_add(1);
        self.native_deferred_bitmap_peak_uploads = self
            .native_deferred_bitmap_peak_uploads
            .max(self.pending_native_bitmap_uploads.len() as u64);
        self.native_deferred_bitmap_peak_bytes = self
            .native_deferred_bitmap_peak_bytes
            .max(self.pending_native_bitmap_upload_bytes as u64);
        self.enforce_pending_native_bitmap_limits();
    }

    fn drop_covered_pending_native_bitmap_uploads(&mut self, incoming: &PendingNativeBitmapUpload) {
        if !incoming.safe_replacement {
            return;
        }
        let mut retained = VecDeque::with_capacity(self.pending_native_bitmap_uploads.len());
        while let Some(queued) = self.pending_native_bitmap_uploads.pop_front() {
            let covered = queued.safe_to_drop_if_covered
                && queued.surface_id == incoming.surface_id
                && queued.surface_generation == incoming.surface_generation
                && rect_contains(incoming.bbox, queued.bbox);
            if covered {
                self.pending_native_bitmap_upload_bytes = self
                    .pending_native_bitmap_upload_bytes
                    .saturating_sub(queued.byte_len());
                self.native_deferred_bitmap_drops = self
                    .native_deferred_bitmap_drops
                    .saturating_add(queued.release_token_count());
                self.release_pending_native_bitmap_tokens(&queued);
            } else {
                retained.push_back(queued);
            }
        }
        self.pending_native_bitmap_uploads = retained;
    }

    fn enforce_pending_native_bitmap_limits(&mut self) {
        while self.pending_native_bitmap_uploads.len() > MAX_PENDING_NATIVE_BITMAP_UPLOADS
            || self.pending_native_bitmap_upload_bytes > MAX_PENDING_NATIVE_BITMAP_UPLOAD_BYTES
        {
            let Some(dropped) = self.pending_native_bitmap_uploads.pop_front() else {
                break;
            };
            self.pending_native_bitmap_upload_bytes = self
                .pending_native_bitmap_upload_bytes
                .saturating_sub(dropped.byte_len());
            self.native_deferred_bitmap_drops = self
                .native_deferred_bitmap_drops
                .saturating_add(dropped.release_token_count());
            self.release_pending_native_bitmap_tokens(&dropped);
        }
    }

    fn clear_pending_native_bitmap_uploads(&mut self) {
        while let Some(dropped) = self.pending_native_bitmap_uploads.pop_front() {
            self.native_deferred_bitmap_drops = self
                .native_deferred_bitmap_drops
                .saturating_add(dropped.release_token_count());
            self.release_pending_native_bitmap_tokens(&dropped);
        }
        self.pending_native_bitmap_upload_bytes = 0;
    }

    fn release_pending_native_bitmap_tokens(&mut self, pending: &PendingNativeBitmapUpload) {
        for token in &pending.commit_tokens {
            let _ = self.engine.release_visual_token_native(*token);
        }
    }

    fn flush_pending_native_bitmap_uploads_internal(
        &mut self,
        max_items: usize,
    ) -> Vec<DisplayEvent> {
        if self.pending_native_bitmap_uploads.is_empty() || max_items == 0 {
            return Vec::new();
        }
        let mut batch = Vec::with_capacity(max_items.min(self.pending_native_bitmap_uploads.len()));
        let mut visited = 0usize;
        while visited < max_items {
            let Some(pending) = self.pending_native_bitmap_uploads.pop_front() else {
                break;
            };
            self.pending_native_bitmap_upload_bytes = self
                .pending_native_bitmap_upload_bytes
                .saturating_sub(pending.byte_len());
            visited = visited.saturating_add(1);
            if !self.engine.check_visual_token_native(pending.commit_token) {
                self.native_deferred_bitmap_drops = self
                    .native_deferred_bitmap_drops
                    .saturating_add(pending.release_token_count());
                self.release_pending_native_bitmap_tokens(&pending);
                continue;
            }
            batch.push(pending);
        }
        if batch.is_empty() {
            return Vec::new();
        }
        let batch_len = batch.len() as u64;
        self.native_deferred_bitmap_flushes = self.native_deferred_bitmap_flushes.saturating_add(1);
        self.native_deferred_bitmap_flush_items = self
            .native_deferred_bitmap_flush_items
            .saturating_add(batch_len);
        self.native_deferred_bitmap_max_flush_items =
            self.native_deferred_bitmap_max_flush_items.max(batch_len);
        let batch = self.coalesce_pending_native_bitmap_uploads(batch);
        let uploads = batch
            .iter()
            .map(|pending| NativeBitmapBatchUpload {
                bytes: &pending.data,
                source_width: pending.width,
                source_height: pending.height,
                stride: pending.stride,
                format: pending.format,
                flags: pending.flags,
                dest: draw_rect_from_display(pending.bbox),
                source: pending.source,
                rop_descriptor: pending.compose.rop_descriptor,
                scale_mode: pending.compose.scale_mode,
                mask_present: false,
                present: pending.presented,
                buffer_unpack: self.raw_bitmap_coalesce_mode,
            })
            .collect::<Vec<_>>();
        let upload_result = self.gpu.upload_native_bitmap_batch(&uploads);
        drop(uploads);
        let results = match upload_result {
            Ok(results) => results,
            Err(_) => {
                for pending in batch {
                    self.native_decode_upload_rejects = self
                        .native_decode_upload_rejects
                        .saturating_add(pending.release_token_count());
                    self.release_pending_native_bitmap_tokens(&pending);
                }
                return Vec::new();
            }
        };
        let mut committed = Vec::new();
        for (index, pending) in batch.into_iter().enumerate() {
            let uploaded = results.get(index).copied().unwrap_or(false);
            if !uploaded {
                self.native_decode_upload_rejects = self
                    .native_decode_upload_rejects
                    .saturating_add(pending.release_token_count());
                self.release_pending_native_bitmap_tokens(&pending);
                continue;
            }
            self.native_decode_uploads = self.native_decode_uploads.saturating_add(1);
            self.native_direct_bitmap_uploads = self.native_direct_bitmap_uploads.saturating_add(1);
            let mut committed_any = false;
            for token in &pending.commit_tokens {
                if self.engine.commit_visual_token_native(*token) {
                    committed_any = true;
                    self.gpu_committed_tokens = self.gpu_committed_tokens.saturating_add(1);
                    self.native_deferred_bitmap_commits =
                        self.native_deferred_bitmap_commits.saturating_add(1);
                } else {
                    self.gpu_failed_commits = self.gpu_failed_commits.saturating_add(1);
                }
            }
            if !committed_any {
                continue;
            }
            committed.push(DisplayEvent::NativeGpuCommit {
                sequence_id: pending.sequence_id,
                surface_id: pending.surface_id,
                surface_generation: pending.surface_generation,
                commit_token: pending.commit_token,
                bbox: pending.bbox,
                video_like: pending.video_like,
                presented: pending.presented,
                byte_length: pending.data_length,
            });
        }
        committed
    }

    fn coalesce_pending_native_bitmap_uploads(
        &self,
        batch: Vec<PendingNativeBitmapUpload>,
    ) -> Vec<PendingNativeBitmapUpload> {
        coalesce_pending_native_bitmap_uploads(self.raw_bitmap_coalesce_mode, batch)
    }

    fn apply_gpu_event_batch(&mut self, event: &DisplayEvent) {
        let Some((token, batch)) = gpu_event_batch(event) else {
            return;
        };
        if !self.engine.check_visual_token_native(token) {
            self.gpu_rejected_batches = self.gpu_rejected_batches.saturating_add(1);
            return;
        }
        if self.gpu.submit_native_batch(batch).is_err() {
            self.gpu_rejected_batches = self.gpu_rejected_batches.saturating_add(1);
            return;
        }
        self.gpu_submitted_batches = self.gpu_submitted_batches.saturating_add(1);
        if self.engine.commit_visual_token_native(token) {
            self.gpu_committed_tokens = self.gpu_committed_tokens.saturating_add(1);
        } else {
            self.gpu_failed_commits = self.gpu_failed_commits.saturating_add(1);
        }
    }

    fn try_apply_native_bitmap_draw(&mut self, event: &DisplayEvent) -> Option<DisplayEvent> {
        let DisplayEvent::Draw {
            sequence_id,
            surface_id,
            surface_generation,
            commit_token,
            bbox,
            body_byte_length,
            src_area,
            frame_hint,
            execution,
            image,
            ..
        } = event
        else {
            return None;
        };
        if *surface_id != 0 {
            return None;
        }
        let VisualExecutionPlan::DrawCopy { compose, .. } = execution else {
            return None;
        };
        if compose.mask_present {
            return None;
        }
        let Some(image) = image else {
            return None;
        };
        let ImagePayloadEnvelope::Bitmap {
            format,
            flags,
            width,
            height,
            stride,
            data,
            data_length,
            ..
        } = &image.payload
        else {
            return None;
        };
        if *format != SPICE_BITMAP_FMT_32BIT && *format != SPICE_BITMAP_FMT_RGBA {
            return None;
        }
        let source = src_area.unwrap_or(DrawRect {
            left: 0,
            top: 0,
            right: i32::try_from(*width).unwrap_or(i32::MAX),
            bottom: i32::try_from(*height).unwrap_or(i32::MAX),
        });
        let upload_flags = *flags
            | if *format == SPICE_BITMAP_FMT_RGBA {
                SPICE_BITMAP_FLAGS_TOP_DOWN
            } else {
                0
            };
        let video_like = is_video_like_native_commit(*frame_hint, *bbox, *body_byte_length);
        let presented = should_present_native_commit_now(*frame_hint, *bbox, *body_byte_length);
        let uploaded = match self.gpu.upload_native_bitmap_rect(
            data,
            *width,
            *height,
            *stride,
            *format,
            upload_flags,
            draw_rect_from_display(*bbox),
            source,
            compose.rop_descriptor,
            compose.scale_mode,
            false,
            presented,
        ) {
            Ok(uploaded) => uploaded,
            Err(_) => {
                self.native_decode_upload_rejects =
                    self.native_decode_upload_rejects.saturating_add(1);
                return None;
            }
        };
        if !uploaded {
            self.native_decode_upload_rejects = self.native_decode_upload_rejects.saturating_add(1);
            return None;
        }
        self.native_decode_uploads = self.native_decode_uploads.saturating_add(1);
        self.native_direct_bitmap_uploads = self.native_direct_bitmap_uploads.saturating_add(1);
        if !self.engine.commit_visual_token_native(*commit_token) {
            self.gpu_failed_commits = self.gpu_failed_commits.saturating_add(1);
            return None;
        }
        self.gpu_committed_tokens = self.gpu_committed_tokens.saturating_add(1);
        Some(DisplayEvent::NativeGpuCommit {
            sequence_id: *sequence_id,
            surface_id: *surface_id,
            surface_generation: *surface_generation,
            commit_token: *commit_token,
            bbox: *bbox,
            video_like,
            presented,
            byte_length: *data_length,
        })
    }

    fn apply_surface_lifecycle(&mut self, event: &DisplayEvent) {
        match event {
            DisplayEvent::Reset { .. }
            | DisplayEvent::SurfaceDestroy { surface_id: 0, .. }
            | DisplayEvent::SurfaceCreate {
                surface_id: 0,
                primary: true,
                ..
            } => self.clear_pending_native_bitmap_uploads(),
            _ => {}
        }
        if let DisplayEvent::SurfaceCreate {
            surface_id: 0,
            primary: true,
            width,
            height,
            ..
        } = event
        {
            if self.gpu.resize_native(*width, *height).is_err() {
                self.gpu_rejected_batches = self.gpu_rejected_batches.saturating_add(1);
            }
        }
    }
}

fn visual_commit_token(event: &DisplayEvent) -> Option<u64> {
    match event {
        DisplayEvent::CopyBits { commit_token, .. }
        | DisplayEvent::Draw { commit_token, .. }
        | DisplayEvent::StreamData { commit_token, .. }
        | DisplayEvent::StreamDataSized { commit_token, .. }
        | DisplayEvent::NativeGpuCommit { commit_token, .. } => Some(*commit_token),
        _ => None,
    }
}

fn gpu_event_batch(event: &DisplayEvent) -> Option<(u64, &crate::gpu::GpuCommandBatch)> {
    match event {
        DisplayEvent::CopyBits {
            commit_token,
            gpu_batch: Some(batch),
            ..
        } => Some((*commit_token, batch)),
        DisplayEvent::Draw {
            commit_token,
            gpu_batch: Some(batch),
            ..
        } => Some((*commit_token, batch)),
        _ => None,
    }
}

fn native_bitmap_draw_metadata(event: &DisplayEvent) -> Option<NativeBitmapDrawMetadata> {
    let DisplayEvent::Draw {
        surface_id,
        bbox,
        body_byte_length,
        src_area,
        frame_hint,
        execution,
        image,
        ..
    } = event
    else {
        return None;
    };
    if *surface_id != 0 {
        return None;
    }
    let VisualExecutionPlan::DrawCopy { compose, .. } = execution else {
        return None;
    };
    if compose.mask_present {
        return None;
    }
    let Some(image) = image else {
        return None;
    };
    let ImagePayloadEnvelope::Bitmap {
        format,
        flags,
        width,
        height,
        stride,
        data_length,
        ..
    } = &image.payload
    else {
        return None;
    };
    if *format != SPICE_BITMAP_FMT_32BIT && *format != SPICE_BITMAP_FMT_RGBA {
        return None;
    }
    let source = src_area.unwrap_or(DrawRect {
        left: 0,
        top: 0,
        right: i32::try_from(*width).unwrap_or(i32::MAX),
        bottom: i32::try_from(*height).unwrap_or(i32::MAX),
    });
    let flags = *flags
        | if *format == SPICE_BITMAP_FMT_RGBA {
            SPICE_BITMAP_FLAGS_TOP_DOWN
        } else {
            0
        };
    let video_like = is_video_like_native_commit(*frame_hint, *bbox, *body_byte_length);
    let presented = should_present_native_commit_now(*frame_hint, *bbox, *body_byte_length);
    let should_defer = compose.rop_descriptor == SPICE_ROPD_OP_PUT;
    Some(NativeBitmapDrawMetadata {
        source,
        flags,
        width: *width,
        height: *height,
        stride: *stride,
        format: *format,
        data_length: *data_length,
        compose: *compose,
        video_like,
        presented,
        should_defer,
    })
}

fn draw_rect_from_display(rect: DisplayRect) -> DrawRect {
    DrawRect {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
    }
}

fn rect_contains(outer: DisplayRect, inner: DisplayRect) -> bool {
    outer.left <= inner.left
        && outer.top <= inner.top
        && outer.right >= inner.right
        && outer.bottom >= inner.bottom
}

fn can_merge_adjacent_pending_bitmap_uploads(
    left: &PendingNativeBitmapUpload,
    right: &PendingNativeBitmapUpload,
) -> bool {
    if !left.safe_replacement || !right.safe_replacement {
        return false;
    }
    if left.surface_id != right.surface_id
        || left.surface_generation != right.surface_generation
        || left.format != right.format
        || left.flags != right.flags
        || left.height != right.height
        || left.compose != right.compose
        || left.video_like != right.video_like
        || left.presented != right.presented
    {
        return false;
    }
    if left.bbox.top != right.bbox.top
        || left.bbox.bottom != right.bbox.bottom
        || left.bbox.right != right.bbox.left
    {
        return false;
    }
    if left.bbox.left >= left.bbox.right || right.bbox.left >= right.bbox.right {
        return false;
    }
    full_source_rect_matches_bitmap(left)
        && full_source_rect_matches_bitmap(right)
        && display_rect_matches_bitmap_size(left)
        && display_rect_matches_bitmap_size(right)
}

fn coalesce_pending_native_bitmap_uploads(
    enabled: bool,
    batch: Vec<PendingNativeBitmapUpload>,
) -> Vec<PendingNativeBitmapUpload> {
    if !enabled || batch.len() < 2 {
        return batch;
    }
    let mut coalesced = Vec::with_capacity(batch.len());
    let mut pending = batch.into_iter();
    let Some(mut current) = pending.next() else {
        return coalesced;
    };
    for next in pending {
        match current.try_merge_adjacent_right(next) {
            Ok(()) => {}
            Err(next) => {
                coalesced.push(current);
                current = next;
            }
        }
    }
    coalesced.push(current);
    coalesced
}

fn full_source_rect_matches_bitmap(upload: &PendingNativeBitmapUpload) -> bool {
    let Ok(width) = i32::try_from(upload.width) else {
        return false;
    };
    let Ok(height) = i32::try_from(upload.height) else {
        return false;
    };
    upload.source.left == 0
        && upload.source.top == 0
        && upload.source.right == width
        && upload.source.bottom == height
}

fn display_rect_matches_bitmap_size(upload: &PendingNativeBitmapUpload) -> bool {
    let Ok(width) = i32::try_from(upload.width) else {
        return false;
    };
    let Ok(height) = i32::try_from(upload.height) else {
        return false;
    };
    upload.bbox.right.saturating_sub(upload.bbox.left) == width
        && upload.bbox.bottom.saturating_sub(upload.bbox.top) == height
}

fn row_bytes(width: u32) -> Option<usize> {
    width
        .checked_mul(4)
        .and_then(|bytes| usize::try_from(bytes).ok())
}

fn bitmap_rows_are_readable(data: &[u8], stride: u32, height: u32, row_bytes: usize) -> bool {
    if height == 0 || (stride as usize) < row_bytes {
        return false;
    }
    let stride = stride as usize;
    let height = height as usize;
    let Some(min_len) = stride
        .checked_mul(height.saturating_sub(1))
        .and_then(|len| len.checked_add(row_bytes))
    else {
        return false;
    };
    data.len() >= min_len
}

fn is_video_like_native_commit(
    frame_hint: DisplayFrameHint,
    bbox: DisplayRect,
    byte_length: u32,
) -> bool {
    if matches!(frame_hint, DisplayFrameHint::BitmapStrip { .. }) {
        return true;
    }
    rect_area(bbox) >= 320 * 180 && byte_length >= 512 * 1024
}

fn should_present_native_commit_now(
    frame_hint: DisplayFrameHint,
    bbox: DisplayRect,
    byte_length: u32,
) -> bool {
    !matches!(frame_hint, DisplayFrameHint::BitmapStrip { .. })
        && is_video_like_native_commit(frame_hint, bbox, byte_length)
}

fn rect_area(rect: DisplayRect) -> i64 {
    let width = i64::from(rect.right.saturating_sub(rect.left).max(0));
    let height = i64::from(rect.bottom.saturating_sub(rect.top).max(0));
    width.saturating_mul(height)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compose_put() -> DrawCopyComposePlan {
        DrawCopyComposePlan {
            rop_descriptor: SPICE_ROPD_OP_PUT,
            scale_mode: 0,
            mask_present: false,
            mask_flags: None,
        }
    }

    fn patterned_data(width: u32, height: u32, stride: u32, seed: u8) -> Vec<u8> {
        let mut data = vec![0; stride as usize * height as usize];
        for y in 0..height as usize {
            for x in 0..width as usize {
                let offset = y * stride as usize + x * 4;
                data[offset] = seed;
                data[offset + 1] = x as u8;
                data[offset + 2] = y as u8;
                data[offset + 3] = 0xff;
            }
        }
        data
    }

    fn pending_upload(
        left: i32,
        top: i32,
        width: u32,
        height: u32,
        stride: u32,
        token: u64,
        seed: u8,
    ) -> PendingNativeBitmapUpload {
        PendingNativeBitmapUpload {
            sequence_id: token,
            surface_id: 0,
            surface_generation: 7,
            commit_token: token,
            bbox: DisplayRect {
                left,
                top,
                right: left + width as i32,
                bottom: top + height as i32,
            },
            data_length: stride.saturating_mul(height),
            source: DrawRect {
                left: 0,
                top: 0,
                right: width as i32,
                bottom: height as i32,
            },
            compose: compose_put(),
            width,
            height,
            stride,
            format: SPICE_BITMAP_FMT_32BIT,
            flags: SPICE_BITMAP_FLAGS_TOP_DOWN,
            video_like: true,
            presented: false,
            safe_replacement: true,
            safe_to_drop_if_covered: true,
            commit_tokens: vec![token],
            data: patterned_data(width, height, stride, seed),
        }
    }

    #[test]
    fn coalesces_exact_horizontal_neighbors_with_stride_padding() {
        let mut left = pending_upload(0, 10, 2, 2, 12, 1, 10);
        let right = pending_upload(2, 10, 1, 2, 8, 2, 20);

        assert!(left.try_merge_adjacent_right(right).is_ok());

        assert_eq!(left.width, 3);
        assert_eq!(left.height, 2);
        assert_eq!(left.stride, 12);
        assert_eq!(left.bbox.right, 3);
        assert_eq!(left.source.right, 3);
        assert_eq!(left.commit_token, 2);
        assert_eq!(left.commit_tokens, vec![1, 2]);
        assert_eq!(left.data.len(), 24);
        assert_eq!(&left.data[0..8], &[10, 0, 0, 0xff, 10, 1, 0, 0xff]);
        assert_eq!(&left.data[8..12], &[20, 0, 0, 0xff]);
        assert_eq!(&left.data[12..20], &[10, 0, 1, 0xff, 10, 1, 1, 0xff]);
        assert_eq!(&left.data[20..24], &[20, 0, 1, 0xff]);
    }

    #[test]
    fn refuses_to_merge_gap_or_vertical_mismatch() {
        let mut left = pending_upload(0, 10, 2, 2, 8, 1, 10);
        let gap = pending_upload(3, 10, 1, 2, 4, 2, 20);
        assert!(left.try_merge_adjacent_right(gap).is_err());

        let mut left = pending_upload(0, 10, 2, 2, 8, 1, 10);
        let shifted = pending_upload(2, 11, 1, 2, 4, 2, 20);
        assert!(left.try_merge_adjacent_right(shifted).is_err());
    }

    #[test]
    fn coalesce_batch_preserves_unmergeable_boundaries() {
        let batch = vec![
            pending_upload(0, 10, 2, 2, 8, 1, 10),
            pending_upload(2, 10, 1, 2, 4, 2, 20),
            pending_upload(4, 10, 1, 2, 4, 3, 30),
        ];

        let coalesced = coalesce_pending_native_bitmap_uploads(true, batch);

        assert_eq!(coalesced.len(), 2);
        assert_eq!(coalesced[0].width, 3);
        assert_eq!(coalesced[0].commit_tokens, vec![1, 2]);
        assert_eq!(coalesced[1].width, 1);
        assert_eq!(coalesced[1].commit_tokens, vec![3]);
    }
}
