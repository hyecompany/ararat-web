/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::collections::HashMap;

use crate::cache::{ProtocolCacheKind, ProtocolCacheTable, SpiceCacheEpochs};
use crate::display_draw::{DrawCopyEnvelope, ImageEnvelope, ImagePayloadEnvelope};
use crate::display_events::{DisplayEvent, DisplayRect};
use crate::display_planner::DisplayPlanner;
use crate::mutation_graph::SpiceMutationGraph;
use crate::wire;

use super::cache_invalidation::{
    flush_satisfied_barriers, handle_inval_all_palettes, handle_inval_all_pixmaps,
    handle_inval_list, handle_inval_palette, PendingPixmapInvalidation,
};
use super::convert::{
    display_clip, display_head, display_parse_error, display_point, display_rect,
};
use super::draw_dispatch::{claim_base, handle_draw_message, is_draw_message};
use super::gpu_batch::batch_for_copy_bits;
use super::SPICE_SURFACE_FLAGS_PRIMARY;

const PIXMAP_CACHE_BYTES: u64 = 128 * 1024 * 1024;

pub struct SpiceDisplayState {
    pub(super) next_sequence_id: u64,
    pub(super) next_plan_token: u64,
    pub(super) planner: DisplayPlanner,
    pub(super) pending_pixmap_invalidations: Vec<PendingPixmapInvalidation>,
    image_cache_table: ProtocolCacheTable,
    image_cache: HashMap<u64, ImageEnvelope>,
    streams: HashMap<u32, ActiveStream>,
}

impl Default for SpiceDisplayState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy)]
struct ActiveStream {
    surface_id: u32,
    surface_generation: u32,
    codec_type: u8,
    stream_width: u32,
    stream_height: u32,
    dest: DisplayRect,
}

impl SpiceDisplayState {
    pub fn new() -> SpiceDisplayState {
        SpiceDisplayState {
            next_sequence_id: 1,
            next_plan_token: 1,
            planner: DisplayPlanner::new(),
            pending_pixmap_invalidations: Vec::new(),
            image_cache_table: ProtocolCacheTable::new(
                ProtocolCacheKind::Pixmap,
                PIXMAP_CACHE_BYTES,
            ),
            image_cache: HashMap::new(),
            streams: HashMap::new(),
        }
    }

    pub fn reset(&mut self) {
        self.next_sequence_id = 1;
        self.next_plan_token = 1;
        self.planner.reset();
        self.pending_pixmap_invalidations.clear();
        self.image_cache_table.clear();
        self.image_cache.clear();
        self.streams.clear();
    }

    pub fn flush_satisfied_barriers(
        &mut self,
        graph: &SpiceMutationGraph,
        cache_epochs: &mut SpiceCacheEpochs,
    ) -> Vec<DisplayEvent> {
        flush_satisfied_barriers(self, graph, cache_epochs)
    }

    pub fn handle_message(
        &mut self,
        message_type: u16,
        body: &[u8],
        graph: &mut SpiceMutationGraph,
        cache_epochs: &mut SpiceCacheEpochs,
    ) -> Result<Option<DisplayEvent>, String> {
        let sequence_id = self.next_sequence();
        let event = match message_type {
            wire::SPICE_MSG_DISPLAY_MODE => {
                let mode = wire::parse_display_mode(body).map_err(display_parse_error)?;
                DisplayEvent::Mode {
                    sequence_id,
                    width: mode.x_res,
                    height: mode.y_res,
                    bits: mode.bits,
                }
            }
            wire::SPICE_MSG_DISPLAY_MARK => DisplayEvent::Mark { sequence_id },
            wire::SPICE_MSG_DISPLAY_RESET => {
                graph.clear();
                cache_epochs.bump_all();
                self.reset();
                DisplayEvent::Reset { sequence_id }
            }
            wire::SPICE_MSG_DISPLAY_SURFACE_CREATE => {
                let surface =
                    wire::parse_display_surface_create(body).map_err(display_parse_error)?;
                let surface_generation = graph.bump_surface_generation(surface.surface_id);
                DisplayEvent::SurfaceCreate {
                    sequence_id,
                    surface_id: surface.surface_id,
                    surface_generation,
                    width: surface.width,
                    height: surface.height,
                    format: surface.format,
                    flags: surface.flags,
                    primary: (surface.flags & SPICE_SURFACE_FLAGS_PRIMARY) != 0,
                }
            }
            wire::SPICE_MSG_DISPLAY_SURFACE_DESTROY => {
                let surface =
                    wire::parse_display_surface_destroy(body).map_err(display_parse_error)?;
                let surface_generation = graph.bump_surface_generation(surface.surface_id);
                DisplayEvent::SurfaceDestroy {
                    sequence_id,
                    surface_id: surface.surface_id,
                    surface_generation,
                }
            }
            wire::SPICE_MSG_DISPLAY_MONITORS_CONFIG => {
                let config =
                    wire::parse_display_monitors_config(body).map_err(display_parse_error)?;
                DisplayEvent::MonitorsConfig {
                    sequence_id,
                    count: u32::from(config.count),
                    max_allowed: u32::from(config.max_allowed),
                    heads: config.heads.into_iter().map(display_head).collect(),
                }
            }
            wire::SPICE_MSG_DISPLAY_COPY_BITS => {
                let copy_bits = wire::parse_display_copy_bits(body).map_err(display_parse_error)?;
                let surface_generation = graph.surface_generation(copy_bits.base.surface_id);
                let plan_token = self.next_plan_token();
                let commit_token = claim_base(
                    graph,
                    &copy_bits.base,
                    surface_generation,
                    sequence_id,
                    plan_token,
                );
                DisplayEvent::CopyBits {
                    sequence_id,
                    surface_id: copy_bits.base.surface_id,
                    surface_generation,
                    commit_token,
                    bbox: display_rect(copy_bits.base.box_),
                    clip: display_clip(copy_bits.base.clip.clone()),
                    src_pos: display_point(copy_bits.src_pos),
                    gpu_batch: Some(batch_for_copy_bits(
                        sequence_id,
                        &copy_bits.base,
                        copy_bits.src_pos,
                        surface_generation,
                        commit_token,
                        cache_epochs,
                    )),
                }
            }
            wire::SPICE_MSG_DISPLAY_INVAL_LIST => {
                handle_inval_list(self, sequence_id, body, cache_epochs)?
            }
            wire::SPICE_MSG_DISPLAY_INVAL_ALL_PIXMAPS => {
                handle_inval_all_pixmaps(self, sequence_id, body, graph, cache_epochs)?
            }
            wire::SPICE_MSG_DISPLAY_INVAL_PALETTE => {
                handle_inval_palette(sequence_id, body, cache_epochs)?
            }
            wire::SPICE_MSG_DISPLAY_INVAL_ALL_PALETTES => {
                handle_inval_all_palettes(sequence_id, cache_epochs)
            }
            wire::SPICE_MSG_DISPLAY_STREAM_CREATE => {
                let stream =
                    wire::parse_display_stream_create(body).map_err(display_parse_error)?;
                let surface_generation = graph.surface_generation(stream.surface_id);
                let dest = display_rect(stream.dest);
                self.streams.insert(
                    stream.id,
                    ActiveStream {
                        surface_id: stream.surface_id,
                        surface_generation,
                        codec_type: stream.codec_type,
                        stream_width: stream.stream_width,
                        stream_height: stream.stream_height,
                        dest,
                    },
                );
                DisplayEvent::StreamCreate {
                    sequence_id,
                    surface_id: stream.surface_id,
                    id: stream.id,
                    flags: stream.flags,
                    codec_type: stream.codec_type,
                    stamp: stream.stamp,
                    stream_width: stream.stream_width,
                    stream_height: stream.stream_height,
                    src_width: stream.src_width,
                    src_height: stream.src_height,
                    dest,
                    clip: display_clip(stream.clip),
                }
            }
            wire::SPICE_MSG_DISPLAY_STREAM_DATA => {
                let stream = wire::parse_display_stream_data(body).map_err(display_parse_error)?;
                let Some(active) = self.streams.get(&stream.base.id).copied() else {
                    return Ok(None);
                };
                let plan_token = self.next_plan_token();
                let commit_token = claim_stream_rect(graph, active, sequence_id, plan_token);
                DisplayEvent::StreamData {
                    sequence_id,
                    surface_id: active.surface_id,
                    surface_generation: active.surface_generation,
                    commit_token,
                    id: stream.base.id,
                    codec_type: active.codec_type,
                    multimedia_time: stream.base.multi_media_time,
                    width: active.stream_width,
                    height: active.stream_height,
                    dest: active.dest,
                    byte_length: stream.data.len() as u32,
                    data: stream.data,
                }
            }
            wire::SPICE_MSG_DISPLAY_STREAM_DATA_SIZED => {
                let stream =
                    wire::parse_display_stream_data_sized(body).map_err(display_parse_error)?;
                let Some(active) = self.streams.get(&stream.base.id).copied() else {
                    return Ok(None);
                };
                let dest = display_rect(stream.dest);
                let plan_token = self.next_plan_token();
                let commit_token = graph.claim_rect(
                    active.surface_id,
                    active.surface_generation,
                    sequence_id,
                    plan_token,
                    dest.left,
                    dest.top,
                    dest.right,
                    dest.bottom,
                );
                DisplayEvent::StreamDataSized {
                    sequence_id,
                    surface_id: active.surface_id,
                    surface_generation: active.surface_generation,
                    commit_token,
                    id: stream.base.id,
                    codec_type: active.codec_type,
                    multimedia_time: stream.base.multi_media_time,
                    width: stream.width,
                    height: stream.height,
                    dest,
                    byte_length: stream.data.len() as u32,
                    data: stream.data,
                }
            }
            wire::SPICE_MSG_DISPLAY_STREAM_CLIP => {
                let clip = wire::parse_display_stream_clip(body).map_err(display_parse_error)?;
                DisplayEvent::StreamClip {
                    sequence_id,
                    id: clip.id,
                    clip: display_clip(clip.clip),
                }
            }
            wire::SPICE_MSG_DISPLAY_STREAM_DESTROY => {
                let stream =
                    wire::parse_display_stream_destroy(body).map_err(display_parse_error)?;
                self.streams.remove(&stream.id);
                DisplayEvent::StreamDestroy {
                    sequence_id,
                    id: stream.id,
                }
            }
            wire::SPICE_MSG_DISPLAY_STREAM_DESTROY_ALL => {
                self.streams.clear();
                DisplayEvent::StreamDestroyAll { sequence_id }
            }
            wire::SPICE_MSG_DISPLAY_STREAM_ACTIVATE_REPORT => {
                let report = wire::parse_display_stream_activate_report(body)
                    .map_err(display_parse_error)?;
                DisplayEvent::StreamActivateReport {
                    sequence_id,
                    stream_id: report.stream_id,
                    unique_id: report.unique_id,
                    max_window_size: report.max_window_size,
                    timeout_ms: report.timeout_ms,
                }
            }
            message if is_draw_message(message) => {
                handle_draw_message(self, sequence_id, message, body, graph, cache_epochs)?
            }
            _ => return Ok(None),
        };
        Ok(Some(event))
    }

    fn next_sequence(&mut self) -> u64 {
        let sequence = self.next_sequence_id;
        self.next_sequence_id = self.next_sequence_id.saturating_add(1).max(1);
        sequence
    }

    pub(super) fn next_plan_token(&mut self) -> u64 {
        let token = self.next_plan_token;
        self.next_plan_token = self.next_plan_token.saturating_add(1).max(1);
        token
    }

    pub(super) fn resolve_cached_draw_image(&mut self, draw: &mut DrawCopyEnvelope) {
        let Some(image) = draw.src_bitmap.as_ref() else {
            return;
        };
        if !matches!(image.payload, ImagePayloadEnvelope::CacheRef) {
            return;
        }
        let Some(_) = self.image_cache_table.find(image.descriptor.id) else {
            return;
        };
        if let Some(cached) = self.image_cache.get(&image.descriptor.id).cloned() {
            draw.src_bitmap = Some(cached);
        }
    }

    pub(super) fn maybe_cache_draw_image(&mut self, image: &ImageEnvelope) {
        if !image.descriptor.cache_me && !image.descriptor.cache_replace_me {
            return;
        }
        if matches!(image.payload, ImagePayloadEnvelope::CacheRef) {
            return;
        }
        let result =
            self.image_cache_table
                .insert(image.descriptor.id, image_payload_cost(image), false);
        for evicted in result.evicted {
            self.image_cache.remove(&evicted.id);
        }
        if result.accepted {
            self.image_cache.insert(image.descriptor.id, image.clone());
        }
    }

    pub(super) fn invalidate_cached_pixmap(&mut self, id: u64) {
        self.image_cache_table.invalidate(id);
        self.image_cache.remove(&id);
    }

    pub(super) fn clear_cached_pixmaps(&mut self) {
        self.image_cache_table.clear();
        self.image_cache.clear();
    }
}

fn image_payload_cost(image: &ImageEnvelope) -> u64 {
    match &image.payload {
        ImagePayloadEnvelope::Bitmap { data_length, .. }
        | ImagePayloadEnvelope::Binary { data_length, .. }
        | ImagePayloadEnvelope::LzPlt { data_length, .. }
        | ImagePayloadEnvelope::ZlibGlz { data_length, .. } => u64::from(*data_length),
        ImagePayloadEnvelope::JpegAlpha { data, .. } => data.len() as u64,
        ImagePayloadEnvelope::Surface { .. }
        | ImagePayloadEnvelope::CacheRef
        | ImagePayloadEnvelope::Unsupported => u64::from(image.descriptor.width)
            .saturating_mul(u64::from(image.descriptor.height))
            .saturating_mul(4),
    }
    .max(1)
}

fn claim_stream_rect(
    graph: &mut SpiceMutationGraph,
    stream: ActiveStream,
    sequence_id: u64,
    plan_token: u64,
) -> u64 {
    graph.claim_rect(
        stream.surface_id,
        stream.surface_generation,
        sequence_id,
        plan_token,
        stream.dest.left,
        stream.dest.top,
        stream.dest.right,
        stream.dest.bottom,
    )
}
