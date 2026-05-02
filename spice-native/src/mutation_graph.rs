/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::collections::HashMap;

use wasm_bindgen::prelude::*;

const CHECK_CURRENT: u8 = 0;
const CHECK_SURFACE_GENERATION: u8 = 1;
const CHECK_TOKEN_MISSING: u8 = 2;
const CHECK_REGION_OWNER: u8 = 3;
const CHECK_REGION_OWNER_TOMBSTONE: u8 = 4;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl Rect {
    fn is_empty(self) -> bool {
        self.left >= self.right || self.top >= self.bottom
    }

    fn intersects(self, other: Rect) -> bool {
        !self.is_empty()
            && !other.is_empty()
            && self.left < other.right
            && self.right > other.left
            && self.top < other.bottom
            && self.bottom > other.top
    }
}

#[derive(Clone, Debug)]
struct RegionOwner {
    surface_id: u32,
    surface_generation: u32,
    sequence_id: u64,
    plan_token: u64,
    rect: Rect,
    superseded_by: Option<SupersedingOwner>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SupersedingOwner {
    sequence_id: u64,
    canceled: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ChannelSerial {
    channel_type: u8,
    channel_id: u8,
    serial: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct OrderingBarrier {
    barrier_id: u64,
    waits: Vec<ChannelSerial>,
}

/// WASM-owned visual mutation graph.
///
/// JS may ask for claims and later ask whether a claim is still current, but JS
/// must not be the authority for stale visual commits.
#[wasm_bindgen]
pub struct SpiceMutationGraph {
    next_token: u64,
    next_barrier: u64,
    owners: HashMap<u64, RegionOwner>,
    tombstones: Vec<RegionOwner>,
    surface_generations: HashMap<u32, u32>,
    observed_channel_serials: HashMap<(u8, u8), u64>,
    ordering_barriers: Vec<OrderingBarrier>,
}

#[wasm_bindgen]
impl SpiceMutationGraph {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SpiceMutationGraph {
        SpiceMutationGraph {
            next_token: 1,
            next_barrier: 1,
            owners: HashMap::new(),
            tombstones: Vec::new(),
            surface_generations: HashMap::new(),
            observed_channel_serials: HashMap::new(),
            ordering_barriers: Vec::new(),
        }
    }

    pub fn set_surface_generation(&mut self, surface_id: u32, generation: u32) {
        self.surface_generations.insert(surface_id, generation);
        self.prune_surface_generations(surface_id, generation);
    }

    pub fn bump_surface_generation(&mut self, surface_id: u32) -> u32 {
        let generation = self
            .surface_generations
            .get(&surface_id)
            .copied()
            .unwrap_or(0)
            .saturating_add(1);
        self.set_surface_generation(surface_id, generation);
        generation
    }

    pub fn surface_generation(&self, surface_id: u32) -> u32 {
        self.surface_generations
            .get(&surface_id)
            .copied()
            .unwrap_or(0)
    }

    pub fn claim_rect(
        &mut self,
        surface_id: u32,
        surface_generation: u32,
        sequence_id: u64,
        plan_token: u64,
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    ) -> u64 {
        let token = self.next_token;
        self.next_token = self.next_token.saturating_add(1).max(1);

        let rect = Rect {
            left,
            top,
            right,
            bottom,
        };

        self.owners.insert(
            token,
            RegionOwner {
                surface_id,
                surface_generation,
                sequence_id,
                plan_token,
                rect,
                superseded_by: None,
            },
        );
        token
    }

    pub fn check_token(&self, token: u64) -> u8 {
        let Some(owner) = self.owners.get(&token) else {
            return CHECK_TOKEN_MISSING;
        };
        self.check_owner(owner)
    }

    pub fn check_token_for_surface(&self, token: u64, current_generation: u32) -> u8 {
        let Some(owner) = self.owners.get(&token) else {
            return CHECK_TOKEN_MISSING;
        };
        if owner.surface_generation != current_generation {
            return CHECK_SURFACE_GENERATION;
        }
        self.check_owner(owner)
    }

    pub fn commit_token(&mut self, token: u64) -> bool {
        if self.check_token(token) != CHECK_CURRENT {
            return false;
        }
        let Some(owner) = self.owners.remove(&token) else {
            return false;
        };
        self.mark_older_overlapping_owners_superseded(&owner);
        true
    }

    pub fn cancel_plan(&mut self, plan_token: u64) -> u32 {
        let mut canceled = 0u32;
        let matching: Vec<u64> = self
            .owners
            .iter()
            .filter_map(|(token, owner)| (owner.plan_token == plan_token).then_some(*token))
            .collect();

        for token in matching {
            if let Some(owner) = self.owners.remove(&token) {
                self.mark_superseded_owner_canceled(&owner);
                self.tombstones.push(owner);
                canceled = canceled.saturating_add(1);
            }
        }
        canceled
    }

    pub fn release_token(&mut self, token: u64) -> bool {
        self.owners.remove(&token).is_some()
    }

    pub fn owner_count(&self) -> u32 {
        self.owners.len() as u32
    }

    pub fn tombstone_count(&self) -> u32 {
        self.tombstones.len() as u32
    }

    pub fn observe_channel_serial(&mut self, channel_type: u8, channel_id: u8, serial: u64) -> u32 {
        let key = (channel_type, channel_id);
        let entry = self.observed_channel_serials.entry(key).or_insert(0);
        if *entry < serial {
            *entry = serial;
        }
        self.prune_satisfied_barriers()
    }

    pub fn add_wait_barrier(&mut self, waits: Vec<u8>) -> u64 {
        let mut parsed_waits = Vec::new();
        let mut index = 0usize;
        while index.saturating_add(10) <= waits.len() {
            let channel_type = waits[index];
            let channel_id = waits[index + 1];
            let serial = u64::from_le_bytes([
                waits[index + 2],
                waits[index + 3],
                waits[index + 4],
                waits[index + 5],
                waits[index + 6],
                waits[index + 7],
                waits[index + 8],
                waits[index + 9],
            ]);
            parsed_waits.push(ChannelSerial {
                channel_type,
                channel_id,
                serial,
            });
            index += 10;
        }

        self.add_parsed_wait_barrier(parsed_waits)
    }

    pub fn is_barrier_satisfied(&self, barrier_id: u64) -> bool {
        !self
            .ordering_barriers
            .iter()
            .any(|barrier| barrier.barrier_id == barrier_id)
    }

    pub fn barrier_count(&self) -> u32 {
        self.ordering_barriers.len() as u32
    }

    pub fn clear(&mut self) {
        self.owners.clear();
        self.tombstones.clear();
        self.surface_generations.clear();
        self.observed_channel_serials.clear();
        self.ordering_barriers.clear();
        self.next_token = 1;
        self.next_barrier = 1;
    }
}

impl SpiceMutationGraph {
    pub(crate) fn add_wait_barrier_serials(
        &mut self,
        waits: impl IntoIterator<Item = (u8, u8, u64)>,
    ) -> u64 {
        let parsed_waits = waits
            .into_iter()
            .map(|(channel_type, channel_id, serial)| ChannelSerial {
                channel_type,
                channel_id,
                serial,
            })
            .collect();
        self.add_parsed_wait_barrier(parsed_waits)
    }

    fn add_parsed_wait_barrier(&mut self, parsed_waits: Vec<ChannelSerial>) -> u64 {
        let barrier_id = self.next_barrier;
        self.next_barrier = self.next_barrier.saturating_add(1).max(1);
        if parsed_waits
            .iter()
            .any(|wait| !self.is_wait_satisfied(*wait))
        {
            self.ordering_barriers.push(OrderingBarrier {
                barrier_id,
                waits: parsed_waits,
            });
        }
        barrier_id
    }

    fn check_owner(&self, owner: &RegionOwner) -> u8 {
        if self
            .surface_generations
            .get(&owner.surface_id)
            .is_some_and(|generation| *generation != owner.surface_generation)
        {
            return CHECK_SURFACE_GENERATION;
        }

        if let Some(superseding_owner) = owner.superseded_by {
            return if superseding_owner.canceled {
                CHECK_REGION_OWNER_TOMBSTONE
            } else {
                CHECK_REGION_OWNER
            };
        }

        for tombstone in &self.tombstones {
            if tombstone.surface_id == owner.surface_id
                && tombstone.surface_generation == owner.surface_generation
                && tombstone.sequence_id > owner.sequence_id
                && tombstone.rect.intersects(owner.rect)
            {
                return CHECK_REGION_OWNER_TOMBSTONE;
            }
        }

        CHECK_CURRENT
    }

    fn prune_surface_generations(&mut self, surface_id: u32, generation: u32) {
        self.owners.retain(|_, owner| {
            owner.surface_id != surface_id || owner.surface_generation == generation
        });
        self.tombstones.retain(|owner| {
            owner.surface_id != surface_id || owner.surface_generation == generation
        });
    }

    fn mark_older_overlapping_owners_superseded(&mut self, committed_owner: &RegionOwner) {
        for owner in self.owners.values_mut() {
            if owner.surface_id == committed_owner.surface_id
                && owner.surface_generation == committed_owner.surface_generation
                && owner.sequence_id < committed_owner.sequence_id
                && owner.rect.intersects(committed_owner.rect)
            {
                owner.superseded_by = Some(SupersedingOwner {
                    sequence_id: committed_owner.sequence_id,
                    canceled: false,
                });
            }
        }
    }

    fn mark_superseded_owner_canceled(&mut self, canceled_owner: &RegionOwner) {
        for owner in self.owners.values_mut() {
            if owner.surface_id == canceled_owner.surface_id
                && owner.surface_generation == canceled_owner.surface_generation
                && owner.superseded_by.is_some_and(|superseding_owner| {
                    superseding_owner.sequence_id == canceled_owner.sequence_id
                })
            {
                owner.superseded_by = Some(SupersedingOwner {
                    sequence_id: canceled_owner.sequence_id,
                    canceled: true,
                });
            }
        }
    }

    fn is_wait_satisfied(&self, wait: ChannelSerial) -> bool {
        self.observed_channel_serials
            .get(&(wait.channel_type, wait.channel_id))
            .copied()
            .unwrap_or(0)
            >= wait.serial
    }

    fn prune_satisfied_barriers(&mut self) -> u32 {
        let before = self.ordering_barriers.len();
        let observed = &self.observed_channel_serials;
        self.ordering_barriers.retain(|barrier| {
            barrier.waits.iter().any(|wait| {
                observed
                    .get(&(wait.channel_type, wait.channel_id))
                    .copied()
                    .unwrap_or(0)
                    < wait.serial
            })
        });
        before.saturating_sub(self.ordering_barriers.len()) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn late_overlapping_owner_rejects_old_token() {
        let mut graph = SpiceMutationGraph::new();
        graph.set_surface_generation(0, 1);

        let old = graph.claim_rect(0, 1, 10, 100, 0, 0, 64, 64);
        let new = graph.claim_rect(0, 1, 11, 101, 32, 32, 96, 96);

        assert_eq!(graph.check_token(old), CHECK_CURRENT);
        assert_eq!(graph.check_token(new), CHECK_CURRENT);
        assert!(graph.commit_token(new));
        assert_eq!(graph.check_token(old), CHECK_REGION_OWNER);
    }

    #[test]
    fn independent_regions_can_commit_out_of_order() {
        let mut graph = SpiceMutationGraph::new();
        graph.set_surface_generation(0, 1);

        let left = graph.claim_rect(0, 1, 10, 100, 0, 0, 64, 64);
        let right = graph.claim_rect(0, 1, 11, 101, 128, 0, 192, 64);

        assert_eq!(graph.check_token(left), CHECK_CURRENT);
        assert_eq!(graph.check_token(right), CHECK_CURRENT);
    }

    #[test]
    fn surface_generation_rejects_old_surface_work() {
        let mut graph = SpiceMutationGraph::new();
        graph.set_surface_generation(0, 1);
        let token = graph.claim_rect(0, 1, 10, 100, 0, 0, 64, 64);

        graph.bump_surface_generation(0);

        assert_eq!(graph.check_token(token), CHECK_TOKEN_MISSING);
        assert_eq!(graph.check_token_for_surface(token, 2), CHECK_TOKEN_MISSING);
    }

    #[test]
    fn canceled_later_plan_leaves_tombstone_for_older_work() {
        let mut graph = SpiceMutationGraph::new();
        graph.set_surface_generation(0, 1);

        let old = graph.claim_rect(0, 1, 10, 100, 0, 0, 64, 64);
        let later = graph.claim_rect(0, 1, 11, 101, 32, 32, 96, 96);
        assert_eq!(graph.cancel_plan(101), 1);

        assert_eq!(graph.check_token(old), CHECK_REGION_OWNER_TOMBSTONE);
        assert_eq!(graph.check_token(later), CHECK_TOKEN_MISSING);
    }

    #[test]
    fn wait_barrier_tracks_cross_channel_serials_until_observed() {
        let mut graph = SpiceMutationGraph::new();
        let mut waits = Vec::new();
        waits.extend_from_slice(&[2, 0]);
        waits.extend_from_slice(&11u64.to_le_bytes());
        waits.extend_from_slice(&[4, 1]);
        waits.extend_from_slice(&12u64.to_le_bytes());

        let barrier = graph.add_wait_barrier(waits);

        assert_eq!(graph.barrier_count(), 1);
        assert!(!graph.is_barrier_satisfied(barrier));
        assert_eq!(graph.observe_channel_serial(2, 0, 11), 0);
        assert!(!graph.is_barrier_satisfied(barrier));
        assert_eq!(graph.observe_channel_serial(4, 1, 12), 1);
        assert!(graph.is_barrier_satisfied(barrier));
    }

    #[test]
    fn already_observed_wait_barrier_is_satisfied_immediately() {
        let mut graph = SpiceMutationGraph::new();
        graph.observe_channel_serial(2, 0, 20);
        let mut waits = Vec::new();
        waits.extend_from_slice(&[2, 0]);
        waits.extend_from_slice(&11u64.to_le_bytes());

        let barrier = graph.add_wait_barrier(waits);

        assert_eq!(graph.barrier_count(), 0);
        assert!(graph.is_barrier_satisfied(barrier));
    }
}
