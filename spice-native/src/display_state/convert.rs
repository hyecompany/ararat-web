/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::display_events::{
    DisplayCacheResource, DisplayClip, DisplayFrameHint, DisplayHead, DisplayPoint, DisplayRect,
    DisplayWaitChannel,
};
use crate::display_planner::DisplayFramePlan;
use crate::wire;

pub(super) fn display_parse_error(error: wire::WireParseError) -> String {
    error.message().to_string()
}

pub(super) fn display_point(point: wire::Point) -> DisplayPoint {
    DisplayPoint {
        x: point.x,
        y: point.y,
    }
}

pub(super) fn display_rect(rect: wire::Rect) -> DisplayRect {
    DisplayRect {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
    }
}

pub(super) fn display_clip(clip: wire::Clip) -> DisplayClip {
    DisplayClip {
        clip_type: clip.clip_type,
        rects: clip.rects.into_iter().map(display_rect).collect(),
    }
}

pub(super) fn display_head(head: wire::MonitorHead) -> DisplayHead {
    DisplayHead {
        monitor_id: head.monitor_id,
        surface_id: head.surface_id,
        width: head.width,
        height: head.height,
        x: head.x,
        y: head.y,
        flags: head.flags,
    }
}

pub(super) fn display_wait_channel(wait: wire::ChannelWait) -> DisplayWaitChannel {
    DisplayWaitChannel {
        channel_type: wait.channel_type,
        channel_id: wait.channel_id,
        message_serial: wait.message_serial,
    }
}

pub(super) fn display_cache_resource(resource: wire::DisplayResource) -> DisplayCacheResource {
    DisplayCacheResource {
        resource_type: resource.resource_type,
        id: resource.id,
    }
}

pub(super) fn display_frame_hint(plan: DisplayFramePlan) -> DisplayFrameHint {
    match plan {
        DisplayFramePlan::None => DisplayFrameHint::None,
        DisplayFramePlan::BitmapStrip(strip) => DisplayFrameHint::BitmapStrip {
            run_id: strip.run_id,
            starts_run: strip.starts_run,
            closes_previous_run: strip.closes_previous_run,
            item_count: strip.item_count,
        },
    }
}
