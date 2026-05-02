/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type {
  RuntimeSpiceChannel,
  RuntimeSpiceChannelOptions,
  RuntimeSpiceChannelSnapshot,
} from './channel.js';
import {
  RING_CONTROL_WORDS,
  RING_QUEUED_BYTES,
  RING_READ_OFFSET,
  RING_SIGNAL,
  RING_STATE,
  RING_STATE_CLOSED,
  RING_WRAP_COUNT,
  alignRingBytes,
  readRingU32,
} from './shared-memory-ring.js';

const DEFAULT_RING_BYTES = 16 * 1024 * 1024;

type WorkerMessage =
  | { type: 'open'; key: string }
  | { type: 'close'; key: string }
  | { type: 'error'; key: string; message: string }
  | {
      type: 'bytes';
      key: string;
      byteLength: number;
      receivedMessages: number;
      receivedBytes: number;
    }
  | { type: 'sent'; key: string; sentMessages: number; sentBytes: number };

export class SharedMemoryWebSocketChannel implements RuntimeSpiceChannel {
  private readonly controlBuffer = new SharedArrayBuffer(RING_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT);
  private readonly dataBuffer: SharedArrayBuffer;
  private readonly control = new Int32Array(this.controlBuffer);
  private readonly data: Uint8Array;
  private worker: Worker | null = null;
  private opened = false;
  private readyState: number = WebSocket.CONNECTING;
  private queuedBytes = 0;
  private receivedMessages = 0;
  private receivedBytes = 0;
  private sentMessages = 0;
  private sentBytes = 0;
  private sharedMemoryBytes = 0;
  private sharedMemoryFallbackBytes = 0;
  private sharedMemoryRingSignals = 0;

  constructor(private readonly options: RuntimeSpiceChannelOptions) {
    const maxQueuedBytes = options.maxQueuedBytes ?? DEFAULT_RING_BYTES;
    const ringBytes = Math.max(1024 * 1024, alignRingBytes(maxQueuedBytes));
    this.dataBuffer = new SharedArrayBuffer(ringBytes);
    this.data = new Uint8Array(this.dataBuffer);
  }

  connect() {
    const worker = new Worker(
      new URL('./shared-memory-channel.worker.js', import.meta.url),
      { type: 'module', name: `spice-shared-memory-${this.options.key}` },
    );
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handleWorkerMessage(event.data);
    worker.onerror = () => {
      this.options.onError?.(this.options.key, 'shared-memory transport worker error');
    };
    worker.postMessage({
      type: 'init',
      key: this.options.key,
      url: this.options.url,
      control: this.controlBuffer,
      data: this.dataBuffer,
      maxQueuedBytes: this.options.maxQueuedBytes ?? DEFAULT_RING_BYTES,
    });
  }

  send(data: ArrayBuffer | Uint8Array) {
    if (!this.worker || !this.opened) {
      return false;
    }
    const payload = data instanceof Uint8Array ? data.slice().buffer : data.slice(0);
    this.worker.postMessage({ type: 'send', data: payload }, [payload]);
    return true;
  }

  dispose() {
    this.opened = false;
    this.readyState = WebSocket.CLOSED;
    this.worker?.postMessage({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    Atomics.store(this.control, RING_STATE, RING_STATE_CLOSED);
  }

  snapshot(): RuntimeSpiceChannelSnapshot {
    return {
      key: this.options.key,
      open: this.opened,
      queuedBytes: this.queuedBytes,
      readyState: this.readyState,
      sentMessages: this.sentMessages,
      sentBytes: this.sentBytes,
      receivedMessages: this.receivedMessages,
      receivedBytes: this.receivedBytes,
      transport: 'shared-memory-websocket',
      sharedMemoryBytes: this.sharedMemoryBytes,
      sharedMemoryFallbackBytes: this.sharedMemoryFallbackBytes,
      sharedMemoryRingSignals: this.sharedMemoryRingSignals,
      sharedMemoryRingWraps: Atomics.load(this.control, RING_WRAP_COUNT),
    };
  }

  private handleWorkerMessage(message: WorkerMessage) {
    switch (message.type) {
      case 'open':
        this.opened = true;
        this.readyState = WebSocket.OPEN;
        this.options.onOpen?.(this.options.key);
        break;
      case 'close':
        this.opened = false;
        this.readyState = WebSocket.CLOSED;
        this.options.onClose?.(this.options.key);
        break;
      case 'error':
        this.readyState = WebSocket.CLOSING;
        this.options.onError?.(this.options.key, message.message);
        break;
      case 'bytes':
        this.receivedMessages = message.receivedMessages;
        this.receivedBytes = message.receivedBytes;
        this.sharedMemoryRingSignals += 1;
        this.drain();
        break;
      case 'sent':
        this.sentMessages = message.sentMessages;
        this.sentBytes = message.sentBytes;
        break;
    }
  }

  private drain() {
    let queued = Atomics.load(this.control, RING_QUEUED_BYTES);
    while (queued >= 4) {
      let readOffset = Atomics.load(this.control, RING_READ_OFFSET);
      if (readOffset >= this.data.byteLength) {
        readOffset = 0;
        Atomics.store(this.control, RING_READ_OFFSET, 0);
      }
      const packetLength = readRingU32(this.data, readOffset);
      if (packetLength === 0) {
        Atomics.store(this.control, RING_READ_OFFSET, 0);
        Atomics.sub(this.control, RING_QUEUED_BYTES, 4);
        queued = Atomics.load(this.control, RING_QUEUED_BYTES);
        continue;
      }
      const required = alignRingBytes(4 + packetLength);
      if (queued < required || readOffset + required > this.data.byteLength) {
        this.sharedMemoryFallbackBytes += packetLength;
        break;
      }
      const packet = new Uint8Array(this.dataBuffer, readOffset + 4, packetLength);
      this.options.onBytes(this.options.key, packet, this.dataBuffer);
      this.sharedMemoryBytes += packetLength;
      const nextReadOffset = readOffset + required;
      Atomics.store(
        this.control,
        RING_READ_OFFSET,
        nextReadOffset === this.data.byteLength ? 0 : nextReadOffset,
      );
      Atomics.sub(this.control, RING_QUEUED_BYTES, required);
      queued = Atomics.load(this.control, RING_QUEUED_BYTES);
    }
    this.queuedBytes = queued;
    this.sharedMemoryRingSignals = Math.max(
      this.sharedMemoryRingSignals,
      Atomics.load(this.control, RING_SIGNAL),
    );
  }
}
