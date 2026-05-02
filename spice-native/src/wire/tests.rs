/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use super::*;

fn push_u16(out: &mut Vec<u8>, value: u16) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, value: u32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_i32(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_le_bytes());
}

fn push_rect(out: &mut Vec<u8>, top: i32, left: i32, bottom: i32, right: i32) {
    push_i32(out, top);
    push_i32(out, left);
    push_i32(out, bottom);
    push_i32(out, right);
}

#[test]
fn parses_main_messages_from_proto_order() {
    let mut init = Vec::new();
    for value in [7, 2, 3, 2, 1, 64, 1234, 4096] {
        push_u32(&mut init, value);
    }
    assert_eq!(
        parse_main_init(&init).unwrap(),
        MainInit {
            session_id: 7,
            display_channels_hint: 2,
            supported_mouse_modes: 3,
            current_mouse_mode: 2,
            agent_connected: 1,
            agent_tokens: 64,
            multi_media_time: 1234,
            ram_hint: 4096,
        }
    );

    let channels = [
        2,
        0,
        0,
        0,
        SPICE_CHANNEL_DISPLAY,
        0,
        SPICE_CHANNEL_INPUTS,
        1,
    ];
    assert_eq!(
        parse_main_channels_list(&channels).unwrap(),
        MainChannelsList {
            channels: vec![
                ChannelId {
                    channel_type: SPICE_CHANNEL_DISPLAY,
                    channel_id: 0,
                },
                ChannelId {
                    channel_type: SPICE_CHANNEL_INPUTS,
                    channel_id: 1,
                },
            ],
        }
    );

    assert_eq!(
        parse_main_mouse_mode(&[3, 0, 2, 0]).unwrap(),
        MainMouseMode {
            supported_modes: 3,
            current_mode: 2,
        }
    );
    assert_eq!(
        parse_main_multimedia_time(&1234u32.to_le_bytes()).unwrap(),
        MainMultiMediaTime { time: 1234 }
    );
    assert_eq!(
        parse_main_agent_tokens(&64u32.to_le_bytes()).unwrap(),
        MainAgentTokens { num_tokens: 64 }
    );
}

#[test]
fn parses_common_wait_and_notify_bodies() {
    let mut wait = vec![2, SPICE_CHANNEL_DISPLAY, 0];
    push_u64(&mut wait, 11);
    wait.extend_from_slice(&[SPICE_CHANNEL_CURSOR, 1]);
    push_u64(&mut wait, 12);

    assert_eq!(
        parse_wait_for_channels(&wait).unwrap(),
        WaitForChannels {
            wait_list: vec![
                ChannelWait {
                    channel_type: SPICE_CHANNEL_DISPLAY,
                    channel_id: 0,
                    message_serial: 11,
                },
                ChannelWait {
                    channel_type: SPICE_CHANNEL_CURSOR,
                    channel_id: 1,
                    message_serial: 12,
                },
            ],
        }
    );

    let mut notify = Vec::new();
    push_u64(&mut notify, 99);
    push_u32(&mut notify, 1);
    push_u32(&mut notify, 2);
    push_u32(&mut notify, 77);
    push_u32(&mut notify, 5);
    notify.extend_from_slice(b"hello");

    assert_eq!(
        parse_notify(&notify).unwrap(),
        Notify {
            time_stamp: 99,
            severity: 1,
            visibility: 2,
            what: 77,
            message: b"hello".to_vec(),
        }
    );
}

#[test]
fn parses_display_fixed_and_variable_bodies() {
    let mut surface = Vec::new();
    for value in [3, 800, 600, 32, 1] {
        push_u32(&mut surface, value);
    }
    assert_eq!(
        parse_display_surface_create(&surface).unwrap(),
        SurfaceCreate {
            surface_id: 3,
            width: 800,
            height: 600,
            format: 32,
            flags: 1,
        }
    );
    assert_eq!(
        parse_display_surface_destroy(&3u32.to_le_bytes()).unwrap(),
        SurfaceDestroy { surface_id: 3 }
    );

    let mut monitors = Vec::new();
    push_u16(&mut monitors, 1);
    push_u16(&mut monitors, 4);
    for value in [0, 3, 800, 600, 10, 20, 1] {
        push_u32(&mut monitors, value);
    }
    assert_eq!(
        parse_display_monitors_config(&monitors).unwrap(),
        MonitorsConfig {
            count: 1,
            max_allowed: 4,
            heads: vec![MonitorHead {
                monitor_id: 0,
                surface_id: 3,
                width: 800,
                height: 600,
                x: 10,
                y: 20,
                flags: 1,
            }],
        }
    );

    let mut copy = Vec::new();
    push_u32(&mut copy, 3);
    push_rect(&mut copy, 0, 0, 100, 200);
    copy.push(SPICE_CLIP_TYPE_RECTS);
    push_u32(&mut copy, 1);
    push_rect(&mut copy, 1, 2, 3, 4);
    push_i32(&mut copy, -5);
    push_i32(&mut copy, 6);

    assert_eq!(
        parse_display_copy_bits(&copy).unwrap(),
        DisplayCopyBits {
            base: DisplayBase {
                surface_id: 3,
                box_: Rect {
                    top: 0,
                    left: 0,
                    bottom: 100,
                    right: 200,
                },
                clip: Clip {
                    clip_type: SPICE_CLIP_TYPE_RECTS,
                    rects: vec![Rect {
                        top: 1,
                        left: 2,
                        bottom: 3,
                        right: 4,
                    }],
                },
            },
            src_pos: Point { x: -5, y: 6 },
        }
    );
}

#[test]
fn parses_display_stream_bodies() {
    let mut stream = Vec::new();
    push_u32(&mut stream, 3);
    push_u32(&mut stream, 44);
    stream.push(1);
    stream.push(3);
    push_u64(&mut stream, 500);
    for value in [640, 480, 320, 240] {
        push_u32(&mut stream, value);
    }
    push_rect(&mut stream, 0, 0, 480, 640);
    stream.push(SPICE_CLIP_TYPE_NONE);
    assert_eq!(
        parse_display_stream_create(&stream).unwrap(),
        StreamCreate {
            surface_id: 3,
            id: 44,
            flags: 1,
            codec_type: 3,
            stamp: 500,
            stream_width: 640,
            stream_height: 480,
            src_width: 320,
            src_height: 240,
            dest: Rect {
                top: 0,
                left: 0,
                bottom: 480,
                right: 640,
            },
            clip: Clip {
                clip_type: SPICE_CLIP_TYPE_NONE,
                rects: Vec::new(),
            },
        }
    );

    let mut data = Vec::new();
    push_u32(&mut data, 44);
    push_u32(&mut data, 1234);
    push_u32(&mut data, 3);
    data.extend_from_slice(&[9, 8, 7]);
    assert_eq!(
        parse_display_stream_data(&data).unwrap(),
        StreamData {
            base: StreamDataHeader {
                id: 44,
                multi_media_time: 1234,
            },
            data: vec![9, 8, 7],
        }
    );
}

#[test]
fn parses_cursor_and_input_bodies() {
    let mut cursor = Vec::new();
    push_u16(&mut cursor, 10);
    push_u16(&mut cursor, 20);
    push_u16(&mut cursor, 2);
    push_u16(&mut cursor, 30);
    cursor.push(1);
    push_u16(&mut cursor, 0);
    push_u64(&mut cursor, 0x0102_0304_0506_0708);
    cursor.push(6);
    push_u16(&mut cursor, 16);
    push_u16(&mut cursor, 24);
    push_u16(&mut cursor, 1);
    push_u16(&mut cursor, 2);
    cursor.extend_from_slice(&[0xaa, 0xbb]);

    let parsed = parse_cursor_init(&cursor).unwrap();
    assert_eq!(parsed.position, Point16 { x: 10, y: 20 });
    assert_eq!(parsed.trail_length, 2);
    assert_eq!(parsed.cursor.header.unwrap().width, 16);
    assert_eq!(parsed.cursor.data, vec![0xaa, 0xbb]);

    let mut set_none = Vec::new();
    push_u16(&mut set_none, -1i16 as u16);
    push_u16(&mut set_none, 5);
    set_none.push(0);
    push_u16(&mut set_none, SPICE_CURSOR_FLAGS_NONE);
    assert_eq!(
        parse_cursor_set(&set_none).unwrap().cursor,
        Cursor {
            flags: SPICE_CURSOR_FLAGS_NONE,
            header: None,
            data: Vec::new(),
        }
    );

    let mut motion = Vec::new();
    push_i32(&mut motion, -7);
    push_i32(&mut motion, 8);
    push_u16(&mut motion, 3);
    assert_eq!(
        parse_input_mouse_motion(&motion).unwrap(),
        MouseMotion {
            dx: -7,
            dy: 8,
            buttons_state: 3,
        }
    );
    assert_eq!(
        parse_inputs_key_modifiers(&4u16.to_le_bytes()).unwrap(),
        InputsKeyModifiers { modifiers: 4 }
    );
}

#[test]
fn parses_audio_and_port_bodies() {
    let mut playback_start = Vec::new();
    push_u32(&mut playback_start, 2);
    push_u16(&mut playback_start, 1);
    push_u32(&mut playback_start, 48_000);
    push_u32(&mut playback_start, 100);
    assert_eq!(
        parse_playback_start(&playback_start).unwrap(),
        PlaybackStart {
            channels: 2,
            format: 1,
            frequency: 48_000,
            time: 100,
        }
    );

    let mut audio_data = Vec::new();
    push_u32(&mut audio_data, 100);
    audio_data.extend_from_slice(&[1, 2, 3]);
    assert_eq!(
        parse_audio_data(&audio_data).unwrap(),
        AudioData {
            time: 100,
            data: vec![1, 2, 3],
        }
    );

    assert_eq!(
        parse_audio_volume(&[2, 0x34, 0x12, 0x78, 0x56]).unwrap(),
        AudioVolume {
            volumes: vec![0x1234, 0x5678],
        }
    );

    let mut port = Vec::new();
    push_u32(&mut port, 9);
    port.extend_from_slice(b"org.test\0");
    port.push(1);
    assert_eq!(
        parse_port_init(&port).unwrap(),
        PortInit {
            name: b"org.test\0".to_vec(),
            opened: 1,
        }
    );
    assert_eq!(parse_port_event(&[2]).unwrap(), PortEvent { event: 2 });
}

#[test]
fn rejects_truncated_or_extra_fixed_bodies() {
    assert!(parse_display_mode(&[1, 2, 3]).is_err());

    let mut mode = Vec::new();
    push_u32(&mut mode, 800);
    push_u32(&mut mode, 600);
    push_u32(&mut mode, 32);
    mode.push(0);
    assert!(parse_display_mode(&mode).is_err());
}
