/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use wasm_bindgen::prelude::*;

const SPICE_MSGC_ACK_SYNC: u16 = 1;
const SPICE_MSGC_ACK: u16 = 2;
const SPICE_MSGC_PONG: u16 = 3;

const ACK_DECISION_NONE: u8 = 0;
const ACK_DECISION_SYNC: u8 = 1;
const ACK_DECISION_WINDOW: u8 = 2;

#[wasm_bindgen]
pub struct SpiceSetAck {
    generation: u32,
    window: u32,
}

#[wasm_bindgen]
impl SpiceSetAck {
    #[wasm_bindgen(getter)]
    pub fn generation(&self) -> u32 {
        self.generation
    }

    #[wasm_bindgen(getter)]
    pub fn window(&self) -> u32 {
        self.window
    }
}

#[wasm_bindgen]
pub struct SpiceMiniHeader {
    message_type: u16,
    body_size: u32,
}

#[wasm_bindgen]
impl SpiceMiniHeader {
    #[wasm_bindgen(getter)]
    pub fn message_type(&self) -> u16 {
        self.message_type
    }

    #[wasm_bindgen(getter)]
    pub fn body_size(&self) -> u32 {
        self.body_size
    }
}

/// Native ACK/window state for a SPICE channel.
///
/// JS owns the socket handle, but the protocol decision of when an ACK is due
/// belongs here.
#[wasm_bindgen]
pub struct SpiceAckState {
    generation: u32,
    window: u32,
    packets_since_ack: u32,
    packet_serial: u64,
    ack_count: u64,
    ack_sync_count: u64,
}

#[wasm_bindgen]
impl SpiceAckState {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SpiceAckState {
        SpiceAckState {
            generation: 0,
            window: 0,
            packets_since_ack: 0,
            packet_serial: 0,
            ack_count: 0,
            ack_sync_count: 0,
        }
    }

    pub fn configure(&mut self, generation: u32, window: u32) -> u8 {
        self.generation = generation;
        self.window = window;
        self.packets_since_ack = 0;
        self.ack_sync_count = self.ack_sync_count.saturating_add(1);
        ACK_DECISION_SYNC
    }

    pub fn observe_packet(&mut self) -> u8 {
        self.packet_serial = self.packet_serial.saturating_add(1);
        self.packets_since_ack = self.packets_since_ack.saturating_add(1);
        if self.window > 0 && self.packets_since_ack >= self.window {
            self.packets_since_ack = 0;
            self.ack_count = self.ack_count.saturating_add(1);
            return ACK_DECISION_WINDOW;
        }
        ACK_DECISION_NONE
    }

    #[wasm_bindgen(getter)]
    pub fn generation(&self) -> u32 {
        self.generation
    }

    #[wasm_bindgen(getter)]
    pub fn window(&self) -> u32 {
        self.window
    }

    #[wasm_bindgen(getter)]
    pub fn packets_since_ack(&self) -> u32 {
        self.packets_since_ack
    }

    #[wasm_bindgen(getter)]
    pub fn packet_serial(&self) -> u64 {
        self.packet_serial
    }

    #[wasm_bindgen(getter)]
    pub fn ack_count(&self) -> u64 {
        self.ack_count
    }

    #[wasm_bindgen(getter)]
    pub fn ack_sync_count(&self) -> u64 {
        self.ack_sync_count
    }
}

#[wasm_bindgen]
pub fn spice_ack_decision_none() -> u8 {
    ACK_DECISION_NONE
}

#[wasm_bindgen]
pub fn spice_ack_decision_sync() -> u8 {
    ACK_DECISION_SYNC
}

#[wasm_bindgen]
pub fn spice_ack_decision_window() -> u8 {
    ACK_DECISION_WINDOW
}

#[wasm_bindgen]
pub fn parse_spice_set_ack(input: &[u8]) -> Result<SpiceSetAck, JsValue> {
    if input.len() < 8 {
        return Err(JsValue::from_str("SPICE SET_ACK body is truncated."));
    }
    Ok(SpiceSetAck {
        generation: u32::from_le_bytes([input[0], input[1], input[2], input[3]]),
        window: u32::from_le_bytes([input[4], input[5], input[6], input[7]]),
    })
}

#[wasm_bindgen]
pub fn parse_spice_mini_header(input: &[u8]) -> Result<SpiceMiniHeader, JsValue> {
    if input.len() < 6 {
        return Err(JsValue::from_str("SPICE mini header is truncated."));
    }
    Ok(SpiceMiniHeader {
        message_type: u16::from_le_bytes([input[0], input[1]]),
        body_size: u32::from_le_bytes([input[2], input[3], input[4], input[5]]),
    })
}

#[wasm_bindgen]
pub fn build_spice_mini_packet(message_type: u16, body: &[u8]) -> Vec<u8> {
    let mut packet = Vec::with_capacity(6 + body.len());
    packet.extend_from_slice(&message_type.to_le_bytes());
    packet.extend_from_slice(&(body.len() as u32).to_le_bytes());
    packet.extend_from_slice(body);
    packet
}

#[wasm_bindgen]
pub fn build_spice_ack_sync_packet(generation: u32) -> Vec<u8> {
    build_spice_mini_packet(SPICE_MSGC_ACK_SYNC, &generation.to_le_bytes())
}

#[wasm_bindgen]
pub fn build_spice_ack_packet() -> Vec<u8> {
    build_spice_mini_packet(SPICE_MSGC_ACK, &[])
}

#[wasm_bindgen]
pub fn build_spice_pong_packet(raw_ping: &[u8]) -> Vec<u8> {
    let len = raw_ping.len().min(12);
    build_spice_mini_packet(SPICE_MSGC_PONG, &raw_ping[..len])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_set_ack_body() {
        let ack = parse_spice_set_ack(&[7, 0, 0, 0, 3, 0, 0, 0]).unwrap();
        assert_eq!(ack.generation(), 7);
        assert_eq!(ack.window(), 3);
    }

    #[test]
    fn ack_state_emits_sync_and_window_decisions() {
        let mut state = SpiceAckState::new();
        assert_eq!(state.configure(9, 2), ACK_DECISION_SYNC);
        assert_eq!(state.observe_packet(), ACK_DECISION_NONE);
        assert_eq!(state.observe_packet(), ACK_DECISION_WINDOW);
        assert_eq!(state.packet_serial(), 2);
        assert_eq!(state.ack_count(), 1);
        assert_eq!(state.ack_sync_count(), 1);
    }

    #[test]
    fn builds_little_endian_mini_packets() {
        assert_eq!(build_spice_ack_packet(), vec![2, 0, 0, 0, 0, 0]);
        assert_eq!(
            build_spice_ack_sync_packet(0x1122_3344),
            vec![1, 0, 4, 0, 0, 0, 0x44, 0x33, 0x22, 0x11],
        );
    }
}
