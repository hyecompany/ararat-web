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
} from './channel.js';

export class RuntimeWebSocketChannel implements RuntimeSpiceChannel {
  private socket: WebSocket | null = null;
  private queuedBytes = 0;
  private opened = false;
  private receivedMessages = 0;
  private receivedBytes = 0;
  private sentMessages = 0;
  private sentBytes = 0;
  private pendingChunks: Uint8Array[] = [];
  private pendingChunkBytes = 0;
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private ingressBatchFlushes = 0;
  private ingressBatchedMessages = 0;
  private ingressBatchedBytes = 0;
  private ingressBatchConcatBytes = 0;

  constructor(private readonly options: RuntimeSpiceChannelOptions) {}

  connect() {
    const socket = new WebSocket(this.options.url);
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.onopen = () => {
      this.opened = true;
      this.options.onOpen?.(this.options.key);
    };
    socket.onclose = () => {
      this.opened = false;
      this.options.onClose?.(this.options.key);
    };
    socket.onerror = () => {
      this.options.onError?.(this.options.key, 'websocket error');
    };
    socket.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) {
        return;
      }
      this.receivedMessages += 1;
      this.receivedBytes += event.data.byteLength;
      this.queuedBytes += event.data.byteLength;
      const maxQueuedBytes = this.options.maxQueuedBytes ?? 32 * 1024 * 1024;
      if (this.queuedBytes > maxQueuedBytes) {
        this.options.onError?.(
          this.options.key,
          `websocket byte budget exceeded: ${this.queuedBytes}`,
        );
        socket.close(1013, 'SPICE client backpressure');
        return;
      }
      const bytes = new Uint8Array(event.data);
      if (this.shouldBatchIngress()) {
        this.enqueueIngressChunk(bytes);
      } else {
        this.options.onBytes(this.options.key, bytes, event.data);
        this.queuedBytes = Math.max(0, this.queuedBytes - event.data.byteLength);
      }
    };
  }

  send(data: ArrayBuffer | Uint8Array) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(data);
    this.sentMessages += 1;
    this.sentBytes += data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
    return true;
  }

  dispose() {
    this.flushIngressChunks();
    const socket = this.socket;
    this.socket = null;
    this.opened = false;
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'SPICE client disposed');
    }
  }

  snapshot() {
    return {
      key: this.options.key,
      open: this.opened,
      queuedBytes: this.queuedBytes,
      readyState: this.socket?.readyState ?? WebSocket.CLOSED,
      sentMessages: this.sentMessages,
      sentBytes: this.sentBytes,
      receivedMessages: this.receivedMessages,
      receivedBytes: this.receivedBytes,
      transport: 'websocket' as const,
      ingressBatchFlushes: this.ingressBatchFlushes,
      ingressBatchedMessages: this.ingressBatchedMessages,
      ingressBatchedBytes: this.ingressBatchedBytes,
      ingressBatchConcatBytes: this.ingressBatchConcatBytes,
    };
  }

  private shouldBatchIngress() {
    return (this.options.ingressBatchWindowMs ?? 0) > 0;
  }

  private enqueueIngressChunk(bytes: Uint8Array) {
    this.pendingChunks.push(bytes);
    this.pendingChunkBytes += bytes.byteLength;
    const maxBatchBytes = this.options.maxIngressBatchBytes ?? 8 * 1024 * 1024;
    if (this.pendingChunkBytes >= maxBatchBytes) {
      this.flushIngressChunks();
      return;
    }
    if (this.batchTimer !== null) {
      return;
    }
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushIngressChunks();
    }, this.options.ingressBatchWindowMs) as unknown as ReturnType<typeof setTimeout>;
  }

  private flushIngressChunks() {
    if (this.pendingChunks.length === 0) {
      return;
    }
    const chunks = this.pendingChunks;
    const byteLength = this.pendingChunkBytes;
    this.pendingChunks = [];
    this.pendingChunkBytes = 0;
    this.ingressBatchFlushes += 1;
    this.ingressBatchedMessages += chunks.length;
    this.ingressBatchedBytes += byteLength;
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (chunks.length === 1) {
      const [chunk] = chunks;
      this.options.onBytes(this.options.key, chunk, chunk.buffer);
      this.queuedBytes = Math.max(0, this.queuedBytes - byteLength);
      return;
    }
    const merged = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.ingressBatchConcatBytes += byteLength;
    this.options.onBytes(this.options.key, merged, merged.buffer);
    this.queuedBytes = Math.max(0, this.queuedBytes - byteLength);
  }
}
