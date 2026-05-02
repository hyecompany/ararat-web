/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::cache::{spice_cache_resource_image, spice_cache_resource_pixmap, SpiceCacheEpochs};
use crate::display_events::DisplayEvent;
use crate::mutation_graph::SpiceMutationGraph;
use crate::wire;

use super::{SpiceDisplayState, SPICE_SURFACE_FLAGS_PRIMARY};

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_i32(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_rect(out: &mut Vec<u8>, top: i32, left: i32, bottom: i32, right: i32) {
    push_i32(out, top);
    push_i32(out, left);
    push_i32(out, bottom);
    push_i32(out, right);
}

#[test]
fn surface_create_bumps_generation_and_marks_primary() {
    let mut state = SpiceDisplayState::new();
    let mut graph = SpiceMutationGraph::new();
    let mut cache = SpiceCacheEpochs::new();
    let mut body = Vec::new();
    for value in [0, 1024, 768, 32, SPICE_SURFACE_FLAGS_PRIMARY] {
        push_u32(&mut body, value);
    }

    let event = state
        .handle_message(
            wire::SPICE_MSG_DISPLAY_SURFACE_CREATE,
            &body,
            &mut graph,
            &mut cache,
        )
        .unwrap()
        .unwrap();

    match event {
        DisplayEvent::SurfaceCreate {
            surface_id,
            surface_generation,
            primary,
            ..
        } => {
            assert_eq!(surface_id, 0);
            assert_eq!(surface_generation, 1);
            assert!(primary);
        }
        _ => panic!("unexpected event"),
    }
}

#[test]
fn draw_claims_region_token() {
    let mut state = SpiceDisplayState::new();
    let mut graph = SpiceMutationGraph::new();
    let mut cache = SpiceCacheEpochs::new();
    graph.set_surface_generation(0, 3);
    let mut body = Vec::new();
    push_u32(&mut body, 0);
    push_rect(&mut body, 0, 0, 64, 64);
    body.push(wire::SPICE_CLIP_TYPE_NONE);
    push_u32(&mut body, 1);
    push_u32(&mut body, 0x000000);
    push_u16(&mut body, 8);
    body.push(0);
    push_i32(&mut body, 0);
    push_i32(&mut body, 0);
    push_u32(&mut body, 0);

    let event = state
        .handle_message(
            wire::SPICE_MSG_DISPLAY_DRAW_FILL,
            &body,
            &mut graph,
            &mut cache,
        )
        .unwrap()
        .unwrap();

    match event {
        DisplayEvent::Draw {
            surface_generation,
            commit_token,
            ..
        } => {
            assert_eq!(surface_generation, 3);
            assert_eq!(graph.check_token(commit_token), 0);
        }
        _ => panic!("unexpected event"),
    }
}

#[test]
fn image_invalidation_bumps_cache_epoch() {
    let mut state = SpiceDisplayState::new();
    let mut graph = SpiceMutationGraph::new();
    let mut cache = SpiceCacheEpochs::new();
    let before = cache.claim(spice_cache_resource_image(), 77);
    let mut body = Vec::new();
    push_u16(&mut body, 1);
    body.push(wire::SPICE_DISPLAY_RESOURCE_TYPE_PIXMAP);
    body.extend_from_slice(&77u64.to_le_bytes());

    let _ = state
        .handle_message(
            wire::SPICE_MSG_DISPLAY_INVAL_LIST,
            &body,
            &mut graph,
            &mut cache,
        )
        .unwrap();

    assert!(!cache.is_current(spice_cache_resource_image(), 77, before));
}

#[test]
fn all_pixmap_invalidation_waits_for_channel_barrier() {
    let mut state = SpiceDisplayState::new();
    let mut graph = SpiceMutationGraph::new();
    let mut cache = SpiceCacheEpochs::new();
    let image_epoch = cache.claim(spice_cache_resource_image(), 77);
    let pixmap_epoch = cache.claim(spice_cache_resource_pixmap(), 77);
    let mut body = vec![1, wire::SPICE_CHANNEL_DISPLAY, 1];
    body.extend_from_slice(&5u64.to_le_bytes());

    let event = state
        .handle_message(
            wire::SPICE_MSG_DISPLAY_INVAL_ALL_PIXMAPS,
            &body,
            &mut graph,
            &mut cache,
        )
        .unwrap()
        .unwrap();

    match event {
        DisplayEvent::CacheInvalidateAllPixmaps { epoch, pending, .. } => {
            assert_eq!(epoch, None);
            assert!(pending);
        }
        _ => panic!("unexpected event"),
    }
    assert!(cache.is_current(spice_cache_resource_image(), 77, image_epoch));
    assert!(cache.is_current(spice_cache_resource_pixmap(), 77, pixmap_epoch));

    graph.observe_channel_serial(wire::SPICE_CHANNEL_DISPLAY, 1, 5);
    let flushed = state.flush_satisfied_barriers(&graph, &mut cache);

    assert_eq!(flushed.len(), 1);
    match &flushed[0] {
        DisplayEvent::CacheInvalidateAllPixmaps { epoch, pending, .. } => {
            assert!(epoch.is_some());
            assert!(!pending);
        }
        _ => panic!("unexpected event"),
    }
    assert!(!cache.is_current(spice_cache_resource_image(), 77, image_epoch));
    assert!(!cache.is_current(spice_cache_resource_pixmap(), 77, pixmap_epoch));
}

#[test]
fn all_pixmap_invalidation_without_waits_is_immediate() {
    let mut state = SpiceDisplayState::new();
    let mut graph = SpiceMutationGraph::new();
    let mut cache = SpiceCacheEpochs::new();
    let image_epoch = cache.claim(spice_cache_resource_image(), 77);

    let event = state
        .handle_message(
            wire::SPICE_MSG_DISPLAY_INVAL_ALL_PIXMAPS,
            &[0],
            &mut graph,
            &mut cache,
        )
        .unwrap()
        .unwrap();

    match event {
        DisplayEvent::CacheInvalidateAllPixmaps { epoch, pending, .. } => {
            assert!(epoch.is_some());
            assert!(!pending);
        }
        _ => panic!("unexpected event"),
    }
    assert!(!cache.is_current(spice_cache_resource_image(), 77, image_epoch));
    assert!(state
        .flush_satisfied_barriers(&graph, &mut cache)
        .is_empty());
}
