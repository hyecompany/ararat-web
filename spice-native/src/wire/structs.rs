/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct Point16 {
    pub x: i16,
    pub y: i16,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct Rect {
    pub top: i32,
    pub left: i32,
    pub bottom: i32,
    pub right: i32,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct Clip {
    pub clip_type: u8,
    pub rects: Vec<Rect>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct DisplayBase {
    pub surface_id: u32,
    pub box_: Rect,
    pub clip: Clip,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct ChannelId {
    pub channel_type: u8,
    pub channel_id: u8,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct ChannelWait {
    pub channel_type: u8,
    pub channel_id: u8,
    pub message_serial: u64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct WaitForChannels {
    pub wait_list: Vec<ChannelWait>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct Notify {
    pub time_stamp: u64,
    pub severity: u32,
    pub visibility: u32,
    pub what: u32,
    pub message: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MainInit {
    pub session_id: u32,
    pub display_channels_hint: u32,
    pub supported_mouse_modes: u32,
    pub current_mouse_mode: u32,
    pub agent_connected: u32,
    pub agent_tokens: u32,
    pub multi_media_time: u32,
    pub ram_hint: u32,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct MainChannelsList {
    pub channels: Vec<ChannelId>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MainMouseMode {
    pub supported_modes: u16,
    pub current_mode: u16,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MainMultiMediaTime {
    pub time: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MainAgentTokens {
    pub num_tokens: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct DisplayMode {
    pub x_res: u32,
    pub y_res: u32,
    pub bits: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct SurfaceCreate {
    pub surface_id: u32,
    pub width: u32,
    pub height: u32,
    pub format: u32,
    pub flags: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct SurfaceDestroy {
    pub surface_id: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MonitorHead {
    pub monitor_id: u32,
    pub surface_id: u32,
    pub width: u32,
    pub height: u32,
    pub x: u32,
    pub y: u32,
    pub flags: u32,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct MonitorsConfig {
    pub count: u16,
    pub max_allowed: u16,
    pub heads: Vec<MonitorHead>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct DisplayCopyBits {
    pub base: DisplayBase,
    pub src_pos: Point,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct DisplayResource {
    pub resource_type: u8,
    pub id: u64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct DisplayInvalList {
    pub resources: Vec<DisplayResource>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct DisplayInvalPalette {
    pub id: u64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct StreamCreate {
    pub surface_id: u32,
    pub id: u32,
    pub flags: u8,
    pub codec_type: u8,
    pub stamp: u64,
    pub stream_width: u32,
    pub stream_height: u32,
    pub src_width: u32,
    pub src_height: u32,
    pub dest: Rect,
    pub clip: Clip,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct StreamDataHeader {
    pub id: u32,
    pub multi_media_time: u32,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct StreamData {
    pub base: StreamDataHeader,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct StreamDataSized {
    pub base: StreamDataHeader,
    pub width: u32,
    pub height: u32,
    pub dest: Rect,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct StreamClip {
    pub id: u32,
    pub clip: Clip,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct StreamDestroy {
    pub id: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct StreamActivateReport {
    pub stream_id: u32,
    pub unique_id: u32,
    pub max_window_size: u32,
    pub timeout_ms: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct InputsKeyModifiers {
    pub modifiers: u16,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct InputKeyCode {
    pub code: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MouseMotion {
    pub dx: i32,
    pub dy: i32,
    pub buttons_state: u16,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MousePosition {
    pub x: u32,
    pub y: u32,
    pub buttons_state: u16,
    pub display_id: u8,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct MouseButton {
    pub button: u8,
    pub buttons_state: u16,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct CursorHeader {
    pub unique: u64,
    pub cursor_type: u8,
    pub width: u16,
    pub height: u16,
    pub hot_spot_x: u16,
    pub hot_spot_y: u16,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct Cursor {
    pub flags: u16,
    pub header: Option<CursorHeader>,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct CursorInit {
    pub position: Point16,
    pub trail_length: u16,
    pub trail_frequency: u16,
    pub visible: u8,
    pub cursor: Cursor,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct CursorSet {
    pub position: Point16,
    pub visible: u8,
    pub cursor: Cursor,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct CursorMove {
    pub position: Point16,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct CursorTrail {
    pub length: u16,
    pub frequency: u16,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct CursorInvalOne {
    pub id: u64,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct AudioData {
    pub time: u32,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct AudioMode {
    pub time: u32,
    pub mode: u16,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct PlaybackStart {
    pub channels: u32,
    pub format: u16,
    pub frequency: u32,
    pub time: u32,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct RecordStart {
    pub channels: u32,
    pub format: u16,
    pub frequency: u32,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct AudioVolume {
    pub volumes: Vec<u16>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct AudioMute {
    pub mute: u8,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct PlaybackLatency {
    pub latency_ms: u32,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct PortInit {
    pub name: Vec<u8>,
    pub opened: u8,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct PortEvent {
    pub event: u8,
}
