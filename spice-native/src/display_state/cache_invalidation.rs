/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::cache::{
    spice_cache_resource_image, spice_cache_resource_palette, spice_cache_resource_pixmap,
    SpiceCacheEpochs,
};
use crate::display_events::DisplayEvent;
use crate::mutation_graph::SpiceMutationGraph;
use crate::wire;

use super::convert::{display_cache_resource, display_parse_error, display_wait_channel};
use super::state::SpiceDisplayState;

#[derive(Clone)]
pub(super) struct PendingPixmapInvalidation {
    pub(super) sequence_id: u64,
    pub(super) wait_barrier: u64,
    pub(super) wait_list: Vec<wire::ChannelWait>,
}

pub(super) fn flush_satisfied_barriers(
    state: &mut SpiceDisplayState,
    graph: &SpiceMutationGraph,
    cache_epochs: &mut SpiceCacheEpochs,
) -> Vec<DisplayEvent> {
    let mut events = Vec::new();
    let mut still_pending = Vec::with_capacity(state.pending_pixmap_invalidations.len());
    let mut clear_pixmap_cache = false;
    for pending in state.pending_pixmap_invalidations.drain(..) {
        if graph.is_barrier_satisfied(pending.wait_barrier) {
            let epoch = invalidate_all_pixmaps(cache_epochs);
            clear_pixmap_cache = true;
            events.push(DisplayEvent::CacheInvalidateAllPixmaps {
                sequence_id: pending.sequence_id,
                epoch: Some(epoch),
                wait_barrier: pending.wait_barrier,
                pending: false,
                wait_list: pending
                    .wait_list
                    .into_iter()
                    .map(display_wait_channel)
                    .collect(),
            });
        } else {
            still_pending.push(pending);
        }
    }
    state.pending_pixmap_invalidations = still_pending;
    if clear_pixmap_cache {
        state.clear_cached_pixmaps();
    }
    events
}

pub(super) fn handle_inval_list(
    state: &mut SpiceDisplayState,
    sequence_id: u64,
    body: &[u8],
    cache_epochs: &mut SpiceCacheEpochs,
) -> Result<DisplayEvent, String> {
    let invalidation = wire::parse_display_inval_list(body).map_err(display_parse_error)?;
    for resource in &invalidation.resources {
        if resource.resource_type == wire::SPICE_DISPLAY_RESOURCE_TYPE_PIXMAP {
            cache_epochs.bump_resource(spice_cache_resource_image(), resource.id);
            state.invalidate_cached_pixmap(resource.id);
        }
    }
    Ok(DisplayEvent::CacheInvalidateList {
        sequence_id,
        resources: invalidation
            .resources
            .into_iter()
            .map(display_cache_resource)
            .collect(),
    })
}

pub(super) fn handle_inval_all_pixmaps(
    state: &mut SpiceDisplayState,
    sequence_id: u64,
    body: &[u8],
    graph: &mut SpiceMutationGraph,
    cache_epochs: &mut SpiceCacheEpochs,
) -> Result<DisplayEvent, String> {
    let wait = wire::parse_wait_for_channels(body).map_err(display_parse_error)?;
    let wait_list = wait.wait_list;
    let wait_barrier = graph.add_wait_barrier_serials(
        wait_list
            .iter()
            .map(|wait| (wait.channel_type, wait.channel_id, wait.message_serial)),
    );
    let satisfied = graph.is_barrier_satisfied(wait_barrier);
    let epoch = satisfied.then(|| invalidate_all_pixmaps(cache_epochs));
    if satisfied {
        state.clear_cached_pixmaps();
    }
    if !satisfied {
        state
            .pending_pixmap_invalidations
            .push(PendingPixmapInvalidation {
                sequence_id,
                wait_barrier,
                wait_list: wait_list.clone(),
            });
    }
    Ok(DisplayEvent::CacheInvalidateAllPixmaps {
        sequence_id,
        epoch,
        wait_barrier,
        pending: !satisfied,
        wait_list: wait_list.into_iter().map(display_wait_channel).collect(),
    })
}

pub(super) fn handle_inval_palette(
    sequence_id: u64,
    body: &[u8],
    cache_epochs: &mut SpiceCacheEpochs,
) -> Result<DisplayEvent, String> {
    let palette = wire::parse_display_inval_palette(body).map_err(display_parse_error)?;
    let epoch = cache_epochs.bump_resource(spice_cache_resource_palette(), palette.id);
    Ok(DisplayEvent::CacheInvalidatePalette {
        sequence_id,
        id: palette.id,
        epoch,
    })
}

pub(super) fn handle_inval_all_palettes(
    sequence_id: u64,
    cache_epochs: &mut SpiceCacheEpochs,
) -> DisplayEvent {
    let epoch = cache_epochs.bump_kind(spice_cache_resource_palette());
    DisplayEvent::CacheInvalidateAllPalettes { sequence_id, epoch }
}

fn invalidate_all_pixmaps(cache_epochs: &mut SpiceCacheEpochs) -> u64 {
    let image_epoch = cache_epochs.bump_kind(spice_cache_resource_image());
    let _ = cache_epochs.bump_kind(spice_cache_resource_pixmap());
    image_epoch
}
