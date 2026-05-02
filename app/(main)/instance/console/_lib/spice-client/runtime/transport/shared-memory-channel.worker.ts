/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import {
  RING_CONTROL_WORDS,
  RING_DROPPED_BYTES,
  RING_QUEUED_BYTES,
  RING_SIGNAL,
  RING_STATE,
  RING_STATE_CLOSED,
  RING_STATE_CONNECTING,
  RING_STATE_ERROR,
  RING_STATE_OPEN,
  RING_WRAP_COUNT,
  RING_WRITE_OFFSET,
  alignRingBytes,
  writeRingU32,
} from './shared-memory-ring.js';

interface InitMessage {
  type: 'init';
  key: string;
  url: string;
  control: SharedArrayBuffer;
  data: SharedArrayBuffer;
  maxQueuedBytes: number;
}

type ControlMessage = InitMessage | { type: 'send'; data: ArrayBuffer | Uint8Array } | { type: 'dispose' };

let key = '';
let socket: WebSocket | null = null;
let control: Int32Array | null = null;
let ring: Uint8Array | null = null;
let maxQueuedBytes = 0;
let sentMessages = 0;
let sentBytes = 0;
let receivedMessages = 0;
let receivedBytes = 0;

self.onmessage = (event: MessageEvent<ControlMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      initialize(message);
      break;
    case 'send':
      send(message.data);
      break;
    case 'dispose':
      dispose();
      break;
  }
};

function initialize(message: InitMessage) {
  dispose();
  key = message.key;
  control = new Int32Array(message.control);
  ring = new Uint8Array(message.data);
  maxQueuedBytes = Math.min(message.maxQueuedBytes, ring.byteLength);
  for (let index = 0; index < RING_CONTROL_WORDS; index += 1) {
    Atomics.store(control, index, 0);
  }
  Atomics.store(control, RING_STATE, RING_STATE_CONNECTING);

  const nextSocket = new WebSocket(message.url);
  nextSocket.binaryType = 'arraybuffer';
  socket = nextSocket;
  nextSocket.onopen = () => {
    if (control) {
      Atomics.store(control, RING_STATE, RING_STATE_OPEN);
    }
    self.postMessage({ type: 'open', key });
  };
  nextSocket.onclose = () => {
    if (control) {
      Atomics.store(control, RING_STATE, RING_STATE_CLOSED);
    }
    self.postMessage({ type: 'close', key });
  };
  nextSocket.onerror = () => {
    if (control) {
      Atomics.store(control, RING_STATE, RING_STATE_ERROR);
    }
    self.postMessage({ type: 'error', key, message: 'shared-memory websocket error' });
  };
  nextSocket.onmessage = (event) => {
    if (!(event.data instanceof ArrayBuffer)) {
      return;
    }
    receivedMessages += 1;
    receivedBytes += event.data.byteLength;
    if (!writePacket(new Uint8Array(event.data))) {
      self.postMessage({
        type: 'error',
        key,
        message: `shared-memory ring byte budget exceeded: ${event.data.byteLength}`,
      });
      nextSocket.close(1013, 'SPICE shared-memory ring backpressure');
      return;
    }
    self.postMessage({
      type: 'bytes',
      key,
      byteLength: event.data.byteLength,
      receivedMessages,
      receivedBytes,
    });
  };
}

function writePacket(packet: Uint8Array) {
  if (!control || !ring) {
    return false;
  }
  const required = alignRingBytes(4 + packet.byteLength);
  if (required > ring.byteLength || required > maxQueuedBytes) {
    Atomics.add(control, RING_DROPPED_BYTES, packet.byteLength);
    return false;
  }
  let queued = Atomics.load(control, RING_QUEUED_BYTES);
  if (queued + required > maxQueuedBytes) {
    Atomics.add(control, RING_DROPPED_BYTES, packet.byteLength);
    return false;
  }
  let writeOffset = Atomics.load(control, RING_WRITE_OFFSET);
  if (writeOffset + required > ring.byteLength) {
    if (writeOffset + 4 <= ring.byteLength) {
      writeRingU32(ring, writeOffset, 0);
      const markerBytes = 4;
      queued = Atomics.add(control, RING_QUEUED_BYTES, markerBytes) + markerBytes;
      Atomics.add(control, RING_WRAP_COUNT, 1);
    }
    writeOffset = 0;
  }
  if (queued + required > maxQueuedBytes || writeOffset + required > ring.byteLength) {
    Atomics.add(control, RING_DROPPED_BYTES, packet.byteLength);
    return false;
  }
  writeRingU32(ring, writeOffset, packet.byteLength);
  ring.set(packet, writeOffset + 4);
  const paddedEnd = writeOffset + required;
  ring.fill(0, writeOffset + 4 + packet.byteLength, paddedEnd);
  Atomics.store(control, RING_WRITE_OFFSET, paddedEnd === ring.byteLength ? 0 : paddedEnd);
  Atomics.add(control, RING_QUEUED_BYTES, required);
  Atomics.add(control, RING_SIGNAL, 1);
  return true;
}

function send(data: ArrayBuffer | Uint8Array) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(data);
  sentMessages += 1;
  sentBytes += data.byteLength;
  self.postMessage({ type: 'sent', key, sentMessages, sentBytes });
}

function dispose() {
  const existing = socket;
  socket = null;
  if (control) {
    Atomics.store(control, RING_STATE, RING_STATE_CLOSED);
  }
  if (existing && existing.readyState < WebSocket.CLOSING) {
    existing.close(1000, 'SPICE shared-memory channel disposed');
  }
}

export {};
