/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use rustc_hash::FxHashMap;

use wasm_bindgen::prelude::*;

const CACHE_RESOURCE_IMAGE: u8 = 1;
const CACHE_RESOURCE_PALETTE: u8 = 2;
const CACHE_RESOURCE_CURSOR: u8 = 3;
const CACHE_RESOURCE_GLZ: u8 = 4;
const CACHE_RESOURCE_DECODE: u8 = 5;
const CACHE_RESOURCE_GPU: u8 = 6;
const CACHE_RESOURCE_PIXMAP: u8 = 7;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct CacheKey {
    kind: u8,
    id: u64,
}

/// Native cache epoch table.
///
/// Browser storage and GPU adapters may retain bytes/resources, but this table
/// decides whether a cached object is legal for current protocol state.
#[wasm_bindgen]
pub struct SpiceCacheEpochs {
    next_epoch: u64,
    global_epoch: u64,
    kind_epochs: FxHashMap<u8, u64>,
    resource_epochs: FxHashMap<CacheKey, u64>,
}

#[wasm_bindgen]
impl SpiceCacheEpochs {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SpiceCacheEpochs {
        SpiceCacheEpochs {
            next_epoch: 1,
            global_epoch: 1,
            kind_epochs: FxHashMap::default(),
            resource_epochs: FxHashMap::default(),
        }
    }

    pub fn global_epoch(&self) -> u64 {
        self.global_epoch
    }

    pub fn epoch(&self, kind: u8, id: u64) -> u64 {
        self.resource_epochs
            .get(&CacheKey { kind, id })
            .copied()
            .unwrap_or_else(|| self.kind_epoch(kind))
    }

    pub fn kind_epoch(&self, kind: u8) -> u64 {
        self.kind_epochs
            .get(&kind)
            .copied()
            .unwrap_or(self.global_epoch)
    }

    pub fn claim(&self, kind: u8, id: u64) -> u64 {
        self.epoch(kind, id)
    }

    pub fn is_current(&self, kind: u8, id: u64, epoch: u64) -> bool {
        self.epoch(kind, id) == epoch
    }

    pub fn bump_resource(&mut self, kind: u8, id: u64) -> u64 {
        let next = self.next_epoch();
        self.resource_epochs.insert(CacheKey { kind, id }, next);
        next
    }

    pub fn bump_kind(&mut self, kind: u8) -> u64 {
        let next = self.next_epoch();
        self.kind_epochs.insert(kind, next);
        self.resource_epochs.retain(|key, _| key.kind != kind);
        next
    }

    pub fn bump_all(&mut self) -> u64 {
        let next = self.next_epoch();
        self.global_epoch = next;
        self.kind_epochs.clear();
        self.resource_epochs.clear();
        next
    }

    pub fn resource_count(&self) -> u32 {
        self.resource_epochs.len() as u32
    }

    pub fn kind_count(&self) -> u32 {
        self.kind_epochs.len() as u32
    }

    pub fn clear(&mut self) {
        self.next_epoch = 1;
        self.global_epoch = 1;
        self.kind_epochs.clear();
        self.resource_epochs.clear();
    }
}

impl SpiceCacheEpochs {
    fn next_epoch(&mut self) -> u64 {
        self.next_epoch = self.next_epoch.saturating_add(1).max(1);
        self.next_epoch
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtocolCacheKind {
    Image,
    Palette,
    Cursor,
    Glz,
    Pixmap,
}

impl ProtocolCacheKind {
    pub fn resource_id(self) -> u8 {
        match self {
            ProtocolCacheKind::Image => CACHE_RESOURCE_IMAGE,
            ProtocolCacheKind::Palette => CACHE_RESOURCE_PALETTE,
            ProtocolCacheKind::Cursor => CACHE_RESOURCE_CURSOR,
            ProtocolCacheKind::Glz => CACHE_RESOURCE_GLZ,
            ProtocolCacheKind::Pixmap => CACHE_RESOURCE_PIXMAP,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProtocolCacheRecord {
    pub kind: ProtocolCacheKind,
    pub id: u64,
    pub byte_cost: u64,
    pub epoch: u64,
    pub lossy: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProtocolCacheInsert {
    pub accepted: bool,
    pub record: Option<ProtocolCacheRecord>,
    pub evicted: Vec<ProtocolCacheRecord>,
}

#[derive(Clone, Copy, Debug)]
struct ProtocolCacheNode {
    record: ProtocolCacheRecord,
    previous: Option<u64>,
    next: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct ProtocolCacheTable {
    kind: ProtocolCacheKind,
    capacity_bytes: u64,
    used_bytes: u64,
    next_epoch: u64,
    head: Option<u64>,
    tail: Option<u64>,
    frozen: bool,
    entries: FxHashMap<u64, ProtocolCacheNode>,
}

impl ProtocolCacheTable {
    pub fn new(kind: ProtocolCacheKind, capacity_bytes: u64) -> Self {
        Self {
            kind,
            capacity_bytes,
            used_bytes: 0,
            next_epoch: 1,
            head: None,
            tail: None,
            frozen: false,
            entries: FxHashMap::default(),
        }
    }

    pub fn kind(&self) -> ProtocolCacheKind {
        self.kind
    }

    pub fn capacity_bytes(&self) -> u64 {
        self.capacity_bytes
    }

    pub fn used_bytes(&self) -> u64 {
        self.used_bytes
    }

    pub fn available_bytes(&self) -> u64 {
        self.capacity_bytes.saturating_sub(self.used_bytes)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn is_frozen(&self) -> bool {
        self.frozen
    }

    pub fn freeze(&mut self) {
        self.frozen = true;
    }

    pub fn clear(&mut self) -> Vec<ProtocolCacheRecord> {
        let mut removed = Vec::with_capacity(self.entries.len());
        let mut current = self.head;
        while let Some(id) = current {
            let Some(node) = self.entries.get(&id) else {
                break;
            };
            removed.push(node.record);
            current = node.next;
        }
        self.entries.clear();
        self.head = None;
        self.tail = None;
        self.used_bytes = 0;
        self.frozen = false;
        self.next_epoch = self.next_epoch.saturating_add(1).max(1);
        removed
    }

    pub fn peek(&self, id: u64) -> Option<ProtocolCacheRecord> {
        if self.frozen {
            return None;
        }
        self.entries.get(&id).map(|node| node.record)
    }

    pub fn find(&mut self, id: u64) -> Option<ProtocolCacheRecord> {
        if self.frozen {
            return None;
        }
        let record = self.entries.get(&id).map(|node| node.record)?;
        self.touch(id);
        Some(record)
    }

    pub fn set_lossy(&mut self, id: u64, lossy: bool) -> bool {
        let Some(node) = self.entries.get_mut(&id) else {
            return false;
        };
        node.record.lossy = lossy;
        true
    }

    pub fn insert(&mut self, id: u64, byte_cost: u64, lossy: bool) -> ProtocolCacheInsert {
        if self.frozen || byte_cost > self.capacity_bytes {
            return ProtocolCacheInsert {
                accepted: false,
                record: None,
                evicted: Vec::new(),
            };
        }

        let mut evicted = Vec::new();
        if self.entries.contains_key(&id) {
            if let Some(record) = self.remove(id) {
                evicted.push(record);
            }
        }

        while self.used_bytes.saturating_add(byte_cost) > self.capacity_bytes {
            let Some(tail) = self.tail else {
                break;
            };
            if let Some(record) = self.remove(tail) {
                evicted.push(record);
            }
        }

        if self.used_bytes.saturating_add(byte_cost) > self.capacity_bytes {
            return ProtocolCacheInsert {
                accepted: false,
                record: None,
                evicted,
            };
        }

        let record = ProtocolCacheRecord {
            kind: self.kind,
            id,
            byte_cost,
            epoch: self.allocate_epoch(),
            lossy,
        };
        let node = ProtocolCacheNode {
            record,
            previous: None,
            next: self.head,
        };
        if let Some(head) = self.head {
            if let Some(head_node) = self.entries.get_mut(&head) {
                head_node.previous = Some(id);
            }
        } else {
            self.tail = Some(id);
        }
        self.head = Some(id);
        self.used_bytes = self.used_bytes.saturating_add(byte_cost);
        self.entries.insert(id, node);

        ProtocolCacheInsert {
            accepted: true,
            record: Some(record),
            evicted,
        }
    }

    pub fn invalidate(&mut self, id: u64) -> Option<ProtocolCacheRecord> {
        self.remove(id)
    }

    fn allocate_epoch(&mut self) -> u64 {
        self.next_epoch = self.next_epoch.saturating_add(1).max(1);
        self.next_epoch
    }

    fn touch(&mut self, id: u64) {
        if self.head == Some(id) {
            return;
        }
        let Some(node) = self.entries.get(&id).copied() else {
            return;
        };
        self.unlink(id, node);
        let old_head = self.head;
        if let Some(entry) = self.entries.get_mut(&id) {
            entry.previous = None;
            entry.next = old_head;
        }
        if let Some(head) = old_head {
            if let Some(head_entry) = self.entries.get_mut(&head) {
                head_entry.previous = Some(id);
            }
        } else {
            self.tail = Some(id);
        }
        self.head = Some(id);
    }

    fn remove(&mut self, id: u64) -> Option<ProtocolCacheRecord> {
        let node = self.entries.get(&id).copied()?;
        self.unlink(id, node);
        let node = self.entries.remove(&id)?;
        self.used_bytes = self.used_bytes.saturating_sub(node.record.byte_cost);
        Some(node.record)
    }

    fn unlink(&mut self, id: u64, node: ProtocolCacheNode) {
        match node.previous {
            Some(previous) => {
                if let Some(previous_node) = self.entries.get_mut(&previous) {
                    previous_node.next = node.next;
                }
            }
            None => {
                self.head = node.next;
            }
        }
        match node.next {
            Some(next) => {
                if let Some(next_node) = self.entries.get_mut(&next) {
                    next_node.previous = node.previous;
                }
            }
            None => {
                self.tail = node.previous;
            }
        }
        if self.head == Some(id) {
            self.head = node.next;
        }
        if self.tail == Some(id) {
            self.tail = node.previous;
        }
    }
}

#[wasm_bindgen]
pub fn spice_cache_resource_image() -> u8 {
    CACHE_RESOURCE_IMAGE
}

#[wasm_bindgen]
pub fn spice_cache_resource_palette() -> u8 {
    CACHE_RESOURCE_PALETTE
}

#[wasm_bindgen]
pub fn spice_cache_resource_cursor() -> u8 {
    CACHE_RESOURCE_CURSOR
}

#[wasm_bindgen]
pub fn spice_cache_resource_glz() -> u8 {
    CACHE_RESOURCE_GLZ
}

#[wasm_bindgen]
pub fn spice_cache_resource_decode() -> u8 {
    CACHE_RESOURCE_DECODE
}

#[wasm_bindgen]
pub fn spice_cache_resource_gpu() -> u8 {
    CACHE_RESOURCE_GPU
}

#[wasm_bindgen]
pub fn spice_cache_resource_pixmap() -> u8 {
    CACHE_RESOURCE_PIXMAP
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn specific_resource_invalidation_rejects_only_that_resource() {
        let mut epochs = SpiceCacheEpochs::new();
        let image_10 = epochs.claim(CACHE_RESOURCE_IMAGE, 10);
        let image_11 = epochs.claim(CACHE_RESOURCE_IMAGE, 11);

        epochs.bump_resource(CACHE_RESOURCE_IMAGE, 10);

        assert!(!epochs.is_current(CACHE_RESOURCE_IMAGE, 10, image_10));
        assert!(epochs.is_current(CACHE_RESOURCE_IMAGE, 11, image_11));
    }

    #[test]
    fn kind_invalidation_rejects_all_resources_of_kind() {
        let mut epochs = SpiceCacheEpochs::new();
        let image = epochs.claim(CACHE_RESOURCE_IMAGE, 10);
        let palette = epochs.claim(CACHE_RESOURCE_PALETTE, 10);

        epochs.bump_kind(CACHE_RESOURCE_IMAGE);

        assert!(!epochs.is_current(CACHE_RESOURCE_IMAGE, 10, image));
        assert!(epochs.is_current(CACHE_RESOURCE_PALETTE, 10, palette));
    }

    #[test]
    fn global_invalidation_rejects_everything() {
        let mut epochs = SpiceCacheEpochs::new();
        let image = epochs.claim(CACHE_RESOURCE_IMAGE, 10);
        let palette = epochs.claim(CACHE_RESOURCE_PALETTE, 10);

        epochs.bump_all();

        assert!(!epochs.is_current(CACHE_RESOURCE_IMAGE, 10, image));
        assert!(!epochs.is_current(CACHE_RESOURCE_PALETTE, 10, palette));
    }

    #[test]
    fn protocol_cache_evicts_lru_records_when_capacity_is_reached() {
        let mut cache = ProtocolCacheTable::new(ProtocolCacheKind::Pixmap, 10);
        assert!(cache.insert(1, 4, false).accepted);
        assert!(cache.insert(2, 4, false).accepted);

        let result = cache.insert(3, 4, false);

        assert!(result.accepted);
        assert_eq!(
            result
                .evicted
                .iter()
                .map(|record| record.id)
                .collect::<Vec<_>>(),
            vec![1]
        );
        assert!(cache.peek(1).is_none());
        assert!(cache.peek(2).is_some());
        assert!(cache.peek(3).is_some());
    }

    #[test]
    fn protocol_cache_find_refreshes_lru_order() {
        let mut cache = ProtocolCacheTable::new(ProtocolCacheKind::Image, 10);
        assert!(cache.insert(1, 4, false).accepted);
        assert!(cache.insert(2, 4, false).accepted);
        assert_eq!(cache.find(1).unwrap().id, 1);

        let result = cache.insert(3, 4, false);

        assert!(result.accepted);
        assert_eq!(
            result
                .evicted
                .iter()
                .map(|record| record.id)
                .collect::<Vec<_>>(),
            vec![2]
        );
        assert!(cache.peek(1).is_some());
        assert!(cache.peek(2).is_none());
    }

    #[test]
    fn protocol_cache_tracks_lossy_and_invalidation() {
        let mut cache = ProtocolCacheTable::new(ProtocolCacheKind::Pixmap, 16);
        let first = cache.insert(9, 8, false).record.unwrap();
        assert!(!first.lossy);

        assert!(cache.set_lossy(9, true));
        assert!(cache.peek(9).unwrap().lossy);

        let removed = cache.invalidate(9).unwrap();
        assert_eq!(removed.id, 9);
        assert!(cache.peek(9).is_none());
    }

    #[test]
    fn protocol_cache_freeze_refuses_lookups_and_new_entries_until_clear() {
        let mut cache = ProtocolCacheTable::new(ProtocolCacheKind::Cursor, 4);
        assert!(cache.insert(1, 1, false).accepted);

        cache.freeze();

        assert!(cache.find(1).is_none());
        assert!(!cache.insert(2, 1, false).accepted);

        let removed = cache.clear();
        assert_eq!(removed.len(), 1);
        assert!(!cache.is_frozen());
        assert!(cache.insert(2, 1, false).accepted);
    }
}
