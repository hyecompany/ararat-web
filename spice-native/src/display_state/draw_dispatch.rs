/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::display_draw::{
    parse_draw_copy_envelope, parse_draw_fill_envelope, parse_draw_mask_only_envelope,
    serializable_image,
};
use crate::display_events::DisplayEvent;
use crate::display_execution::plan_visual_execution;
use crate::mutation_graph::SpiceMutationGraph;
use crate::wire;

use super::convert::{display_clip, display_frame_hint, display_parse_error, display_rect};
use super::gpu_batch::batch_for_draw;
use super::state::SpiceDisplayState;

pub(super) fn handle_draw_message(
    state: &mut SpiceDisplayState,
    sequence_id: u64,
    message: u16,
    body: &[u8],
    graph: &mut SpiceMutationGraph,
    cache_epochs: &crate::cache::SpiceCacheEpochs,
) -> Result<DisplayEvent, String> {
    let base = wire::parse_display_base_prefix(body).map_err(display_parse_error)?;
    let mut draw_copy = if message == wire::SPICE_MSG_DISPLAY_DRAW_COPY {
        Some(parse_draw_copy_envelope(body)?)
    } else {
        None
    };
    if let Some(draw) = draw_copy.as_mut() {
        state.resolve_cached_draw_image(draw);
    }
    let draw_fill = if message == wire::SPICE_MSG_DISPLAY_DRAW_FILL {
        Some(parse_draw_fill_envelope(body)?)
    } else {
        None
    };
    let draw_mask = if matches!(
        message,
        wire::SPICE_MSG_DISPLAY_DRAW_BLACKNESS
            | wire::SPICE_MSG_DISPLAY_DRAW_WHITENESS
            | wire::SPICE_MSG_DISPLAY_DRAW_INVERS
    ) {
        Some(parse_draw_mask_only_envelope(body)?)
    } else {
        None
    };
    let frame_hint = display_frame_hint(state.planner.plan_draw_copy(&base, draw_copy.as_ref()));
    let execution = plan_visual_execution(
        message,
        &base,
        draw_copy.as_ref(),
        draw_fill.as_ref(),
        draw_mask.as_ref(),
    );
    let surface_generation = graph.surface_generation(base.surface_id);
    let plan_token = state.next_plan_token();
    let commit_token = claim_base(graph, &base, surface_generation, sequence_id, plan_token);
    let gpu_batch = batch_for_draw(
        sequence_id,
        &base,
        draw_copy.as_ref(),
        &execution,
        surface_generation,
        commit_token,
        graph,
        cache_epochs,
    );
    let image = draw_copy
        .as_ref()
        .and_then(|draw| draw.src_bitmap.clone())
        .map(serializable_image);
    if let Some(image) = draw_copy.as_ref().and_then(|draw| draw.src_bitmap.as_ref()) {
        state.maybe_cache_draw_image(image);
    }
    Ok(DisplayEvent::Draw {
        sequence_id,
        message_type: message,
        kind: draw_kind(message),
        surface_id: base.surface_id,
        surface_generation,
        commit_token,
        bbox: display_rect(base.box_),
        clip: display_clip(base.clip),
        body_byte_length: body.len() as u32,
        src_area: draw_copy.as_ref().map(|draw| draw.src_area),
        rop_descriptor: draw_copy.as_ref().map(|draw| draw.rop_descriptor),
        scale_mode: draw_copy.as_ref().map(|draw| draw.scale_mode),
        frame_hint,
        execution,
        image,
        gpu_batch,
    })
}

pub(super) fn claim_base(
    graph: &mut SpiceMutationGraph,
    base: &wire::DisplayBase,
    surface_generation: u32,
    sequence_id: u64,
    plan_token: u64,
) -> u64 {
    graph.claim_rect(
        base.surface_id,
        surface_generation,
        sequence_id,
        plan_token,
        base.box_.left,
        base.box_.top,
        base.box_.right,
        base.box_.bottom,
    )
}

pub(super) fn is_draw_message(message: u16) -> bool {
    matches!(
        message,
        wire::SPICE_MSG_DISPLAY_DRAW_FILL
            | wire::SPICE_MSG_DISPLAY_DRAW_OPAQUE
            | wire::SPICE_MSG_DISPLAY_DRAW_COPY
            | wire::SPICE_MSG_DISPLAY_DRAW_BLEND
            | wire::SPICE_MSG_DISPLAY_DRAW_BLACKNESS
            | wire::SPICE_MSG_DISPLAY_DRAW_WHITENESS
            | wire::SPICE_MSG_DISPLAY_DRAW_INVERS
            | wire::SPICE_MSG_DISPLAY_DRAW_ROP3
            | wire::SPICE_MSG_DISPLAY_DRAW_STROKE
            | wire::SPICE_MSG_DISPLAY_DRAW_TEXT
            | wire::SPICE_MSG_DISPLAY_DRAW_TRANSPARENT
            | wire::SPICE_MSG_DISPLAY_DRAW_ALPHA_BLEND
            | wire::SPICE_MSG_DISPLAY_DRAW_COMPOSITE
    )
}

fn draw_kind(message: u16) -> &'static str {
    match message {
        wire::SPICE_MSG_DISPLAY_DRAW_FILL => "fill",
        wire::SPICE_MSG_DISPLAY_DRAW_OPAQUE => "opaque",
        wire::SPICE_MSG_DISPLAY_DRAW_COPY => "copy",
        wire::SPICE_MSG_DISPLAY_DRAW_BLEND => "blend",
        wire::SPICE_MSG_DISPLAY_DRAW_BLACKNESS => "blackness",
        wire::SPICE_MSG_DISPLAY_DRAW_WHITENESS => "whiteness",
        wire::SPICE_MSG_DISPLAY_DRAW_INVERS => "invers",
        wire::SPICE_MSG_DISPLAY_DRAW_ROP3 => "rop3",
        wire::SPICE_MSG_DISPLAY_DRAW_STROKE => "stroke",
        wire::SPICE_MSG_DISPLAY_DRAW_TEXT => "text",
        wire::SPICE_MSG_DISPLAY_DRAW_TRANSPARENT => "transparent",
        wire::SPICE_MSG_DISPLAY_DRAW_ALPHA_BLEND => "alphaBlend",
        wire::SPICE_MSG_DISPLAY_DRAW_COMPOSITE => "composite",
        _ => "unknown",
    }
}
