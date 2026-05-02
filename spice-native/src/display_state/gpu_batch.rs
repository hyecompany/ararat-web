/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::cache::SpiceCacheEpochs;
use crate::display_draw::{DrawCopyEnvelope, DrawRect};
use crate::display_execution::{VisualDecodePlan, VisualExecutionPlan};
use crate::gpu::{
    GpuCommand, GpuCommandBatch, GpuCommandToken, GpuSurfaceKey, PresentationBarrier,
};
use crate::mutation_graph::SpiceMutationGraph;
use crate::wire;

pub(super) fn batch_for_copy_bits(
    sequence_id: u64,
    base: &wire::DisplayBase,
    src_pos: wire::Point,
    surface_generation: u32,
    commit_token: u64,
    cache_epochs: &SpiceCacheEpochs,
) -> GpuCommandBatch {
    let surface = GpuSurfaceKey {
        surface_id: base.surface_id,
        generation: surface_generation,
    };
    let dest = draw_rect(base.box_);
    let width = (base.box_.right - base.box_.left).max(0);
    let height = (base.box_.bottom - base.box_.top).max(0);
    let source_rect = DrawRect {
        left: src_pos.x,
        top: src_pos.y,
        right: src_pos.x.saturating_add(width),
        bottom: src_pos.y.saturating_add(height),
    };
    GpuCommandBatch {
        batch_id: sequence_id,
        surface,
        commands: vec![
            GpuCommand::CopySurface {
                token: command_token(commit_token, surface, dest, cache_epochs.global_epoch()),
                source: surface,
                source_rect,
            },
            GpuCommand::Present {
                surface,
                batch_id: sequence_id,
            },
        ],
        dirty_rects: vec![dest],
        byte_cost: rect_byte_cost(dest),
        presentation_barrier: PresentationBarrier::Immediate,
    }
}

pub(super) fn batch_for_draw(
    sequence_id: u64,
    base: &wire::DisplayBase,
    draw_copy: Option<&DrawCopyEnvelope>,
    execution: &VisualExecutionPlan,
    surface_generation: u32,
    commit_token: u64,
    graph: &SpiceMutationGraph,
    cache_epochs: &SpiceCacheEpochs,
) -> Option<GpuCommandBatch> {
    let surface = GpuSurfaceKey {
        surface_id: base.surface_id,
        generation: surface_generation,
    };
    let dest = draw_rect(base.box_);
    let token = command_token(commit_token, surface, dest, cache_epochs.global_epoch());
    let command = match execution {
        VisualExecutionPlan::FillRect { color, .. } => GpuCommand::Fill {
            token,
            color: *color,
            rop_descriptor: 8,
        },
        VisualExecutionPlan::DrawCopy {
            decode:
                VisualDecodePlan::GpuSurfaceCopy {
                    surface_id: source_id,
                },
            ..
        } => {
            let source_generation = graph.surface_generation(*source_id);
            let source_rect = draw_copy?.src_area;
            GpuCommand::CopySurface {
                token: GpuCommandToken {
                    cache_epoch: cache_epochs.global_epoch(),
                    ..token
                },
                source: GpuSurfaceKey {
                    surface_id: *source_id,
                    generation: source_generation,
                },
                source_rect: DrawRect {
                    left: source_rect.left,
                    top: source_rect.top,
                    right: source_rect.right,
                    bottom: source_rect.bottom,
                },
            }
        }
        _ => return None,
    };
    Some(GpuCommandBatch {
        batch_id: sequence_id,
        surface,
        commands: vec![
            command,
            GpuCommand::Present {
                surface,
                batch_id: sequence_id,
            },
        ],
        dirty_rects: vec![dest],
        byte_cost: rect_byte_cost(dest),
        presentation_barrier: PresentationBarrier::Immediate,
    })
}

fn command_token(
    commit_token: u64,
    surface: GpuSurfaceKey,
    dest: DrawRect,
    cache_epoch: u64,
) -> GpuCommandToken {
    GpuCommandToken {
        commit_token,
        surface,
        dest,
        cache_epoch,
    }
}

fn draw_rect(rect: wire::Rect) -> DrawRect {
    DrawRect {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
    }
}

fn rect_byte_cost(rect: DrawRect) -> u32 {
    let width = (rect.right - rect.left).max(0) as u32;
    let height = (rect.bottom - rect.top).max(0) as u32;
    width.saturating_mul(height).saturating_mul(4)
}
