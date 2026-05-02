/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

use crate::protocol::SpiceAckState;

#[derive(Clone, Copy, Eq, PartialEq)]
pub(super) enum ChannelPhase {
    Link,
    AuthTicket,
    Ready,
}

pub(super) struct ChannelState {
    pub(super) ack: SpiceAckState,
    pub(super) buffer: Vec<u8>,
    pub(super) phase: ChannelPhase,
    pub(super) channel_type: u8,
    pub(super) channel_id: u8,
    pub(super) connection_id: u32,
    pub(super) channel_caps: Vec<u32>,
    pub(super) parsed_mini_messages: u64,
    pub(super) last_message_type: Option<u16>,
    pub(super) last_body_size: Option<u32>,
}

impl Default for ChannelState {
    fn default() -> Self {
        ChannelState {
            ack: SpiceAckState::new(),
            buffer: Vec::new(),
            phase: ChannelPhase::Link,
            channel_type: 0,
            channel_id: 0,
            connection_id: 0,
            channel_caps: Vec::new(),
            parsed_mini_messages: 0,
            last_message_type: None,
            last_body_size: None,
        }
    }
}

pub(super) fn channel_phase_name(phase: ChannelPhase) -> &'static str {
    match phase {
        ChannelPhase::Link => "link",
        ChannelPhase::AuthTicket => "authTicket",
        ChannelPhase::Ready => "ready",
    }
}
