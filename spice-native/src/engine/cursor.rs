/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::collections::HashMap;

use serde::Serialize;

use crate::pixel::cursor_to_rgba_pixels;
use crate::wire;

#[derive(Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(super) enum EngineCursorEvent {
    Init {
        position: EnginePoint16,
        trail_length: u16,
        trail_frequency: u16,
        visible: bool,
        cursor: Option<EngineCursorImage>,
    },
    Set {
        position: EnginePoint16,
        visible: bool,
        cursor: Option<EngineCursorImage>,
    },
    Move {
        position: EnginePoint16,
    },
    Hide,
    Reset,
    Trail {
        length: u16,
        frequency: u16,
    },
    InvalidateOne {
        unique: String,
    },
    InvalidateAll,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EnginePoint16 {
    x: i16,
    y: i16,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EngineCursorImage {
    unique: String,
    cursor_type: u8,
    width: u16,
    height: u16,
    hot_spot_x: u16,
    hot_spot_y: u16,
    flags: u16,
    rgba: Vec<u8>,
}

#[derive(Default)]
pub(super) struct CursorCache {
    images: HashMap<u64, EngineCursorImage>,
}

impl CursorCache {
    pub(super) fn handle(
        &mut self,
        message: u16,
        body: &[u8],
    ) -> wire::WireResult<Option<EngineCursorEvent>> {
        match message {
            wire::SPICE_MSG_CURSOR_INIT => {
                let init = wire::parse_cursor_init(body)?;
                self.images.clear();
                Ok(Some(EngineCursorEvent::Init {
                    position: engine_point16(init.position),
                    trail_length: init.trail_length,
                    trail_frequency: init.trail_frequency,
                    visible: init.visible != 0,
                    cursor: self.cursor_image(&init.cursor),
                }))
            }
            wire::SPICE_MSG_CURSOR_SET => {
                let set = wire::parse_cursor_set(body)?;
                Ok(Some(EngineCursorEvent::Set {
                    position: engine_point16(set.position),
                    visible: set.visible != 0,
                    cursor: self.cursor_image(&set.cursor),
                }))
            }
            wire::SPICE_MSG_CURSOR_MOVE => {
                let move_ = wire::parse_cursor_move(body)?;
                Ok(Some(EngineCursorEvent::Move {
                    position: engine_point16(move_.position),
                }))
            }
            wire::SPICE_MSG_CURSOR_HIDE => Ok(Some(EngineCursorEvent::Hide)),
            wire::SPICE_MSG_CURSOR_RESET => {
                self.images.clear();
                Ok(Some(EngineCursorEvent::Reset))
            }
            wire::SPICE_MSG_CURSOR_TRAIL => {
                let trail = wire::parse_cursor_trail(body)?;
                Ok(Some(EngineCursorEvent::Trail {
                    length: trail.length,
                    frequency: trail.frequency,
                }))
            }
            wire::SPICE_MSG_CURSOR_INVAL_ONE => {
                let invalidation = wire::parse_cursor_inval_one(body)?;
                self.images.remove(&invalidation.id);
                Ok(Some(EngineCursorEvent::InvalidateOne {
                    unique: invalidation.id.to_string(),
                }))
            }
            wire::SPICE_MSG_CURSOR_INVAL_ALL => {
                self.images.clear();
                Ok(Some(EngineCursorEvent::InvalidateAll))
            }
            _ => Ok(None),
        }
    }

    pub(super) fn clear(&mut self) {
        self.images.clear();
    }

    fn cursor_image(&mut self, cursor: &wire::Cursor) -> Option<EngineCursorImage> {
        if (cursor.flags & wire::SPICE_CURSOR_FLAGS_FROM_CACHE) != 0 {
            return cursor
                .header
                .as_ref()
                .and_then(|header| self.images.get(&header.unique).cloned());
        }

        let unique = cursor.header.as_ref().map(|header| header.unique);
        let image = engine_cursor_image(cursor)?;
        if (cursor.flags & wire::SPICE_CURSOR_FLAGS_CACHE_ME) != 0 {
            if let Some(unique) = unique {
                self.images.insert(unique, image.clone());
            }
        }
        Some(image)
    }
}

fn engine_point16(point: wire::Point16) -> EnginePoint16 {
    EnginePoint16 {
        x: point.x,
        y: point.y,
    }
}

fn engine_cursor_image(cursor: &wire::Cursor) -> Option<EngineCursorImage> {
    let header = cursor.header?;
    let rgba = cursor_to_rgba_pixels(
        header.cursor_type,
        &cursor.data,
        header.width,
        header.height,
    )?;
    Some(EngineCursorImage {
        unique: header.unique.to_string(),
        cursor_type: header.cursor_type,
        width: header.width,
        height: header.height,
        hot_spot_x: header.hot_spot_x,
        hot_spot_y: header.hot_spot_y,
        flags: cursor.flags,
        rgba,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cursor_cache_resolves_from_cache_set() {
        let mut cache = CursorCache::default();

        let cached = cache
            .handle(
                wire::SPICE_MSG_CURSOR_SET,
                &cursor_set_body(2, 42, &[3, 2, 1, 4]),
            )
            .unwrap()
            .unwrap();
        assert_cursor_rgba(cached, &[1, 2, 3, 4]);

        let restored = cache
            .handle(wire::SPICE_MSG_CURSOR_SET, &cursor_set_from_cache_body(42))
            .unwrap()
            .unwrap();
        assert_cursor_rgba(restored, &[1, 2, 3, 4]);
    }

    #[test]
    fn cursor_cache_honors_invalidation() {
        let mut cache = CursorCache::default();
        let _ = cache
            .handle(
                wire::SPICE_MSG_CURSOR_SET,
                &cursor_set_body(2, 77, &[9, 8, 7, 6]),
            )
            .unwrap();

        let mut inval = Vec::new();
        push_u64(&mut inval, 77);
        let _ = cache
            .handle(wire::SPICE_MSG_CURSOR_INVAL_ONE, &inval)
            .unwrap();

        let restored = cache
            .handle(wire::SPICE_MSG_CURSOR_SET, &cursor_set_from_cache_body(77))
            .unwrap()
            .unwrap();
        assert_cursor_missing(restored);
    }

    #[test]
    fn cursor_init_and_reset_clear_cache() {
        let mut cache = CursorCache::default();
        let _ = cache
            .handle(
                wire::SPICE_MSG_CURSOR_SET,
                &cursor_set_body(2, 88, &[9, 8, 7, 6]),
            )
            .unwrap();

        let _ = cache
            .handle(wire::SPICE_MSG_CURSOR_RESET, &[])
            .unwrap()
            .unwrap();
        let restored = cache
            .handle(wire::SPICE_MSG_CURSOR_SET, &cursor_set_from_cache_body(88))
            .unwrap()
            .unwrap();
        assert_cursor_missing(restored);

        let _ = cache
            .handle(
                wire::SPICE_MSG_CURSOR_SET,
                &cursor_set_body(2, 88, &[9, 8, 7, 6]),
            )
            .unwrap();
        let _ = cache
            .handle(
                wire::SPICE_MSG_CURSOR_INIT,
                &cursor_init_body_from_cache(88),
            )
            .unwrap()
            .unwrap();
        let restored = cache
            .handle(wire::SPICE_MSG_CURSOR_SET, &cursor_set_from_cache_body(88))
            .unwrap()
            .unwrap();
        assert_cursor_missing(restored);
    }

    fn assert_cursor_rgba(event: EngineCursorEvent, expected: &[u8]) {
        let image = match event {
            EngineCursorEvent::Init { cursor, .. } | EngineCursorEvent::Set { cursor, .. } => {
                cursor.expect("cursor image")
            }
            _ => panic!("expected cursor image event"),
        };
        assert_eq!(image.rgba, expected);
        assert_eq!(image.unique, "42");
    }

    fn assert_cursor_missing(event: EngineCursorEvent) {
        match event {
            EngineCursorEvent::Init { cursor, .. } | EngineCursorEvent::Set { cursor, .. } => {
                assert!(cursor.is_none());
            }
            _ => panic!("expected cursor image event"),
        }
    }

    fn cursor_set_body(flags: u16, unique: u64, bgra: &[u8]) -> Vec<u8> {
        let mut body = Vec::new();
        push_u16(&mut body, 10);
        push_u16(&mut body, 20);
        body.push(1);
        push_cursor(&mut body, flags, unique, bgra);
        body
    }

    fn cursor_set_from_cache_body(unique: u64) -> Vec<u8> {
        let mut body = Vec::new();
        push_u16(&mut body, 10);
        push_u16(&mut body, 20);
        body.push(1);
        push_cursor(&mut body, wire::SPICE_CURSOR_FLAGS_FROM_CACHE, unique, &[]);
        body
    }

    fn cursor_init_body_from_cache(unique: u64) -> Vec<u8> {
        let mut body = Vec::new();
        push_u16(&mut body, 10);
        push_u16(&mut body, 20);
        push_u16(&mut body, 0);
        push_u16(&mut body, 0);
        body.push(1);
        push_cursor(&mut body, wire::SPICE_CURSOR_FLAGS_FROM_CACHE, unique, &[]);
        body
    }

    fn push_cursor(body: &mut Vec<u8>, flags: u16, unique: u64, bgra: &[u8]) {
        push_u16(body, flags);
        push_u64(body, unique);
        body.push(0);
        push_u16(body, 1);
        push_u16(body, 1);
        push_u16(body, 0);
        push_u16(body, 0);
        body.extend_from_slice(bgra);
    }

    fn push_u16(out: &mut Vec<u8>, value: u16) {
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn push_u64(out: &mut Vec<u8>, value: u64) {
        out.extend_from_slice(&value.to_le_bytes());
    }
}
