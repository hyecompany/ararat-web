/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type {
  NativeWasmBinaryImageDecodeJob,
  NativeWasmBitmapDecodeJob,
  NativeWasmLzRgbDecodeJob,
} from '../display/native-display-events.js';

export type NativeWasmDecodeJob = (
  | ({ kind: 'bitmap' } & NativeWasmBitmapDecodeJob)
  | ({ kind: 'lz-rgb' } & NativeWasmLzRgbDecodeJob)
  | ({ kind: 'quic' | 'lz4' } & NativeWasmBinaryImageDecodeJob)
) & {
  videoLike?: boolean;
  coherenceEpoch?: number;
};

export interface NativeWasmDecodedImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

export interface NativeWasmDecodePoolSnapshot {
  size: number;
  readyWorkers: number;
  activeWorkers: number;
  peakActiveWorkers: number;
  queuedTasks: number;
  peakQueuedTasks: number;
  queuedBytes: number;
  peakQueuedBytes: number;
  completedTasks: number;
  staleQueuedDrops: number;
  staleResultDrops: number;
  failedTasks: number;
  workerRestartCount: number;
  laneDepths: Record<string, number>;
  peakLaneDepths: Record<string, number>;
  codecStats: Record<string, { count: number; avgMs: number; maxMs: number }>;
  avgQueueAgeMs: number | null;
}

interface DecodeQueueItem {
  id: number;
  job: NativeWasmDecodeJob;
  enqueuedAtMs: number;
  isStillWanted: () => boolean;
  resolve: (result: NativeWasmDecodedImage) => void;
  reject: (reason?: unknown) => void;
}

interface PendingDecodeItem extends DecodeQueueItem {
  worker: DecodeWorkerState;
  startedAtMs: number;
}

interface DecodeWorkerState {
  id: number;
  worker: Worker;
  ready: boolean;
  busy: boolean;
}

type DecodeWorkerInbound =
  | { type: 'init' }
  | { type: 'dispose' }
  | {
      type: 'decode';
      payload: {
        id: number;
        kind: NativeWasmDecodeJob['kind'];
        bytes: ArrayBuffer;
        width: number;
        height: number;
        stride?: number;
        format?: number;
        flags?: number;
      };
    };

type DecodeWorkerOutbound =
  | { type: 'ready' }
  | {
      type: 'decoded';
      payload: { id: number; rgba: ArrayBuffer; width: number; height: number };
    }
  | { type: 'error'; payload: { id: number; message: string } };

const DEFAULT_HARDWARE_CONCURRENCY = 4;
const MIN_NATIVE_WASM_DECODE_WORKERS = 2;
const MAX_NATIVE_WASM_DECODE_WORKERS = 12;
const MAX_QUEUED_BYTES = 192 * 1024 * 1024;

function cacheBustedWorkerUrl(path: string) {
  const origin =
    typeof globalThis.location?.origin === 'string'
      ? globalThis.location.origin
      : 'http://localhost:3001';
  const workerUrl = new URL(path, origin);
  workerUrl.searchParams.set(
    'v',
    `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  return workerUrl;
}

function detectHardwareConcurrency() {
  if (typeof navigator === 'undefined') {
    return DEFAULT_HARDWARE_CONCURRENCY;
  }
  const value = Number(navigator.hardwareConcurrency ?? DEFAULT_HARDWARE_CONCURRENCY);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_HARDWARE_CONCURRENCY;
  }
  return Math.floor(value);
}

function resolveDefaultWorkerCount() {
  return Math.max(
    MIN_NATIVE_WASM_DECODE_WORKERS,
    Math.min(MAX_NATIVE_WASM_DECODE_WORKERS, detectHardwareConcurrency()),
  );
}

function mapToRecord(map: Map<string, number>) {
  const out: Record<string, number> = {};
  for (const [key, value] of map) {
    out[key] = value;
  }
  return out;
}

export class NativeWasmDecodePool {
  private readonly workers: DecodeWorkerState[] = [];
  private readonly queue: DecodeQueueItem[] = [];
  private readonly pending = new Map<number, PendingDecodeItem>();
  private readonly laneDepths = new Map<string, number>();
  private readonly peakLaneDepths = new Map<string, number>();
  private readonly codecStats = new Map<string, { count: number; totalMs: number; maxMs: number }>();
  private nextId = 1;
  private nextWorkerId = 1;
  private activeWorkers = 0;
  private peakActiveWorkers = 0;
  private queuedBytes = 0;
  private peakQueuedBytes = 0;
  private peakQueuedTasks = 0;
  private completedTasks = 0;
  private staleQueuedDrops = 0;
  private staleResultDrops = 0;
  private failedTasks = 0;
  private workerRestartCount = 0;
  private totalQueueAgeMs = 0;
  private measuredQueueAges = 0;
  private closed = false;

  constructor(size = resolveDefaultWorkerCount()) {
    const workerCount = Math.max(
      MIN_NATIVE_WASM_DECODE_WORKERS,
      Math.min(MAX_NATIVE_WASM_DECODE_WORKERS, Math.floor(size)),
    );
    for (let index = 0; index < workerCount; index += 1) {
      this.spawnWorker();
    }
  }

  decode(job: NativeWasmDecodeJob, isStillWanted: () => boolean) {
    if (this.closed) {
      return Promise.reject(new Error('Native WASM decode pool is closed.'));
    }
    if (!isStillWanted()) {
      this.staleQueuedDrops += 1;
      return Promise.reject(new Error('Native WASM decode job is stale.'));
    }
    if (this.queuedBytes + job.byteCost > MAX_QUEUED_BYTES) {
      this.failedTasks += 1;
      return Promise.reject(new Error('Native WASM decode queue is full.'));
    }
    return new Promise<NativeWasmDecodedImage>((resolve, reject) => {
      const item: DecodeQueueItem = {
        id: this.nextId,
        job,
        enqueuedAtMs: performance.now(),
        isStillWanted,
        resolve,
        reject,
      };
      this.nextId = (this.nextId + 1) % Number.MAX_SAFE_INTEGER || 1;
      this.queue.push(item);
      this.queue.sort((left, right) => left.job.priority - right.job.priority);
      this.queuedBytes += job.byteCost;
      this.peakQueuedBytes = Math.max(this.peakQueuedBytes, this.queuedBytes);
      this.peakQueuedTasks = Math.max(this.peakQueuedTasks, this.queue.length);
      this.bumpLaneDepth(job.lane, 1);
      this.pump();
    });
  }

  snapshot(): NativeWasmDecodePoolSnapshot {
    return {
      size: this.workers.length,
      readyWorkers: this.workers.filter((worker) => worker.ready).length,
      activeWorkers: this.activeWorkers,
      peakActiveWorkers: this.peakActiveWorkers,
      queuedTasks: this.queue.length,
      peakQueuedTasks: this.peakQueuedTasks,
      queuedBytes: this.queuedBytes,
      peakQueuedBytes: this.peakQueuedBytes,
      completedTasks: this.completedTasks,
      staleQueuedDrops: this.staleQueuedDrops,
      staleResultDrops: this.staleResultDrops,
      failedTasks: this.failedTasks,
      workerRestartCount: this.workerRestartCount,
      laneDepths: mapToRecord(this.laneDepths),
      peakLaneDepths: mapToRecord(this.peakLaneDepths),
      codecStats: this.codecStatsSnapshot(),
      avgQueueAgeMs:
        this.measuredQueueAges === 0
          ? null
          : this.totalQueueAgeMs / this.measuredQueueAges,
    };
  }

  cancelWhere(predicate: (job: NativeWasmDecodeJob) => boolean) {
    if (this.closed) {
      return 0;
    }
    let canceled = 0;
    const retained: DecodeQueueItem[] = [];
    for (const item of this.queue) {
      if (predicate(item.job)) {
        this.queuedBytes = Math.max(0, this.queuedBytes - item.job.byteCost);
        this.bumpLaneDepth(item.job.lane, -1);
        this.staleQueuedDrops += 1;
        canceled += 1;
        item.reject(new Error('Native WASM decode job was canceled.'));
        continue;
      }
      retained.push(item);
    }
    this.queue.length = 0;
    this.queue.push(...retained);

    const workersToRestart = new Set<DecodeWorkerState>();
    for (const [id, item] of Array.from(this.pending.entries())) {
      if (!predicate(item.job)) {
        continue;
      }
      this.pending.delete(id);
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      this.staleResultDrops += 1;
      canceled += 1;
      item.reject(new Error('Native WASM decode job was canceled.'));
      workersToRestart.add(item.worker);
    }
    for (const worker of workersToRestart) {
      this.restartWorker(worker);
    }
    if (canceled > 0) {
      this.pump();
    }
    return canceled;
  }

  dispose() {
    this.closed = true;
    for (const worker of this.workers) {
      worker.worker.postMessage({ type: 'dispose' } satisfies DecodeWorkerInbound);
      worker.worker.terminate();
    }
    this.workers.length = 0;
    for (const item of this.queue) {
      item.reject(new Error('Native WASM decode pool was disposed.'));
    }
    this.queue.length = 0;
    this.queuedBytes = 0;
    for (const item of this.pending.values()) {
      item.reject(new Error('Native WASM decode pool was disposed.'));
    }
    this.pending.clear();
    this.laneDepths.clear();
  }

  private spawnWorker() {
    if (this.closed) {
      return;
    }
    const workerUrl = cacheBustedWorkerUrl(
      '/ui/spice-client/decode/native-wasm-decode.worker.js',
    );
    const state: DecodeWorkerState = {
      id: this.nextWorkerId,
      worker: new Worker(workerUrl, {
        name: `spice-native-wasm-decode-${this.nextWorkerId}`,
        type: 'module',
      }),
      ready: false,
      busy: false,
    };
    this.nextWorkerId += 1;
    state.worker.onmessage = (event: MessageEvent<DecodeWorkerOutbound>) => {
      this.handleWorkerMessage(state, event.data);
    };
    state.worker.onerror = (event) => {
      this.handleWorkerFailure(
        state,
        new Error(event.message || 'Native WASM decode worker failed.'),
      );
    };
    state.worker.onmessageerror = () => {
      this.handleWorkerFailure(
        state,
        new Error('Native WASM decode worker posted an unreadable message.'),
      );
    };
    state.worker.postMessage({ type: 'init' } satisfies DecodeWorkerInbound);
    this.workers.push(state);
  }

  private handleWorkerMessage(worker: DecodeWorkerState, message: DecodeWorkerOutbound) {
    if (this.closed) {
      return;
    }
    if (message.type === 'ready') {
      worker.ready = true;
      worker.busy = false;
      this.pump();
      return;
    }

    const item = this.pending.get(message.payload.id);
    if (!item) {
      return;
    }
    this.pending.delete(message.payload.id);
    worker.busy = false;
    this.activeWorkers = Math.max(0, this.activeWorkers - 1);
    if (message.type === 'error') {
      this.failedTasks += 1;
      item.reject(new Error(message.payload.message));
      this.pump();
      return;
    }

    this.recordCodecDuration(item.job.kind, performance.now() - item.startedAtMs);
    if (!item.isStillWanted()) {
      this.staleResultDrops += 1;
      item.reject(new Error('Native WASM decode result is stale.'));
      this.pump();
      return;
    }
    this.completedTasks += 1;
    item.resolve({
      rgba: new Uint8Array(message.payload.rgba),
      width: message.payload.width,
      height: message.payload.height,
    });
    this.pump();
  }

  private handleWorkerFailure(worker: DecodeWorkerState, error: Error) {
    if (this.closed) {
      return;
    }
    this.removeWorker(worker);
    for (const [id, item] of Array.from(this.pending.entries())) {
      if (item.worker !== worker) {
        continue;
      }
      this.pending.delete(id);
      this.activeWorkers = Math.max(0, this.activeWorkers - 1);
      item.reject(error);
    }
    this.workerRestartCount += 1;
    this.spawnWorker();
    this.pump();
  }

  private restartWorker(worker: DecodeWorkerState) {
    if (this.closed) {
      return;
    }
    this.removeWorker(worker);
    this.workerRestartCount += 1;
    this.spawnWorker();
  }

  private removeWorker(worker: DecodeWorkerState) {
    const index = this.workers.indexOf(worker);
    if (index >= 0) {
      this.workers.splice(index, 1);
    }
    worker.worker.terminate();
  }

  private pump() {
    if (this.closed) {
      return;
    }
    for (const worker of this.workers) {
      if (!worker.ready || worker.busy) {
        continue;
      }
      const item = this.nextQueuedItem();
      if (!item) {
        return;
      }
      if (!item.isStillWanted()) {
        this.staleQueuedDrops += 1;
        item.reject(new Error('Native WASM decode job is stale.'));
        continue;
      }
      const queueAge = performance.now() - item.enqueuedAtMs;
      this.totalQueueAgeMs += queueAge;
      this.measuredQueueAges += 1;
      worker.busy = true;
      this.activeWorkers += 1;
      this.peakActiveWorkers = Math.max(this.peakActiveWorkers, this.activeWorkers);
      this.pending.set(item.id, {
        ...item,
        worker,
        startedAtMs: performance.now(),
      });
      const bytes = transferableBytes(item.job.bytes);
      worker.worker.postMessage(
        {
          type: 'decode',
          payload: requestForJob(item.id, item.job, bytes),
        } satisfies DecodeWorkerInbound,
        [bytes],
      );
    }
  }

  private nextQueuedItem() {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.queuedBytes = Math.max(0, this.queuedBytes - item.job.byteCost);
      this.bumpLaneDepth(item.job.lane, -1);
      if (item.isStillWanted()) {
        return item;
      }
      this.staleQueuedDrops += 1;
      item.reject(new Error('Native WASM decode job is stale.'));
    }
    return null;
  }

  private bumpLaneDepth(lane: string, delta: number) {
    const next = Math.max(0, (this.laneDepths.get(lane) ?? 0) + delta);
    if (next === 0) {
      this.laneDepths.delete(lane);
    } else {
      this.laneDepths.set(lane, next);
    }
    this.peakLaneDepths.set(lane, Math.max(this.peakLaneDepths.get(lane) ?? 0, next));
  }

  private recordCodecDuration(kind: string, durationMs: number) {
    const current = this.codecStats.get(kind) ?? { count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += durationMs;
    current.maxMs = Math.max(current.maxMs, durationMs);
    this.codecStats.set(kind, current);
  }

  private codecStatsSnapshot() {
    const out: Record<string, { count: number; avgMs: number; maxMs: number }> = {};
    for (const [kind, value] of this.codecStats) {
      out[kind] = {
        count: value.count,
        avgMs: value.count === 0 ? 0 : value.totalMs / value.count,
        maxMs: value.maxMs,
      };
    }
    return out;
  }
}

function requestForJob(id: number, job: NativeWasmDecodeJob, bytes: ArrayBuffer) {
  return {
    id,
    kind: job.kind,
    bytes,
    width: job.width,
    height: job.height,
    stride: job.kind === 'bitmap' ? job.stride : undefined,
    format: job.kind === 'bitmap' ? job.format : undefined,
    flags: job.kind === 'bitmap' ? job.flags : undefined,
  };
}

function transferableBytes(bytes: Uint8Array) {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
