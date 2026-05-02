/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export const RING_READ_OFFSET = 0;
export const RING_WRITE_OFFSET = 1;
export const RING_QUEUED_BYTES = 2;
export const RING_STATE = 3;
export const RING_SIGNAL = 4;
export const RING_DROPPED_BYTES = 5;
export const RING_WRAP_COUNT = 6;
export const RING_CONTROL_WORDS = 8;

export const RING_STATE_CONNECTING = 0;
export const RING_STATE_OPEN = 1;
export const RING_STATE_CLOSING = 2;
export const RING_STATE_CLOSED = 3;
export const RING_STATE_ERROR = 4;

export function alignRingBytes(value: number) {
  return (value + 3) & ~3;
}

export function readRingU32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

export function writeRingU32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
