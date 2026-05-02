/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::display_draw::DrawRect;

pub fn dirty_rect_area(rects: &[DrawRect]) -> u32 {
    rects.iter().fold(0u32, |area, rect| {
        let width = (rect.right - rect.left).max(0) as u32;
        let height = (rect.bottom - rect.top).max(0) as u32;
        area.saturating_add(width.saturating_mul(height))
    })
}

pub fn should_flatten_dirty_rects(rects: &[DrawRect], surface_area: u32) -> bool {
    if rects.len() >= 32 {
        return true;
    }
    let dirty_area = dirty_rect_area(rects);
    surface_area > 0 && dirty_area.saturating_mul(100) >= surface_area.saturating_mul(35)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dirty_rect_flattening_trips_for_many_small_updates() {
        let rects = (0..40)
            .map(|index| DrawRect {
                left: index,
                top: 0,
                right: index + 1,
                bottom: 4,
            })
            .collect::<Vec<_>>();

        assert!(should_flatten_dirty_rects(&rects, 1920 * 1080));
    }

    #[test]
    fn dirty_rect_flattening_trips_for_dense_area() {
        let rects = [DrawRect {
            left: 0,
            top: 0,
            right: 800,
            bottom: 600,
        }];

        assert!(should_flatten_dirty_rects(&rects, 1024 * 768));
    }
}
