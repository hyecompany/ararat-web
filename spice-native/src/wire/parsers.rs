/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use super::constants::{SPICE_CLIP_TYPE_RECTS, SPICE_CURSOR_FLAGS_NONE};
use super::reader::Reader;
use super::structs::*;
use super::WireResult;

pub fn parse_wait_for_channels(input: &[u8]) -> WireResult<WaitForChannels> {
    let mut reader = Reader::new(input);
    let wait_count = reader.u8()? as usize;
    let mut wait_list = Vec::with_capacity(wait_count);
    for _ in 0..wait_count {
        wait_list.push(read_channel_wait(&mut reader)?);
    }
    reader.finish()?;
    Ok(WaitForChannels { wait_list })
}

pub fn parse_notify(input: &[u8]) -> WireResult<Notify> {
    let mut reader = Reader::new(input);
    let time_stamp = reader.u64()?;
    let severity = reader.u32()?;
    let visibility = reader.u32()?;
    let what = reader.u32()?;
    let message_len = reader.u32()? as usize;
    let message = reader.vec(message_len)?;
    reader.finish()?;
    Ok(Notify {
        time_stamp,
        severity,
        visibility,
        what,
        message,
    })
}

pub fn parse_main_init(input: &[u8]) -> WireResult<MainInit> {
    let mut reader = Reader::new(input);
    let init = MainInit {
        session_id: reader.u32()?,
        display_channels_hint: reader.u32()?,
        supported_mouse_modes: reader.u32()?,
        current_mouse_mode: reader.u32()?,
        agent_connected: reader.u32()?,
        agent_tokens: reader.u32()?,
        multi_media_time: reader.u32()?,
        ram_hint: reader.u32()?,
    };
    reader.finish()?;
    Ok(init)
}

pub fn parse_main_channels_list(input: &[u8]) -> WireResult<MainChannelsList> {
    let mut reader = Reader::new(input);
    let count = reader.u32()? as usize;
    let mut channels = Vec::with_capacity(count);
    for _ in 0..count {
        channels.push(ChannelId {
            channel_type: reader.u8()?,
            channel_id: reader.u8()?,
        });
    }
    reader.finish()?;
    Ok(MainChannelsList { channels })
}

pub fn parse_main_mouse_mode(input: &[u8]) -> WireResult<MainMouseMode> {
    let mut reader = Reader::new(input);
    let mouse_mode = MainMouseMode {
        supported_modes: reader.u16()?,
        current_mode: reader.u16()?,
    };
    reader.finish()?;
    Ok(mouse_mode)
}

pub fn parse_main_multimedia_time(input: &[u8]) -> WireResult<MainMultiMediaTime> {
    let mut reader = Reader::new(input);
    let time = reader.u32()?;
    reader.finish()?;
    Ok(MainMultiMediaTime { time })
}

pub fn parse_main_agent_tokens(input: &[u8]) -> WireResult<MainAgentTokens> {
    let mut reader = Reader::new(input);
    let num_tokens = reader.u32()?;
    reader.finish()?;
    Ok(MainAgentTokens { num_tokens })
}

pub fn parse_display_mode(input: &[u8]) -> WireResult<DisplayMode> {
    let mut reader = Reader::new(input);
    let mode = DisplayMode {
        x_res: reader.u32()?,
        y_res: reader.u32()?,
        bits: reader.u32()?,
    };
    reader.finish()?;
    Ok(mode)
}

pub fn parse_display_surface_create(input: &[u8]) -> WireResult<SurfaceCreate> {
    let mut reader = Reader::new(input);
    let surface = SurfaceCreate {
        surface_id: reader.u32()?,
        width: reader.u32()?,
        height: reader.u32()?,
        format: reader.u32()?,
        flags: reader.u32()?,
    };
    reader.finish()?;
    Ok(surface)
}

pub fn parse_display_surface_destroy(input: &[u8]) -> WireResult<SurfaceDestroy> {
    let mut reader = Reader::new(input);
    let surface_id = reader.u32()?;
    reader.finish()?;
    Ok(SurfaceDestroy { surface_id })
}

pub fn parse_display_monitors_config(input: &[u8]) -> WireResult<MonitorsConfig> {
    let mut reader = Reader::new(input);
    let count = reader.u16()?;
    let max_allowed = reader.u16()?;
    let mut heads = Vec::with_capacity(count as usize);
    for _ in 0..count {
        heads.push(MonitorHead {
            monitor_id: reader.u32()?,
            surface_id: reader.u32()?,
            width: reader.u32()?,
            height: reader.u32()?,
            x: reader.u32()?,
            y: reader.u32()?,
            flags: reader.u32()?,
        });
    }
    reader.finish()?;
    Ok(MonitorsConfig {
        count,
        max_allowed,
        heads,
    })
}

pub fn parse_display_copy_bits(input: &[u8]) -> WireResult<DisplayCopyBits> {
    let mut reader = Reader::new(input);
    let copy_bits = DisplayCopyBits {
        base: read_display_base(&mut reader)?,
        src_pos: read_point(&mut reader)?,
    };
    reader.finish()?;
    Ok(copy_bits)
}

pub fn parse_display_base_prefix(input: &[u8]) -> WireResult<DisplayBase> {
    let mut reader = Reader::new(input);
    read_display_base(&mut reader)
}

pub fn parse_display_inval_list(input: &[u8]) -> WireResult<DisplayInvalList> {
    let mut reader = Reader::new(input);
    let count = reader.u16()? as usize;
    let mut resources = Vec::with_capacity(count);
    for _ in 0..count {
        resources.push(DisplayResource {
            resource_type: reader.u8()?,
            id: reader.u64()?,
        });
    }
    reader.finish()?;
    Ok(DisplayInvalList { resources })
}

pub fn parse_display_inval_palette(input: &[u8]) -> WireResult<DisplayInvalPalette> {
    let mut reader = Reader::new(input);
    let id = reader.u64()?;
    reader.finish()?;
    Ok(DisplayInvalPalette { id })
}

pub fn parse_display_stream_create(input: &[u8]) -> WireResult<StreamCreate> {
    let mut reader = Reader::new(input);
    let stream = StreamCreate {
        surface_id: reader.u32()?,
        id: reader.u32()?,
        flags: reader.u8()?,
        codec_type: reader.u8()?,
        stamp: reader.u64()?,
        stream_width: reader.u32()?,
        stream_height: reader.u32()?,
        src_width: reader.u32()?,
        src_height: reader.u32()?,
        dest: read_rect(&mut reader)?,
        clip: read_clip(&mut reader)?,
    };
    reader.finish()?;
    Ok(stream)
}

pub fn parse_display_stream_clip(input: &[u8]) -> WireResult<StreamClip> {
    let mut reader = Reader::new(input);
    let clip = StreamClip {
        id: reader.u32()?,
        clip: read_clip(&mut reader)?,
    };
    reader.finish()?;
    Ok(clip)
}

pub fn parse_display_stream_destroy(input: &[u8]) -> WireResult<StreamDestroy> {
    let mut reader = Reader::new(input);
    let id = reader.u32()?;
    reader.finish()?;
    Ok(StreamDestroy { id })
}

pub fn parse_display_stream_data_header(input: &[u8]) -> WireResult<StreamDataHeader> {
    let mut reader = Reader::new(input);
    let header = read_stream_data_header(&mut reader)?;
    reader.finish()?;
    Ok(header)
}

pub fn parse_display_stream_data(input: &[u8]) -> WireResult<StreamData> {
    let mut reader = Reader::new(input);
    let base = read_stream_data_header(&mut reader)?;
    let data_size = reader.u32()? as usize;
    let data = reader.vec(data_size)?;
    reader.finish()?;
    Ok(StreamData { base, data })
}

pub fn parse_display_stream_data_sized(input: &[u8]) -> WireResult<StreamDataSized> {
    let mut reader = Reader::new(input);
    let base = read_stream_data_header(&mut reader)?;
    let width = reader.u32()?;
    let height = reader.u32()?;
    let dest = read_rect(&mut reader)?;
    let data_size = reader.u32()? as usize;
    let data = reader.vec(data_size)?;
    reader.finish()?;
    Ok(StreamDataSized {
        base,
        width,
        height,
        dest,
        data,
    })
}

pub fn parse_display_stream_activate_report(input: &[u8]) -> WireResult<StreamActivateReport> {
    let mut reader = Reader::new(input);
    let report = StreamActivateReport {
        stream_id: reader.u32()?,
        unique_id: reader.u32()?,
        max_window_size: reader.u32()?,
        timeout_ms: reader.u32()?,
    };
    reader.finish()?;
    Ok(report)
}

pub fn parse_inputs_key_modifiers(input: &[u8]) -> WireResult<InputsKeyModifiers> {
    let mut reader = Reader::new(input);
    let modifiers = reader.u16()?;
    reader.finish()?;
    Ok(InputsKeyModifiers { modifiers })
}

pub fn parse_inputs_init(input: &[u8]) -> WireResult<InputsKeyModifiers> {
    parse_inputs_key_modifiers(input)
}

pub fn parse_input_key_code(input: &[u8]) -> WireResult<InputKeyCode> {
    let mut reader = Reader::new(input);
    let code = reader.u32()?;
    reader.finish()?;
    Ok(InputKeyCode { code })
}

pub fn parse_input_mouse_motion(input: &[u8]) -> WireResult<MouseMotion> {
    let mut reader = Reader::new(input);
    let motion = MouseMotion {
        dx: reader.i32()?,
        dy: reader.i32()?,
        buttons_state: reader.u16()?,
    };
    reader.finish()?;
    Ok(motion)
}

pub fn parse_input_mouse_position(input: &[u8]) -> WireResult<MousePosition> {
    let mut reader = Reader::new(input);
    let position = MousePosition {
        x: reader.u32()?,
        y: reader.u32()?,
        buttons_state: reader.u16()?,
        display_id: reader.u8()?,
    };
    reader.finish()?;
    Ok(position)
}

pub fn parse_input_mouse_button(input: &[u8]) -> WireResult<MouseButton> {
    let mut reader = Reader::new(input);
    let button = MouseButton {
        button: reader.u8()?,
        buttons_state: reader.u16()?,
    };
    reader.finish()?;
    Ok(button)
}

pub fn parse_cursor_init(input: &[u8]) -> WireResult<CursorInit> {
    let mut reader = Reader::new(input);
    let cursor = CursorInit {
        position: read_point16(&mut reader)?,
        trail_length: reader.u16()?,
        trail_frequency: reader.u16()?,
        visible: reader.u8()?,
        cursor: read_cursor(&mut reader)?,
    };
    reader.finish()?;
    Ok(cursor)
}

pub fn parse_cursor_set(input: &[u8]) -> WireResult<CursorSet> {
    let mut reader = Reader::new(input);
    let cursor = CursorSet {
        position: read_point16(&mut reader)?,
        visible: reader.u8()?,
        cursor: read_cursor(&mut reader)?,
    };
    reader.finish()?;
    Ok(cursor)
}

pub fn parse_cursor_move(input: &[u8]) -> WireResult<CursorMove> {
    let mut reader = Reader::new(input);
    let position = read_point16(&mut reader)?;
    reader.finish()?;
    Ok(CursorMove { position })
}

pub fn parse_cursor_trail(input: &[u8]) -> WireResult<CursorTrail> {
    let mut reader = Reader::new(input);
    let trail = CursorTrail {
        length: reader.u16()?,
        frequency: reader.u16()?,
    };
    reader.finish()?;
    Ok(trail)
}

pub fn parse_cursor_inval_one(input: &[u8]) -> WireResult<CursorInvalOne> {
    let mut reader = Reader::new(input);
    let id = reader.u64()?;
    reader.finish()?;
    Ok(CursorInvalOne { id })
}

pub fn parse_audio_data(input: &[u8]) -> WireResult<AudioData> {
    let mut reader = Reader::new(input);
    let time = reader.u32()?;
    let data = reader.rest_vec();
    Ok(AudioData { time, data })
}

pub fn parse_audio_mode(input: &[u8]) -> WireResult<AudioMode> {
    let mut reader = Reader::new(input);
    let time = reader.u32()?;
    let mode = reader.u16()?;
    let data = reader.rest_vec();
    Ok(AudioMode { time, mode, data })
}

pub fn parse_playback_start(input: &[u8]) -> WireResult<PlaybackStart> {
    let mut reader = Reader::new(input);
    let start = PlaybackStart {
        channels: reader.u32()?,
        format: reader.u16()?,
        frequency: reader.u32()?,
        time: reader.u32()?,
    };
    reader.finish()?;
    Ok(start)
}

pub fn parse_record_start(input: &[u8]) -> WireResult<RecordStart> {
    let mut reader = Reader::new(input);
    let start = RecordStart {
        channels: reader.u32()?,
        format: reader.u16()?,
        frequency: reader.u32()?,
    };
    reader.finish()?;
    Ok(start)
}

pub fn parse_audio_volume(input: &[u8]) -> WireResult<AudioVolume> {
    let mut reader = Reader::new(input);
    let nchannels = reader.u8()? as usize;
    let mut volumes = Vec::with_capacity(nchannels);
    for _ in 0..nchannels {
        volumes.push(reader.u16()?);
    }
    reader.finish()?;
    Ok(AudioVolume { volumes })
}

pub fn parse_audio_mute(input: &[u8]) -> WireResult<AudioMute> {
    let mut reader = Reader::new(input);
    let mute = reader.u8()?;
    reader.finish()?;
    Ok(AudioMute { mute })
}

pub fn parse_playback_latency(input: &[u8]) -> WireResult<PlaybackLatency> {
    let mut reader = Reader::new(input);
    let latency_ms = reader.u32()?;
    reader.finish()?;
    Ok(PlaybackLatency { latency_ms })
}

pub fn parse_port_init(input: &[u8]) -> WireResult<PortInit> {
    let mut reader = Reader::new(input);
    let name_size = reader.u32()? as usize;
    let name = reader.vec(name_size)?;
    let opened = reader.u8()?;
    Ok(PortInit { name, opened })
}

pub fn parse_port_event(input: &[u8]) -> WireResult<PortEvent> {
    let mut reader = Reader::new(input);
    let event = reader.u8()?;
    reader.finish()?;
    Ok(PortEvent { event })
}

fn read_point(reader: &mut Reader<'_>) -> WireResult<Point> {
    Ok(Point {
        x: reader.i32()?,
        y: reader.i32()?,
    })
}

fn read_point16(reader: &mut Reader<'_>) -> WireResult<Point16> {
    Ok(Point16 {
        x: reader.i16()?,
        y: reader.i16()?,
    })
}

fn read_rect(reader: &mut Reader<'_>) -> WireResult<Rect> {
    Ok(Rect {
        top: reader.i32()?,
        left: reader.i32()?,
        bottom: reader.i32()?,
        right: reader.i32()?,
    })
}

fn read_clip(reader: &mut Reader<'_>) -> WireResult<Clip> {
    let clip_type = reader.u8()?;
    let rects = if clip_type == SPICE_CLIP_TYPE_RECTS {
        let count = reader.u32()? as usize;
        let mut rects = Vec::with_capacity(count);
        for _ in 0..count {
            rects.push(read_rect(reader)?);
        }
        rects
    } else {
        Vec::new()
    };
    Ok(Clip { clip_type, rects })
}

fn read_display_base(reader: &mut Reader<'_>) -> WireResult<DisplayBase> {
    Ok(DisplayBase {
        surface_id: reader.u32()?,
        box_: read_rect(reader)?,
        clip: read_clip(reader)?,
    })
}

fn read_stream_data_header(reader: &mut Reader<'_>) -> WireResult<StreamDataHeader> {
    Ok(StreamDataHeader {
        id: reader.u32()?,
        multi_media_time: reader.u32()?,
    })
}

fn read_cursor(reader: &mut Reader<'_>) -> WireResult<Cursor> {
    let flags = reader.u16()?;
    let header = if flags & SPICE_CURSOR_FLAGS_NONE == 0 {
        Some(CursorHeader {
            unique: reader.u64()?,
            cursor_type: reader.u8()?,
            width: reader.u16()?,
            height: reader.u16()?,
            hot_spot_x: reader.u16()?,
            hot_spot_y: reader.u16()?,
        })
    } else {
        None
    };
    let data = reader.rest_vec();
    Ok(Cursor {
        flags,
        header,
        data,
    })
}

fn read_channel_wait(reader: &mut Reader<'_>) -> WireResult<ChannelWait> {
    Ok(ChannelWait {
        channel_type: reader.u8()?,
        channel_id: reader.u8()?,
        message_serial: reader.u64()?,
    })
}
