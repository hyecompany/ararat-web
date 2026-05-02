/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use std::collections::VecDeque;

use serde::Deserialize;

use crate::protocol::build_spice_mini_packet;

const SPICE_MSGC_MAIN_AGENT_START: u16 = 106;
const SPICE_MSGC_MAIN_AGENT_DATA: u16 = 107;
const SPICE_MSGC_MAIN_AGENT_TOKEN: u16 = 108;

const VD_AGENT_PROTOCOL: u32 = 1;
const VD_AGENT_MAX_DATA_SIZE: usize = 2048;
const VD_AGENT_DEFAULT_SERVER_TOKENS: u32 = 10;
const VD_AGENT_MONITORS_CONFIG: u32 = 2;
const VD_AGENT_ANNOUNCE_CAPABILITIES: u32 = 6;

const VD_AGENT_CAP_MONITORS_CONFIG: u32 = 1;
const VD_AGENT_CAP_REPLY: u32 = 2;
const VD_AGENT_CAP_DISPLAY_CONFIG: u32 = 4;
const VD_AGENT_CAP_MONITORS_CONFIG_POSITION: u32 = 12;

const VD_AGENT_CONFIG_MONITORS_FLAG_USE_POS: u32 = 1;
const DEFAULT_MONITOR_DEPTH: u32 = 32;
const AGENT_MESSAGE_HEADER_BYTES: usize = 20;

#[derive(Default)]
pub(super) struct AgentState {
    connected: bool,
    caps_announced: bool,
    client_tokens: u32,
    server_tokens_remaining: u32,
    pending_monitors_config: Option<MonitorResize>,
    pending_messages: VecDeque<PendingAgentMessage>,
    incoming_data: Vec<u8>,
}

#[derive(Clone, Copy)]
struct MonitorResize {
    width: u32,
    height: u32,
}

struct PendingAgentMessage {
    bytes: Vec<u8>,
    offset: usize,
}

pub(super) struct AgentDataResult {
    pub(super) packets: Vec<Vec<u8>>,
}

#[derive(Deserialize)]
#[serde(tag = "type", content = "payload")]
pub(super) enum ResizeControlMessage {
    #[serde(rename = "resize")]
    Resize(ResizeControlPayload),
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ResizeControlPayload {
    width: u32,
    height: u32,
}

impl AgentState {
    pub(super) fn on_main_init(&mut self, connected: bool, client_tokens: u32) -> Vec<Vec<u8>> {
        self.connected = connected;
        self.client_tokens = self.client_tokens.saturating_add(client_tokens);
        self.connection_packets()
    }

    pub(super) fn on_connected(&mut self) -> Vec<Vec<u8>> {
        self.connected = true;
        self.connection_packets()
    }

    pub(super) fn on_connected_tokens(&mut self, client_tokens: u32) -> Vec<Vec<u8>> {
        self.connected = true;
        self.client_tokens = self.client_tokens.saturating_add(client_tokens);
        self.connection_packets()
    }

    pub(super) fn on_client_tokens(&mut self, client_tokens: u32) -> Vec<Vec<u8>> {
        self.client_tokens = self.client_tokens.saturating_add(client_tokens);
        self.flush_agent_data_packets()
    }

    pub(super) fn on_disconnected(&mut self) {
        self.connected = false;
        self.caps_announced = false;
        self.client_tokens = 0;
        self.server_tokens_remaining = 0;
        self.pending_messages.clear();
        self.incoming_data.clear();
    }

    pub(super) fn on_server_data(&mut self, body: &[u8]) -> AgentDataResult {
        self.server_tokens_remaining = self.server_tokens_remaining.saturating_sub(1);
        let mut packets = Vec::new();
        if self.server_tokens_remaining <= VD_AGENT_DEFAULT_SERVER_TOKENS / 2 {
            self.server_tokens_remaining = self
                .server_tokens_remaining
                .saturating_add(VD_AGENT_DEFAULT_SERVER_TOKENS);
            packets.push(build_agent_token_packet(VD_AGENT_DEFAULT_SERVER_TOKENS));
        }
        self.parse_server_agent_data(body);
        packets.extend(self.flush_agent_data_packets());
        AgentDataResult { packets }
    }

    pub(super) fn set_monitors_config(&mut self, width: u32, height: u32) -> Vec<Vec<u8>> {
        self.pending_monitors_config = Some(MonitorResize {
            width: width.max(1),
            height: height.max(1),
        });
        self.flush_agent_data_packets()
    }

    fn connection_packets(&mut self) -> Vec<Vec<u8>> {
        if !self.connected {
            return Vec::new();
        }
        let mut packets = Vec::new();
        if !self.caps_announced {
            self.server_tokens_remaining = VD_AGENT_DEFAULT_SERVER_TOKENS;
            packets.push(build_agent_start_packet(VD_AGENT_DEFAULT_SERVER_TOKENS));
        }
        packets.extend(self.flush_agent_data_packets());
        packets
    }

    fn flush_agent_data_packets(&mut self) -> Vec<Vec<u8>> {
        if !self.connected {
            return Vec::new();
        }
        let mut packets = Vec::new();
        if !self.caps_announced {
            if self.client_tokens == 0 {
                return packets;
            }
            self.client_tokens = self.client_tokens.saturating_sub(1);
            self.caps_announced = true;
            packets.push(build_agent_data_packet(
                VD_AGENT_ANNOUNCE_CAPABILITIES,
                &build_agent_capabilities_body(),
            ));
        }
        if self.client_tokens == 0 {
            return packets;
        }
        if let Some(config) = self.pending_monitors_config.take() {
            self.client_tokens = self.client_tokens.saturating_sub(1);
            packets.push(build_agent_data_packet(
                VD_AGENT_MONITORS_CONFIG,
                &build_monitors_config_body(config.width, config.height),
            ));
        }
        while self.client_tokens > 0 {
            let Some(message) = self.pending_messages.front_mut() else {
                break;
            };
            let end = usize::min(
                message.offset.saturating_add(VD_AGENT_MAX_DATA_SIZE),
                message.bytes.len(),
            );
            self.client_tokens = self.client_tokens.saturating_sub(1);
            packets.push(build_spice_mini_packet(
                SPICE_MSGC_MAIN_AGENT_DATA,
                &message.bytes[message.offset..end],
            ));
            message.offset = end;
            if message.offset >= message.bytes.len() {
                self.pending_messages.pop_front();
            }
        }
        packets
    }

    fn enqueue_agent_data(&mut self, agent_type: u32, data: Vec<u8>) {
        self.pending_messages.push_back(PendingAgentMessage {
            bytes: build_agent_data_message(agent_type, &data),
            offset: 0,
        });
    }

    fn parse_server_agent_data(&mut self, body: &[u8]) {
        self.incoming_data.extend_from_slice(body);
        loop {
            if self.incoming_data.len() < AGENT_MESSAGE_HEADER_BYTES {
                break;
            }
            let data_size = u32::from_le_bytes(
                self.incoming_data[16..20]
                    .try_into()
                    .unwrap_or([0, 0, 0, 0]),
            ) as usize;
            let total_size = AGENT_MESSAGE_HEADER_BYTES.saturating_add(data_size);
            if self.incoming_data.len() < total_size {
                break;
            }
            let message = self.incoming_data[..total_size].to_vec();
            self.incoming_data.drain(0..total_size);
            self.handle_agent_message(&message);
        }
    }

    fn handle_agent_message(&mut self, message: &[u8]) {
        if message.len() < AGENT_MESSAGE_HEADER_BYTES {
            return;
        }
        let protocol =
            u32::from_le_bytes(message[0..4].try_into().unwrap_or([0, 0, 0, 0]));
        if protocol != VD_AGENT_PROTOCOL {
            return;
        }
        let agent_type =
            u32::from_le_bytes(message[4..8].try_into().unwrap_or([0, 0, 0, 0]));
        let data_size =
            u32::from_le_bytes(message[16..20].try_into().unwrap_or([0, 0, 0, 0])) as usize;
        let Some(payload) = message.get(20..20 + data_size) else {
            return;
        };
        if agent_type == VD_AGENT_ANNOUNCE_CAPABILITIES {
            self.handle_agent_capabilities(payload);
        }
    }

    fn handle_agent_capabilities(&mut self, payload: &[u8]) {
        if payload.len() < 4 {
            return;
        }
        let request = u32::from_le_bytes(payload[0..4].try_into().unwrap_or([0, 0, 0, 0]));
        if request != 0 {
            self.enqueue_agent_data(
                VD_AGENT_ANNOUNCE_CAPABILITIES,
                build_agent_capabilities_body(),
            );
        }
    }
}

impl ResizeControlPayload {
    pub(super) fn width(&self) -> u32 {
        self.width
    }

    pub(super) fn height(&self) -> u32 {
        self.height
    }
}

fn build_agent_start_packet(server_tokens: u32) -> Vec<u8> {
    build_spice_mini_packet(SPICE_MSGC_MAIN_AGENT_START, &server_tokens.to_le_bytes())
}

fn build_agent_token_packet(server_tokens: u32) -> Vec<u8> {
    build_spice_mini_packet(SPICE_MSGC_MAIN_AGENT_TOKEN, &server_tokens.to_le_bytes())
}

fn build_agent_data_message(agent_type: u32, data: &[u8]) -> Vec<u8> {
    let mut body = Vec::with_capacity(20 + data.len());
    body.extend_from_slice(&VD_AGENT_PROTOCOL.to_le_bytes());
    body.extend_from_slice(&agent_type.to_le_bytes());
    body.extend_from_slice(&0u64.to_le_bytes());
    body.extend_from_slice(&(data.len() as u32).to_le_bytes());
    body.extend_from_slice(data);
    body
}

fn build_agent_data_packet(agent_type: u32, data: &[u8]) -> Vec<u8> {
    build_spice_mini_packet(
        SPICE_MSGC_MAIN_AGENT_DATA,
        &build_agent_data_message(agent_type, data),
    )
}

fn build_agent_capabilities_body() -> Vec<u8> {
    let caps = (1u32 << VD_AGENT_CAP_MONITORS_CONFIG)
        | (1u32 << VD_AGENT_CAP_REPLY)
        | (1u32 << VD_AGENT_CAP_DISPLAY_CONFIG)
        | (1u32 << VD_AGENT_CAP_MONITORS_CONFIG_POSITION);
    let mut body = Vec::with_capacity(8);
    body.extend_from_slice(&0u32.to_le_bytes());
    body.extend_from_slice(&caps.to_le_bytes());
    body
}

fn build_monitors_config_body(width: u32, height: u32) -> Vec<u8> {
    let mut body = Vec::with_capacity(28);
    body.extend_from_slice(&1u32.to_le_bytes());
    body.extend_from_slice(&VD_AGENT_CONFIG_MONITORS_FLAG_USE_POS.to_le_bytes());
    body.extend_from_slice(&height.to_le_bytes());
    body.extend_from_slice(&width.to_le_bytes());
    body.extend_from_slice(&DEFAULT_MONITOR_DEPTH.to_le_bytes());
    body.extend_from_slice(&0i32.to_le_bytes());
    body.extend_from_slice(&0i32.to_le_bytes());
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resize_waits_for_agent_tokens_then_sends_monitor_config() {
        let mut state = AgentState::default();
        assert!(state.set_monitors_config(1920, 1080).is_empty());

        let packets = state.on_connected_tokens(2);
        assert_eq!(packets.len(), 3);
        assert_eq!(&packets[0][..2], &SPICE_MSGC_MAIN_AGENT_START.to_le_bytes());
        assert_eq!(&packets[1][..2], &SPICE_MSGC_MAIN_AGENT_DATA.to_le_bytes());
        assert_eq!(&packets[2][..2], &SPICE_MSGC_MAIN_AGENT_DATA.to_le_bytes());
        let monitors = &packets[2][26..];
        assert_eq!(u32::from_le_bytes(monitors[0..4].try_into().unwrap()), 1);
        assert_eq!(
            u32::from_le_bytes(monitors[8..12].try_into().unwrap()),
            1080
        );
        assert_eq!(
            u32::from_le_bytes(monitors[12..16].try_into().unwrap()),
            1920
        );
    }

    #[test]
    fn capabilities_advertise_monitor_and_display_config() {
        let body = build_agent_capabilities_body();
        let caps = u32::from_le_bytes(body[4..8].try_into().unwrap());

        assert_ne!(caps & (1u32 << VD_AGENT_CAP_MONITORS_CONFIG), 0);
        assert_ne!(caps & (1u32 << VD_AGENT_CAP_DISPLAY_CONFIG), 0);
        assert_ne!(caps & (1u32 << VD_AGENT_CAP_MONITORS_CONFIG_POSITION), 0);
    }
}
