/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::display_draw::{DrawCopyEnvelope, ImagePayloadEnvelope};
use crate::wire::DisplayBase;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BitmapStripFramePlan {
    pub run_id: u64,
    pub starts_run: bool,
    pub closes_previous_run: bool,
    pub item_count: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DisplayFramePlan {
    None,
    BitmapStrip(BitmapStripFramePlan),
}

#[derive(Default)]
pub struct DisplayPlanner {
    next_run_id: u64,
    active_strip: Option<ActiveStripRun>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ActiveStripRun {
    run_id: u64,
    last_right: i32,
    last_bottom: i32,
    item_count: u32,
}

impl DisplayPlanner {
    pub fn new() -> DisplayPlanner {
        DisplayPlanner {
            next_run_id: 1,
            active_strip: None,
        }
    }

    pub fn reset(&mut self) {
        self.next_run_id = 1;
        self.active_strip = None;
    }

    pub fn plan_draw_copy(
        &mut self,
        base: &DisplayBase,
        draw: Option<&DrawCopyEnvelope>,
    ) -> DisplayFramePlan {
        if !is_bitmap_put_strip(base, draw) {
            self.active_strip = None;
            return DisplayFramePlan::None;
        }

        let box_ = base.box_;
        let starts_run = self
            .active_strip
            .map(|active| {
                box_.left != active.last_right || (box_.bottom - active.last_bottom).abs() > 4
            })
            .unwrap_or(true);
        let closes_previous_run = starts_run && self.active_strip.is_some();
        let run_id = if starts_run {
            let next = self.next_run_id;
            self.next_run_id = self.next_run_id.saturating_add(1);
            next
        } else {
            self.active_strip.map(|active| active.run_id).unwrap_or(0)
        };
        self.active_strip = Some(ActiveStripRun {
            run_id,
            last_right: box_.right,
            last_bottom: box_.bottom,
            item_count: if starts_run {
                1
            } else {
                self.active_strip
                    .map(|active| active.item_count.saturating_add(1))
                    .unwrap_or(1)
            },
        });
        let item_count = self
            .active_strip
            .map(|active| active.item_count)
            .unwrap_or(1);
        DisplayFramePlan::BitmapStrip(BitmapStripFramePlan {
            run_id,
            starts_run,
            closes_previous_run,
            item_count,
        })
    }
}

fn is_bitmap_put_strip(base: &DisplayBase, draw: Option<&DrawCopyEnvelope>) -> bool {
    let Some(draw) = draw else {
        return false;
    };
    let Some(image) = draw.src_bitmap.as_ref() else {
        return false;
    };
    let ImagePayloadEnvelope::Bitmap { format, .. } = image.payload else {
        return false;
    };
    let width = base.box_.right - base.box_.left;
    let height = base.box_.bottom - base.box_.top;
    draw.rop_descriptor == 8
        && format == 8
        && width > 0
        && width <= 384
        && height >= 96
        && image.descriptor.width <= 384
        && image.descriptor.height >= 96
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::display_draw::{
        DrawPoint, DrawRect, ImageDescriptorEnvelope, ImageEnvelope, ImagePayloadEnvelope,
        MaskEnvelope,
    };
    use crate::wire::{Clip, DisplayBase, Rect};

    #[test]
    fn bitmap_strips_form_runs_and_mark_boundaries() {
        let mut planner = DisplayPlanner::new();
        let draw = strip_draw();
        let first = planner.plan_draw_copy(&base(0, 32, 120, 760), Some(&draw));
        let second = planner.plan_draw_copy(&base(32, 64, 120, 760), Some(&draw));
        let jump = planner.plan_draw_copy(&base(128, 160, 120, 760), Some(&draw));

        assert_eq!(
            first,
            DisplayFramePlan::BitmapStrip(BitmapStripFramePlan {
                run_id: 1,
                starts_run: true,
                closes_previous_run: false,
                item_count: 1,
            })
        );
        assert_eq!(
            second,
            DisplayFramePlan::BitmapStrip(BitmapStripFramePlan {
                run_id: 1,
                starts_run: false,
                closes_previous_run: false,
                item_count: 2,
            })
        );
        assert_eq!(
            jump,
            DisplayFramePlan::BitmapStrip(BitmapStripFramePlan {
                run_id: 2,
                starts_run: true,
                closes_previous_run: true,
                item_count: 1,
            })
        );
    }

    #[test]
    fn wide_video_tiles_are_frame_planned() {
        let mut planner = DisplayPlanner::new();
        let mut draw = strip_draw();
        if let Some(image) = draw.src_bitmap.as_mut() {
            image.descriptor.width = 256;
            if let ImagePayloadEnvelope::Bitmap { width, stride, .. } = &mut image.payload {
                *width = 256;
                *stride = 1024;
            }
        }
        draw.src_area.right = 256;
        assert!(matches!(
            planner.plan_draw_copy(&base(64, 320, 120, 760), Some(&draw)),
            DisplayFramePlan::BitmapStrip(BitmapStripFramePlan {
                starts_run: true,
                ..
            })
        ));
    }

    fn base(left: i32, right: i32, top: i32, bottom: i32) -> DisplayBase {
        DisplayBase {
            surface_id: 0,
            box_: Rect {
                top,
                left,
                bottom,
                right,
            },
            clip: Clip {
                clip_type: 0,
                rects: Vec::new(),
            },
        }
    }

    fn strip_draw() -> DrawCopyEnvelope {
        DrawCopyEnvelope {
            src_bitmap: Some(ImageEnvelope {
                descriptor: ImageDescriptorEnvelope {
                    id: 0,
                    image_type: 0,
                    flags: 0,
                    cache_me: false,
                    cache_replace_me: false,
                    width: 32,
                    height: 640,
                },
                payload: ImagePayloadEnvelope::Bitmap {
                    format: 8,
                    flags: 4,
                    width: 32,
                    height: 640,
                    stride: 128,
                    palette_cache_me: false,
                    palette_id: None,
                    data_offset: 0,
                    data_length: 0,
                    data: Vec::new(),
                },
            }),
            src_area: DrawRect {
                top: 0,
                left: 0,
                bottom: 640,
                right: 32,
            },
            rop_descriptor: 8,
            scale_mode: 0,
            mask: MaskEnvelope {
                flags: 0,
                pos: DrawPoint { x: 0, y: 0 },
                bitmap: None,
            },
        }
    }
}
