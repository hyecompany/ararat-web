/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use serde::Deserialize;

use crate::protocol::build_spice_mini_packet;

const SPICE_MSGC_INPUTS_MOUSE_MOTION: u16 = 111;
const SPICE_MSGC_INPUTS_KEY_DOWN: u16 = 101;
const SPICE_MSGC_INPUTS_KEY_UP: u16 = 102;
const SPICE_MSGC_INPUTS_MOUSE_POSITION: u16 = 112;
const SPICE_MSGC_INPUTS_MOUSE_PRESS: u16 = 113;
const SPICE_MSGC_INPUTS_MOUSE_RELEASE: u16 = 114;

const SPICE_MOUSE_MODE_CLIENT: u32 = 2;
const SPICE_MOUSE_BUTTON_LEFT: u8 = 1;
const SPICE_MOUSE_BUTTON_MIDDLE: u8 = 2;
const SPICE_MOUSE_BUTTON_RIGHT: u8 = 3;
const SPICE_MOUSE_BUTTON_UP: u8 = 4;
const SPICE_MOUSE_BUTTON_DOWN: u8 = 5;

const SPICE_MOUSE_BUTTON_MASK_LEFT: u16 = 1 << 0;
const SPICE_MOUSE_BUTTON_MASK_MIDDLE: u16 = 1 << 1;
const SPICE_MOUSE_BUTTON_MASK_RIGHT: u16 = 1 << 2;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum InputControlMessage {
    #[serde(rename = "mouse_move")]
    MouseMove(MouseMovePayload),
    #[serde(rename = "mouse_button")]
    MouseButton(MouseButtonPayload),
    #[serde(rename = "mouse_wheel")]
    MouseWheel(MouseWheelPayload),
    #[serde(rename = "key")]
    Key(KeyPayload),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseMovePayload {
    x: f64,
    y: f64,
    movement_x: f64,
    movement_y: f64,
    buttons: u16,
}

#[derive(Debug, Deserialize)]
pub struct MouseButtonPayload {
    button: u8,
    pressed: bool,
    buttons: u16,
}

#[derive(Debug, Deserialize)]
pub struct MouseWheelPayload {
    direction: WheelDirection,
    buttons: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPayload {
    code: String,
    down: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum WheelDirection {
    Up,
    Down,
}

pub fn build_input_packets(
    control: InputControlMessage,
    current_mouse_mode: Option<u32>,
) -> Vec<Vec<u8>> {
    match control {
        InputControlMessage::MouseMove(payload) => {
            vec![build_mouse_move_packet(payload, current_mouse_mode)]
        }
        InputControlMessage::MouseButton(payload) => {
            vec![build_mouse_button_packet(payload)]
        }
        InputControlMessage::MouseWheel(payload) => build_mouse_wheel_packets(payload),
        InputControlMessage::Key(payload) => build_key_packets(payload),
    }
}

fn build_key_packets(payload: KeyPayload) -> Vec<Vec<u8>> {
    let Some(scancode) = dom_code_to_xt_scancode(&payload.code) else {
        return Vec::new();
    };
    let code = spice_make_scancode(scancode, !payload.down);
    let body = code.to_le_bytes().to_vec();
    vec![build_spice_mini_packet(
        if payload.down {
            SPICE_MSGC_INPUTS_KEY_DOWN
        } else {
            SPICE_MSGC_INPUTS_KEY_UP
        },
        &body,
    )]
}

fn build_mouse_move_packet(payload: MouseMovePayload, current_mouse_mode: Option<u32>) -> Vec<u8> {
    let buttons = spice_buttons_state(payload.buttons);
    if current_mouse_mode == Some(SPICE_MOUSE_MODE_CLIENT) {
        let mut body = Vec::with_capacity(11);
        body.extend_from_slice(&clamped_u32(payload.x).to_le_bytes());
        body.extend_from_slice(&clamped_u32(payload.y).to_le_bytes());
        body.extend_from_slice(&buttons.to_le_bytes());
        body.push(0);
        return build_spice_mini_packet(SPICE_MSGC_INPUTS_MOUSE_POSITION, &body);
    }

    let mut body = Vec::with_capacity(10);
    body.extend_from_slice(&clamped_i32(payload.movement_x).to_le_bytes());
    body.extend_from_slice(&clamped_i32(payload.movement_y).to_le_bytes());
    body.extend_from_slice(&buttons.to_le_bytes());
    build_spice_mini_packet(SPICE_MSGC_INPUTS_MOUSE_MOTION, &body)
}

fn build_mouse_button_packet(payload: MouseButtonPayload) -> Vec<u8> {
    let button = spice_button(payload.button);
    let buttons = spice_buttons_state(payload.buttons);
    let mut body = Vec::with_capacity(3);
    body.push(button);
    body.extend_from_slice(&buttons.to_le_bytes());
    build_spice_mini_packet(
        if payload.pressed {
            SPICE_MSGC_INPUTS_MOUSE_PRESS
        } else {
            SPICE_MSGC_INPUTS_MOUSE_RELEASE
        },
        &body,
    )
}

fn build_mouse_wheel_packets(payload: MouseWheelPayload) -> Vec<Vec<u8>> {
    let button = match payload.direction {
        WheelDirection::Up => SPICE_MOUSE_BUTTON_UP,
        WheelDirection::Down => SPICE_MOUSE_BUTTON_DOWN,
    };
    let buttons = spice_buttons_state(payload.buttons);
    let mut press = Vec::with_capacity(3);
    press.push(button);
    press.extend_from_slice(&buttons.to_le_bytes());
    let mut release = Vec::with_capacity(3);
    release.push(button);
    release.extend_from_slice(&buttons.to_le_bytes());
    vec![
        build_spice_mini_packet(SPICE_MSGC_INPUTS_MOUSE_PRESS, &press),
        build_spice_mini_packet(SPICE_MSGC_INPUTS_MOUSE_RELEASE, &release),
    ]
}

fn spice_button(dom_button: u8) -> u8 {
    match dom_button {
        0 => SPICE_MOUSE_BUTTON_LEFT,
        1 => SPICE_MOUSE_BUTTON_MIDDLE,
        2 => SPICE_MOUSE_BUTTON_RIGHT,
        _ => 0,
    }
}

fn spice_buttons_state(dom_buttons: u16) -> u16 {
    let mut state = 0u16;
    if (dom_buttons & 1) != 0 {
        state |= SPICE_MOUSE_BUTTON_MASK_LEFT;
    }
    if (dom_buttons & 2) != 0 {
        state |= SPICE_MOUSE_BUTTON_MASK_RIGHT;
    }
    if (dom_buttons & 4) != 0 {
        state |= SPICE_MOUSE_BUTTON_MASK_MIDDLE;
    }
    state
}

fn clamped_u32(value: f64) -> u32 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    value.round().min(u32::MAX as f64) as u32
}

fn clamped_i32(value: f64) -> i32 {
    if !value.is_finite() {
        return 0;
    }
    value.round().clamp(i32::MIN as f64, i32::MAX as f64) as i32
}

fn spice_make_scancode(scancode: u32, release: bool) -> u32 {
    let mut code = scancode & 0x37f;
    if release {
        code |= 0x80;
    }
    if code < 0x100 {
        return code;
    }
    u32::from((0xe000u16 | ((code - 0x100) as u16)).swap_bytes())
}

fn dom_code_to_xt_scancode(code: &str) -> Option<u32> {
    Some(match code {
        "Escape" => 0x01,
        "Digit1" => 0x02,
        "Digit2" => 0x03,
        "Digit3" => 0x04,
        "Digit4" => 0x05,
        "Digit5" => 0x06,
        "Digit6" => 0x07,
        "Digit7" => 0x08,
        "Digit8" => 0x09,
        "Digit9" => 0x0a,
        "Digit0" => 0x0b,
        "Minus" => 0x0c,
        "Equal" => 0x0d,
        "Backspace" => 0x0e,
        "Tab" => 0x0f,
        "KeyQ" => 0x10,
        "KeyW" => 0x11,
        "KeyE" => 0x12,
        "KeyR" => 0x13,
        "KeyT" => 0x14,
        "KeyY" => 0x15,
        "KeyU" => 0x16,
        "KeyI" => 0x17,
        "KeyO" => 0x18,
        "KeyP" => 0x19,
        "BracketLeft" => 0x1a,
        "BracketRight" => 0x1b,
        "Enter" => 0x1c,
        "ControlLeft" => 0x1d,
        "KeyA" => 0x1e,
        "KeyS" => 0x1f,
        "KeyD" => 0x20,
        "KeyF" => 0x21,
        "KeyG" => 0x22,
        "KeyH" => 0x23,
        "KeyJ" => 0x24,
        "KeyK" => 0x25,
        "KeyL" => 0x26,
        "Semicolon" => 0x27,
        "Quote" => 0x28,
        "Backquote" => 0x29,
        "ShiftLeft" => 0x2a,
        "Backslash" => 0x2b,
        "KeyZ" => 0x2c,
        "KeyX" => 0x2d,
        "KeyC" => 0x2e,
        "KeyV" => 0x2f,
        "KeyB" => 0x30,
        "KeyN" => 0x31,
        "KeyM" => 0x32,
        "Comma" => 0x33,
        "Period" => 0x34,
        "Slash" => 0x35,
        "ShiftRight" => 0x36,
        "NumpadMultiply" => 0x37,
        "AltLeft" => 0x38,
        "Space" => 0x39,
        "CapsLock" => 0x3a,
        "F1" => 0x3b,
        "F2" => 0x3c,
        "F3" => 0x3d,
        "F4" => 0x3e,
        "F5" => 0x3f,
        "F6" => 0x40,
        "F7" => 0x41,
        "F8" => 0x42,
        "F9" => 0x43,
        "F10" => 0x44,
        "NumLock" => 0x45,
        "ScrollLock" => 0x46,
        "Numpad7" => 0x47,
        "Numpad8" => 0x48,
        "Numpad9" => 0x49,
        "NumpadSubtract" => 0x4a,
        "Numpad4" => 0x4b,
        "Numpad5" => 0x4c,
        "Numpad6" => 0x4d,
        "NumpadAdd" => 0x4e,
        "Numpad1" => 0x4f,
        "Numpad2" => 0x50,
        "Numpad3" => 0x51,
        "Numpad0" => 0x52,
        "NumpadDecimal" => 0x53,
        "F11" => 0x57,
        "F12" => 0x58,
        "ControlRight" => 0x11d,
        "AltRight" => 0x138,
        "NumpadEnter" => 0x11c,
        "NumpadDivide" => 0x135,
        "Insert" => 0x152,
        "Delete" => 0x153,
        "Home" => 0x147,
        "End" => 0x14f,
        "PageUp" => 0x149,
        "PageDown" => 0x151,
        "ArrowUp" => 0x148,
        "ArrowDown" => 0x150,
        "ArrowLeft" => 0x14b,
        "ArrowRight" => 0x14d,
        "MetaLeft" | "MetaRight" => 0x15b,
        "ContextMenu" => 0x15d,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_dom_buttons_to_spice_mask_order() {
        assert_eq!(spice_buttons_state(1), SPICE_MOUSE_BUTTON_MASK_LEFT);
        assert_eq!(spice_buttons_state(2), SPICE_MOUSE_BUTTON_MASK_RIGHT);
        assert_eq!(spice_buttons_state(4), SPICE_MOUSE_BUTTON_MASK_MIDDLE);
        assert_eq!(spice_buttons_state(1 | 2 | 4), 7);
    }

    #[test]
    fn client_mode_mouse_move_builds_position_packet() {
        let packets = build_input_packets(
            InputControlMessage::MouseMove(MouseMovePayload {
                x: 10.0,
                y: 20.0,
                movement_x: -1.0,
                movement_y: 2.0,
                buttons: 2,
            }),
            Some(SPICE_MOUSE_MODE_CLIENT),
        );
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0][0..6], [112, 0, 11, 0, 0, 0]);
        assert_eq!(&packets[0][6..10], &10u32.to_le_bytes());
        assert_eq!(&packets[0][10..14], &20u32.to_le_bytes());
        assert_eq!(
            &packets[0][14..16],
            &SPICE_MOUSE_BUTTON_MASK_RIGHT.to_le_bytes()
        );
    }

    #[test]
    fn server_mode_mouse_move_builds_motion_packet() {
        let packets = build_input_packets(
            InputControlMessage::MouseMove(MouseMovePayload {
                x: 10.0,
                y: 20.0,
                movement_x: -3.0,
                movement_y: 4.0,
                buttons: 0,
            }),
            None,
        );
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0][0..6], [111, 0, 10, 0, 0, 0]);
        assert_eq!(&packets[0][6..10], &(-3i32).to_le_bytes());
        assert_eq!(&packets[0][10..14], &4i32.to_le_bytes());
    }

    #[test]
    fn key_events_use_pc_xt_scancode_packets() {
        let down = build_input_packets(
            InputControlMessage::Key(KeyPayload {
                code: "KeyA".to_string(),
                down: true,
            }),
            None,
        );
        assert_eq!(down.len(), 1);
        assert_eq!(down[0][0..6], [101, 0, 4, 0, 0, 0]);
        assert_eq!(&down[0][6..10], &0x1eu32.to_le_bytes());

        let up = build_input_packets(
            InputControlMessage::Key(KeyPayload {
                code: "KeyA".to_string(),
                down: false,
            }),
            None,
        );
        assert_eq!(&up[0][6..10], &(0x1e | 0x80u32).to_le_bytes());
    }

    #[test]
    fn extended_key_events_use_e0_prefixed_scancodes() {
        let down = build_input_packets(
            InputControlMessage::Key(KeyPayload {
                code: "ArrowUp".to_string(),
                down: true,
            }),
            None,
        );
        assert_eq!(&down[0][6..10], &0x48e0u32.to_le_bytes());

        let up = build_input_packets(
            InputControlMessage::Key(KeyPayload {
                code: "ArrowUp".to_string(),
                down: false,
            }),
            None,
        );
        assert_eq!(&up[0][6..10], &0xc8e0u32.to_le_bytes());
    }
}
