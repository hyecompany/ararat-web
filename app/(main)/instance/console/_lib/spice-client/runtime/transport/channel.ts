/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export interface RuntimeSpiceChannelSnapshot {
  key: string;
  open: boolean;
  queuedBytes: number;
  readyState: number;
  sentMessages: number;
  sentBytes: number;
  receivedMessages: number;
  receivedBytes: number;
  transport?: 'websocket' | 'shared-memory-websocket';
  sharedMemoryBytes?: number;
  sharedMemoryFallbackBytes?: number;
  sharedMemoryRingSignals?: number;
  sharedMemoryRingWraps?: number;
  ingressBatchFlushes?: number;
  ingressBatchedMessages?: number;
  ingressBatchedBytes?: number;
  ingressBatchConcatBytes?: number;
}

export interface RuntimeSpiceChannel {
  connect(): void;
  send(data: ArrayBuffer | Uint8Array): boolean;
  dispose(): void;
  snapshot(): RuntimeSpiceChannelSnapshot;
}

export interface RuntimeSpiceChannelOptions {
  key: string;
  url: string;
  onOpen?: (key: string) => void;
  onClose?: (key: string) => void;
  onError?: (key: string, message: string) => void;
  onBytes: (
    key: string,
    bytes: Uint8Array,
    backing: ArrayBuffer | SharedArrayBuffer,
  ) => void;
  maxQueuedBytes?: number;
  ingressBatchWindowMs?: number;
  maxIngressBatchBytes?: number;
}
