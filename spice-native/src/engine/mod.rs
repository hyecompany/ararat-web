/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

mod agent;
mod audio;
mod channel;
mod cursor;
mod diagnostics;
mod events;
mod link;
mod packets;
mod port;
mod record;

use std::collections::HashMap;

use wasm_bindgen::prelude::*;

use crate::cache::SpiceCacheEpochs;
use crate::capabilities::{client_channel_caps, client_common_caps};
use crate::display_events::DisplayEvent;
use crate::display_state::SpiceDisplayState;
use crate::inputs::{build_input_packets, InputControlMessage};
use crate::mutation_graph::SpiceMutationGraph;
use crate::protocol::{
    build_spice_ack_packet, build_spice_ack_sync_packet, parse_spice_mini_header,
    parse_spice_set_ack, spice_ack_decision_sync, spice_ack_decision_window,
};
use crate::wire;

use self::agent::{AgentState, ResizeControlMessage};
use self::audio::{playback_event, EngineAudioEvent};
use self::channel::{ChannelPhase, ChannelState};
use self::cursor::{CursorCache, EngineCursorEvent};
use self::diagnostics::{
    channel_diagnostics, display_event_message_key, increment_count, EngineDiagnostics,
    EngineDiagnosticsPerformance, EnginePerformanceDiagnostics,
};
pub(crate) use self::events::EngineEvents;
use self::events::{
    ChannelDescriptor, EngineChannelPacket, EngineControlEvents, EngineSessionUpdate,
};
use self::link::{build_link_message, try_parse_link_reply, SPICE_LINK_AUTH_SPICE};
use self::packets::{
    build_attach_channels_packet, build_display_ready_packets, build_mouse_mode_request_packet,
    SPICE_MOUSE_MODE_CLIENT, SPICE_MSG_PING, SPICE_MSG_SET_ACK,
};
use self::port::{build_port_control_packet, port_event, EnginePortEvent, PortControlMessage};
use self::record::{EngineRecordEvent, RecordControlMessage, RecordState};

#[wasm_bindgen]
pub struct SpiceEngine {
    channels: HashMap<String, ChannelState>,
    display_state: SpiceDisplayState,
    mutation_graph: SpiceMutationGraph,
    cache_epochs: SpiceCacheEpochs,
    perf: EnginePerformanceDiagnostics,
    unsupported: Vec<String>,
    session_id: Option<u32>,
    current_mouse_mode: Option<u32>,
    multimedia_time: Option<u32>,
    agent: AgentState,
    cursor_cache: CursorCache,
    record_state: RecordState,
    disposed: bool,
}

#[wasm_bindgen]
impl SpiceEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> SpiceEngine {
        SpiceEngine {
            channels: HashMap::new(),
            display_state: SpiceDisplayState::new(),
            mutation_graph: SpiceMutationGraph::new(),
            cache_epochs: SpiceCacheEpochs::new(),
            perf: EnginePerformanceDiagnostics::default(),
            unsupported: Vec::new(),
            session_id: None,
            current_mouse_mode: None,
            multimedia_time: None,
            agent: AgentState::default(),
            cursor_cache: CursorCache::default(),
            record_state: RecordState::default(),
            disposed: false,
        }
    }

    pub fn open_channel(
        &mut self,
        channel_key: String,
        channel_type: u8,
        channel_id: u8,
        connection_id: u32,
    ) -> Vec<u8> {
        let mut channel = ChannelState::default();
        channel.channel_type = channel_type;
        channel.channel_id = channel_id;
        channel.connection_id = connection_id;
        self.channels.insert(channel_key, channel);
        build_link_message(
            channel_type,
            channel_id,
            connection_id,
            &client_common_caps(),
            &client_channel_caps(channel_type),
        )
    }

    pub fn submit_encrypted_ticket(&mut self, channel_key: String, ticket: &[u8]) -> Vec<u8> {
        if let Some(channel) = self.channels.get_mut(&channel_key) {
            channel.phase = ChannelPhase::AuthTicket;
        }
        ticket.to_vec()
    }

    pub fn ingest_channel_bytes(&mut self, channel_key: String, bytes: &[u8]) -> JsValue {
        let events = self.ingest_channel_bytes_native(channel_key, bytes);
        self.events_to_js(events)
    }

    pub(crate) fn ingest_channel_bytes_native(
        &mut self,
        channel_key: String,
        bytes: &[u8],
    ) -> EngineEvents {
        if self.disposed {
            return EngineEvents::empty();
        }

        self.perf.ingress_packets_consumed = self.perf.ingress_packets_consumed.saturating_add(1);
        self.perf.ingress_bytes_consumed = self
            .perf
            .ingress_bytes_consumed
            .saturating_add(bytes.len() as u64);

        let mut outbound: Vec<Vec<u8>> = Vec::new();
        let mut unsupported: Vec<String> = Vec::new();
        let mut ticket_public_keys: Vec<Vec<u8>> = Vec::new();
        let mut ready_channels: Vec<String> = Vec::new();
        let mut channels_to_open: Vec<ChannelDescriptor> = Vec::new();
        let mut display_events: Vec<DisplayEvent> = Vec::new();
        let mut audio_events: Vec<EngineAudioEvent> = Vec::new();
        let mut record_events: Vec<EngineRecordEvent> = Vec::new();
        let mut cursor_events: Vec<EngineCursorEvent> = Vec::new();
        let mut port_events: Vec<EnginePortEvent> = Vec::new();
        let mut session_update: Option<EngineSessionUpdate> = None;
        {
            let channel = self.channels.entry(channel_key.clone()).or_default();
            channel.buffer.extend_from_slice(bytes);

            loop {
                if channel.phase == ChannelPhase::Link {
                    let Some(reply) = try_parse_link_reply(&channel.buffer) else {
                        break;
                    };
                    if reply.error != 0 {
                        unsupported.push(format!("{}:link-error-{}", channel_key, reply.error));
                        break;
                    }
                    channel.channel_caps = reply.channel_caps;
                    channel.buffer.drain(0..reply.bytes_consumed);
                    if reply.supports_auth_selection {
                        if !reply.supports_spice_auth {
                            unsupported.push(format!("{}:unsupported-auth", channel_key));
                            break;
                        }
                        outbound.push(SPICE_LINK_AUTH_SPICE.to_le_bytes().to_vec());
                    }
                    ticket_public_keys.push(reply.public_key);
                    break;
                }

                if channel.phase == ChannelPhase::AuthTicket {
                    if channel.buffer.len() < 4 {
                        break;
                    }
                    let result = u32::from_le_bytes([
                        channel.buffer[0],
                        channel.buffer[1],
                        channel.buffer[2],
                        channel.buffer[3],
                    ]);
                    channel.buffer.drain(0..4);
                    if result != 0 {
                        unsupported.push(format!("{}:auth-error-{}", channel_key, result));
                        break;
                    }
                    channel.phase = ChannelPhase::Ready;
                    ready_channels.push(channel_key.clone());
                    if channel.channel_type == wire::SPICE_CHANNEL_DISPLAY {
                        outbound.extend(build_display_ready_packets(&channel.channel_caps));
                    }
                }

                if channel.buffer.len() < 6 {
                    break;
                }
                let header = match parse_spice_mini_header(&channel.buffer[..6]) {
                    Ok(header) => header,
                    Err(_) => break,
                };
                let size = header.body_size() as usize;
                let packet_size = 6usize.saturating_add(size);
                if channel.buffer.len() < packet_size {
                    break;
                }
                let message_type = header.message_type();
                channel.parsed_mini_messages = channel.parsed_mini_messages.saturating_add(1);
                let parsed_serial = channel.parsed_mini_messages;
                channel.last_message_type = Some(message_type);
                channel.last_body_size = Some(header.body_size());
                let body = &channel.buffer[6..packet_size];
                let mut count_for_ack = true;
                match message_type {
                    SPICE_MSG_SET_ACK => {
                        count_for_ack = false;
                        if let Ok(set_ack) = parse_spice_set_ack(&body) {
                            if channel
                                .ack
                                .configure(set_ack.generation(), set_ack.window())
                                == spice_ack_decision_sync()
                            {
                                outbound.push(build_spice_ack_sync_packet(set_ack.generation()));
                                self.perf.ingress_ack_sync_count =
                                    self.perf.ingress_ack_sync_count.saturating_add(1);
                            }
                        }
                    }
                    SPICE_MSG_PING => {
                        outbound.push(crate::protocol::build_spice_pong_packet(&body));
                    }
                    wire::SPICE_MSG_WAIT_FOR_CHANNELS => {
                        if let Ok(wait) = wire::parse_wait_for_channels(&body) {
                            let barrier = self.mutation_graph.add_wait_barrier_serials(
                                wait.wait_list.into_iter().map(|wait| {
                                    (wait.channel_type, wait.channel_id, wait.message_serial)
                                }),
                            );
                            let _ = self.mutation_graph.is_barrier_satisfied(barrier);
                        } else {
                            unsupported
                                .push(format!("{}:wait-for-channels-truncated", channel_key));
                        }
                    }
                    wire::SPICE_MSG_MAIN_INIT
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        if let Ok(init) = wire::parse_main_init(&body) {
                            self.session_id = Some(init.session_id);
                            self.current_mouse_mode = Some(init.current_mouse_mode);
                            self.multimedia_time = Some(init.multi_media_time);
                            outbound.push(build_attach_channels_packet());
                            outbound.extend(
                                self.agent
                                    .on_main_init(init.agent_connected != 0, init.agent_tokens),
                            );
                            if (init.supported_mouse_modes & SPICE_MOUSE_MODE_CLIENT) != 0 {
                                outbound
                                    .push(build_mouse_mode_request_packet(SPICE_MOUSE_MODE_CLIENT));
                            }
                            session_update = Some(EngineSessionUpdate {
                                session_id: Some(init.session_id),
                                current_mouse_mode: Some(init.current_mouse_mode),
                                multimedia_time: Some(init.multi_media_time),
                            });
                        } else {
                            unsupported.push(format!("{}:main-init-truncated", channel_key));
                        }
                    }
                    wire::SPICE_MSG_MAIN_CHANNELS_LIST
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        if let Ok(channels) = wire::parse_main_channels_list(&body) {
                            channels_to_open.extend(channels.channels.into_iter().map(|channel| {
                                ChannelDescriptor {
                                    channel_type: channel.channel_type,
                                    channel_id: channel.channel_id,
                                }
                            }));
                        } else {
                            unsupported.push(format!("{}:channels-list-truncated", channel_key));
                        }
                    }
                    wire::SPICE_MSG_MAIN_MOUSE_MODE
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        if let Ok(mouse_mode) = wire::parse_main_mouse_mode(&body) {
                            let current = u32::from(mouse_mode.current_mode);
                            self.current_mouse_mode = Some(current);
                            session_update = Some(EngineSessionUpdate {
                                session_id: self.session_id,
                                current_mouse_mode: Some(current),
                                multimedia_time: self.multimedia_time,
                            });
                        }
                    }
                    wire::SPICE_MSG_MAIN_MULTI_MEDIA_TIME
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        if let Ok(multimedia_time) = wire::parse_main_multimedia_time(&body) {
                            self.multimedia_time = Some(multimedia_time.time);
                            session_update = Some(EngineSessionUpdate {
                                session_id: self.session_id,
                                current_mouse_mode: self.current_mouse_mode,
                                multimedia_time: Some(multimedia_time.time),
                            });
                        }
                    }
                    wire::SPICE_MSG_MAIN_AGENT_CONNECTED
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        outbound.extend(self.agent.on_connected());
                    }
                    wire::SPICE_MSG_MAIN_AGENT_CONNECTED_TOKENS
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        if let Ok(tokens) = wire::parse_main_agent_tokens(&body) {
                            outbound.extend(self.agent.on_connected_tokens(tokens.num_tokens));
                        } else {
                            unsupported
                                .push(format!("{}:agent-connected-tokens-truncated", channel_key));
                        }
                    }
                    wire::SPICE_MSG_MAIN_AGENT_TOKEN
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        if let Ok(tokens) = wire::parse_main_agent_tokens(&body) {
                            outbound.extend(self.agent.on_client_tokens(tokens.num_tokens));
                        } else {
                            unsupported.push(format!("{}:agent-token-truncated", channel_key));
                        }
                    }
                    wire::SPICE_MSG_MAIN_AGENT_DISCONNECTED
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        self.agent.on_disconnected();
                    }
                    wire::SPICE_MSG_MAIN_AGENT_DATA
                        if channel.channel_type == wire::SPICE_CHANNEL_MAIN =>
                    {
                        let result = self.agent.on_server_data(body);
                        outbound.extend(result.packets);
                    }
                    wire::SPICE_MSG_NOTIFY if channel.channel_type == wire::SPICE_CHANNEL_MAIN => {
                        let _ = wire::parse_notify(&body);
                    }
                    message if channel.channel_type == wire::SPICE_CHANNEL_DISPLAY => {
                        increment_count(&mut self.perf.display_message_counts, message);
                        match self.display_state.handle_message(
                            message,
                            &body,
                            &mut self.mutation_graph,
                            &mut self.cache_epochs,
                        ) {
                            Ok(Some(event)) => {
                                increment_count(
                                    &mut self.perf.display_event_counts,
                                    display_event_message_key(&event),
                                );
                                display_events.push(event);
                            }
                            Ok(None) => {
                                increment_count(&mut self.perf.display_error_counts, message);
                                unsupported
                                    .push(format!("{}:display-message-{}", channel_key, message));
                            }
                            Err(reason) => {
                                increment_count(&mut self.perf.display_error_counts, message);
                                unsupported.push(format!(
                                    "{}:display-message-{}:{}",
                                    channel_key, message, reason
                                ));
                            }
                        }
                    }
                    message if channel.channel_type == wire::SPICE_CHANNEL_PLAYBACK => {
                        match playback_event(message, &body) {
                            Ok(Some(event)) => audio_events.push(event),
                            Ok(None) => {}
                            Err(reason) => unsupported.push(format!(
                                "{}:playback-message-{}:{}",
                                channel_key,
                                message,
                                reason.message()
                            )),
                        }
                    }
                    message if channel.channel_type == wire::SPICE_CHANNEL_INPUTS => {
                        match message {
                            wire::SPICE_MSG_INPUTS_INIT => {
                                if let Ok(modifiers) = wire::parse_inputs_init(&body) {
                                    session_update = Some(EngineSessionUpdate {
                                        session_id: self.session_id,
                                        current_mouse_mode: self.current_mouse_mode,
                                        multimedia_time: self.multimedia_time,
                                    });
                                    let _ = modifiers;
                                }
                            }
                            wire::SPICE_MSG_INPUTS_KEY_MODIFIERS => {
                                let _ = wire::parse_inputs_key_modifiers(&body);
                            }
                            wire::SPICE_MSG_INPUTS_MOUSE_MOTION_ACK => {}
                            _ => unsupported
                                .push(format!("{}:inputs-message-{}", channel_key, message)),
                        }
                    }
                    message if channel.channel_type == wire::SPICE_CHANNEL_RECORD => {
                        match self
                            .record_state
                            .handle_server_message(&channel_key, message, &body)
                        {
                            Ok(Some(event)) => record_events.push(event),
                            Ok(None) => unsupported
                                .push(format!("{}:record-message-{}", channel_key, message)),
                            Err(reason) => unsupported.push(format!(
                                "{}:record-message-{}:{}",
                                channel_key,
                                message,
                                reason.message()
                            )),
                        }
                    }
                    message if channel.channel_type == wire::SPICE_CHANNEL_CURSOR => {
                        match self.cursor_cache.handle(message, &body) {
                            Ok(Some(event)) => cursor_events.push(event),
                            Ok(None) => unsupported
                                .push(format!("{}:cursor-message-{}", channel_key, message)),
                            Err(reason) => unsupported.push(format!(
                                "{}:cursor-message-{}:{}",
                                channel_key,
                                message,
                                reason.message()
                            )),
                        }
                    }
                    message
                        if channel.channel_type == wire::SPICE_CHANNEL_PORT
                            || channel.channel_type == wire::SPICE_CHANNEL_WEBDAV =>
                    {
                        match port_event(channel.channel_type, channel.channel_id, message, &body) {
                            Ok(Some(event)) => port_events.push(event),
                            Ok(None) => unsupported
                                .push(format!("{}:port-message-{}", channel_key, message)),
                            Err(reason) => unsupported.push(format!(
                                "{}:port-message-{}:{}",
                                channel_key,
                                message,
                                reason.message()
                            )),
                        }
                    }
                    _ => {
                        unsupported.push(format!("{}:mini-message-{}", channel_key, message_type));
                    }
                }
                channel.buffer.drain(0..packet_size);
                if count_for_ack && channel.ack.observe_packet() == spice_ack_decision_window() {
                    outbound.push(build_spice_ack_packet());
                    self.perf.ingress_ack_count = self.perf.ingress_ack_count.saturating_add(1);
                }
                self.mutation_graph.observe_channel_serial(
                    channel.channel_type,
                    channel.channel_id,
                    parsed_serial,
                );
                for event in self
                    .display_state
                    .flush_satisfied_barriers(&self.mutation_graph, &mut self.cache_epochs)
                {
                    increment_count(
                        &mut self.perf.display_event_counts,
                        display_event_message_key(&event),
                    );
                    display_events.push(event);
                }
            }
        }
        for key in unsupported {
            self.record_unsupported(key);
        }

        EngineEvents {
            outbound,
            ticket_public_keys,
            ready_channels,
            channels_to_open,
            display_events,
            audio_events,
            record_events,
            cursor_events,
            port_events,
            session_update,
        }
    }

    pub(crate) fn events_to_js(&mut self, events: EngineEvents) -> JsValue {
        match serde_wasm_bindgen::to_value(&events) {
            Ok(value) => value,
            Err(error) => {
                self.record_unsupported(format!("native-events-serialize:{}", error));
                serde_wasm_bindgen::to_value(&EngineEvents {
                    outbound: events.outbound,
                    ticket_public_keys: events.ticket_public_keys,
                    ready_channels: events.ready_channels,
                    channels_to_open: events.channels_to_open,
                    display_events: Vec::new(),
                    audio_events: events.audio_events,
                    record_events: events.record_events,
                    cursor_events: events.cursor_events,
                    port_events: events.port_events,
                    session_update: events.session_update,
                })
                .unwrap_or(JsValue::NULL)
            }
        }
    }

    #[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
    pub(crate) fn check_visual_token_native(&self, token: u64) -> bool {
        self.mutation_graph.check_token(token) == 0
    }

    #[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
    pub(crate) fn commit_visual_token_native(&mut self, token: u64) -> bool {
        self.mutation_graph.commit_token(token)
    }

    #[cfg(all(feature = "webgpu-wgpu", target_arch = "wasm32"))]
    pub(crate) fn release_visual_token_native(&mut self, token: u64) -> bool {
        self.mutation_graph.release_token(token)
    }

    pub fn control(&mut self, message: JsValue) -> JsValue {
        if self.disposed {
            return JsValue::NULL;
        }
        if let Ok(ResizeControlMessage::Resize(payload)) =
            serde_wasm_bindgen::from_value::<ResizeControlMessage>(message.clone())
        {
            let Some(channel_key) = self.ready_channel_key(wire::SPICE_CHANNEL_MAIN) else {
                return JsValue::NULL;
            };
            let packets = self
                .agent
                .set_monitors_config(payload.width(), payload.height())
                .into_iter()
                .map(|packet| EngineChannelPacket {
                    channel_key: channel_key.clone(),
                    packet,
                })
                .collect();
            return serde_wasm_bindgen::to_value(&EngineControlEvents {
                channel_packets: packets,
            })
            .unwrap_or(JsValue::NULL);
        }
        if let Ok(control) = serde_wasm_bindgen::from_value::<PortControlMessage>(message.clone()) {
            let (channel_type, channel_id, packet) = build_port_control_packet(control);
            let Some(channel_key) = self.ready_channel_key_exact(channel_type, channel_id) else {
                return JsValue::NULL;
            };
            return serde_wasm_bindgen::to_value(&EngineControlEvents {
                channel_packets: vec![EngineChannelPacket {
                    channel_key,
                    packet,
                }],
            })
            .unwrap_or(JsValue::NULL);
        }
        if let Ok(control) = serde_wasm_bindgen::from_value::<RecordControlMessage>(message.clone())
        {
            let Some(channel_key) = self.ready_channel_key(wire::SPICE_CHANNEL_RECORD) else {
                return JsValue::NULL;
            };
            let packets = self
                .record_state
                .control_packets(&channel_key, control)
                .into_iter()
                .map(|packet| EngineChannelPacket {
                    channel_key: channel_key.clone(),
                    packet,
                })
                .collect();
            return serde_wasm_bindgen::to_value(&EngineControlEvents {
                channel_packets: packets,
            })
            .unwrap_or(JsValue::NULL);
        }
        let Ok(control) = serde_wasm_bindgen::from_value::<InputControlMessage>(message) else {
            return JsValue::NULL;
        };
        let Some(channel_key) = self.ready_channel_key(wire::SPICE_CHANNEL_INPUTS) else {
            return JsValue::NULL;
        };
        let packets = build_input_packets(control, self.current_mouse_mode)
            .into_iter()
            .map(|packet| EngineChannelPacket {
                channel_key: channel_key.clone(),
                packet,
            })
            .collect();
        serde_wasm_bindgen::to_value(&EngineControlEvents {
            channel_packets: packets,
        })
        .unwrap_or(JsValue::NULL)
    }

    pub fn diagnostics(&self) -> JsValue {
        let diagnostics = EngineDiagnostics {
            performance: EngineDiagnosticsPerformance {
                ingress_packets_consumed: self.perf.ingress_packets_consumed,
                ingress_bytes_consumed: self.perf.ingress_bytes_consumed,
                ingress_ack_count: self.perf.ingress_ack_count,
                ingress_ack_sync_count: self.perf.ingress_ack_sync_count,
                region_ownership_entries: self.mutation_graph.owner_count(),
                region_ownership_pruned_entries: self.mutation_graph.tombstone_count(),
                cache_epoch_resources: self.cache_epochs.resource_count(),
                cache_epoch_kinds: self.cache_epochs.kind_count(),
                ordering_barriers: self.mutation_graph.barrier_count(),
                unsupported_counts: self.perf.unsupported_counts.clone(),
                display_message_counts: self.perf.display_message_counts.clone(),
                display_event_counts: self.perf.display_event_counts.clone(),
                display_error_counts: self.perf.display_error_counts.clone(),
            },
            unsupported: self.unsupported.clone(),
            session: EngineSessionUpdate {
                session_id: self.session_id,
                current_mouse_mode: self.current_mouse_mode,
                multimedia_time: self.multimedia_time,
            },
            channel_diagnostics: self
                .channels
                .iter()
                .map(|(key, channel)| channel_diagnostics(key, channel))
                .collect(),
        };
        serde_wasm_bindgen::to_value(&diagnostics).unwrap_or(JsValue::NULL)
    }

    pub fn check_visual_token(&self, token: u64) -> bool {
        self.mutation_graph.check_token(token) == 0
    }

    pub fn commit_visual_token(&mut self, token: u64) -> bool {
        self.mutation_graph.commit_token(token)
    }

    pub fn dispose(&mut self) {
        self.disposed = true;
        self.channels.clear();
        self.display_state.reset();
        self.mutation_graph.clear();
        self.cache_epochs.clear();
        self.session_id = None;
        self.current_mouse_mode = None;
        self.multimedia_time = None;
        self.cursor_cache.clear();
        self.record_state.clear();
    }
}

impl SpiceEngine {
    fn record_unsupported(&mut self, key: String) {
        *self.perf.unsupported_counts.entry(key.clone()).or_insert(0) += 1;
        self.unsupported.push(key);
        if self.unsupported.len() > 64 {
            let remove_count = self.unsupported.len() - 64;
            self.unsupported.drain(0..remove_count);
        }
    }

    fn ready_channel_key(&self, channel_type: u8) -> Option<String> {
        self.channels.iter().find_map(|(key, channel)| {
            (channel.channel_type == channel_type && channel.phase == ChannelPhase::Ready)
                .then(|| key.clone())
        })
    }

    fn ready_channel_key_exact(&self, channel_type: u8, channel_id: u8) -> Option<String> {
        self.channels.iter().find_map(|(key, channel)| {
            (channel.channel_type == channel_type
                && channel.channel_id == channel_id
                && channel.phase == ChannelPhase::Ready)
                .then(|| key.clone())
        })
    }
}
