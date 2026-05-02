/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { NativeBrowserImageDecodeJob } from '../display/native-display-events.js';

export interface NativeBrowserImageRunBufferSnapshot {
  activeRunId: number | null;
  bufferedRuns: number;
  bufferedItems: number;
  bufferedDecodedBytes: number;
  flushedRuns: number;
  droppedRuns: number;
  staleRuns: number;
}

export interface NativeBrowserImageRunBufferOptions {
  minQuietMs: number;
  maxRunMs: number;
  maxBufferedDecodedBytes: number;
  closeOutput: (output: ImageBitmap) => void;
  checkToken: (job: NativeBrowserImageDecodeJob) => boolean;
  upload: (job: NativeBrowserImageDecodeJob, output: ImageBitmap) => boolean;
  present: () => void;
  onDrop?: (reason: string, itemCount: number) => void;
  onStale?: (itemCount: number) => void;
  onFlush?: (itemCount: number) => void;
}

interface BufferedImage {
  job: NativeBrowserImageDecodeJob;
  output: ImageBitmap;
  decodedBytes: number;
}

interface BufferedRun {
  id: number;
  seenItems: number;
  decodedItems: BufferedImage[];
  decodedBytes: number;
  startedAt: number;
  lastSeenAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  deadlineTimer: ReturnType<typeof setTimeout> | null;
}

export class NativeBrowserImageRunBuffer {
  private readonly runs = new Map<number, BufferedRun>();
  private activeRunId: number | null = null;
  private flushedRuns = 0;
  private droppedRuns = 0;
  private staleRuns = 0;

  constructor(private readonly options: NativeBrowserImageRunBufferOptions) {}

  beginRun(runId: number, options: { flushActiveIfComplete?: boolean } = {}) {
    if (this.activeRunId !== null && this.activeRunId !== runId) {
      const active = this.runs.get(this.activeRunId);
      if (
        options.flushActiveIfComplete &&
        active &&
        this.flushRunIfComplete(active, 'boundary')
      ) {
        this.activeRunId = null;
      }
      this.dropRunsExcept(runId, 'superseded-run');
    }
    this.activeRunId = runId;
    this.ensureRun(runId);
  }

  finishActiveRun() {
    if (this.activeRunId === null) {
      return;
    }
    const run = this.runs.get(this.activeRunId);
    if (!run) {
      this.activeRunId = null;
      return;
    }
    if (!this.flushRunIfComplete(run, 'finish')) {
      this.dropBufferedRun(run, 'incomplete-finish');
    }
  }

  expectItem(runId: number) {
    this.beginRun(runId);
    const run = this.ensureRun(runId);
    run.seenItems += 1;
    run.lastSeenAt = performance.now();
    this.armTimers(run);
  }

  dropRun(runId: number, reason = 'dropped') {
    const run = this.runs.get(runId);
    if (!run) {
      return;
    }
    this.dropBufferedRun(run, reason);
  }

  addDecoded(runId: number, job: NativeBrowserImageDecodeJob, output: ImageBitmap) {
    const run = this.runs.get(runId);
    if (!run || this.activeRunId !== runId) {
      this.options.closeOutput(output);
      this.droppedRuns += 1;
      this.options.onDrop?.('inactive-run-output', 1);
      return false;
    }
    const decodedBytes = decodedByteEstimate(job);
    if (this.snapshot().bufferedDecodedBytes + decodedBytes > this.options.maxBufferedDecodedBytes) {
      this.options.closeOutput(output);
      this.dropBufferedRun(run, 'decoded-buffer-pressure');
      return false;
    }
    run.decodedItems.push({ job, output, decodedBytes });
    run.decodedBytes += decodedBytes;
    this.maybeFlush(run, 'decode');
    return true;
  }

  noteItemCanceled(runId: number | undefined) {
    if (runId === undefined) {
      return;
    }
    this.dropRun(runId, 'missing-strip');
  }

  dispose() {
    for (const run of this.runs.values()) {
      this.dropBufferedRun(run, 'dispose');
    }
    this.runs.clear();
    this.activeRunId = null;
  }

  snapshot(): NativeBrowserImageRunBufferSnapshot {
    let bufferedItems = 0;
    let bufferedDecodedBytes = 0;
    for (const run of this.runs.values()) {
      bufferedItems += run.decodedItems.length;
      bufferedDecodedBytes += run.decodedBytes;
    }
    return {
      activeRunId: this.activeRunId,
      bufferedRuns: this.runs.size,
      bufferedItems,
      bufferedDecodedBytes,
      flushedRuns: this.flushedRuns,
      droppedRuns: this.droppedRuns,
      staleRuns: this.staleRuns,
    };
  }

  private ensureRun(runId: number) {
    let run = this.runs.get(runId);
    if (run) {
      return run;
    }
    const now = performance.now();
    run = {
      id: runId,
      seenItems: 0,
      decodedItems: [],
      decodedBytes: 0,
      startedAt: now,
      lastSeenAt: now,
      idleTimer: null,
      deadlineTimer: null,
    };
    this.runs.set(runId, run);
    this.armTimers(run);
    return run;
  }

  private armTimers(run: BufferedRun) {
    if (run.id !== this.activeRunId) {
      return;
    }
    if (run.idleTimer !== null) {
      clearTimeout(run.idleTimer);
    }
    run.idleTimer = setTimeout(() => {
      run.idleTimer = null;
      this.maybeFlush(run, 'idle');
    }, this.options.minQuietMs);
    if (run.deadlineTimer === null) {
      run.deadlineTimer = setTimeout(() => {
        run.deadlineTimer = null;
        this.maybeFlush(run, 'deadline');
      }, this.options.maxRunMs);
    }
  }

  private maybeFlush(run: BufferedRun, reason: 'decode' | 'idle' | 'deadline') {
    if (run.id !== this.activeRunId || !this.runs.has(run.id)) {
      return;
    }
    if (run.seenItems === 0 || run.decodedItems.length !== run.seenItems) {
      if (reason === 'deadline') {
        this.dropBufferedRun(run, 'incomplete-deadline');
      }
      return;
    }
    const quietMs = performance.now() - run.lastSeenAt;
    if (quietMs < this.options.minQuietMs && reason !== 'deadline') {
      this.armTimers(run);
      return;
    }
    this.flushRun(run);
  }

  private flushRunIfComplete(run: BufferedRun, _reason: 'boundary' | 'finish') {
    if (run.seenItems === 0 || run.decodedItems.length !== run.seenItems) {
      return false;
    }
    this.flushRun(run);
    return true;
  }

  private flushRun(run: BufferedRun) {
    const items = run.decodedItems;
    if (items.length === 0) {
      this.dropBufferedRun(run, 'empty-run');
      return;
    }
    for (const item of items) {
      if (!this.options.checkToken(item.job)) {
        this.staleRuns += 1;
        this.options.onStale?.(items.length);
        this.dropBufferedRun(run, 'stale-token');
        return;
      }
    }
    let committed = 0;
    for (const item of items) {
      if (!this.options.upload(item.job, item.output)) {
        this.staleRuns += 1;
        this.options.onStale?.(items.length - committed);
        this.dropBufferedRun(run, 'commit-rejected');
        return;
      }
      committed += 1;
    }
    this.clearTimers(run);
    this.runs.delete(run.id);
    if (this.activeRunId === run.id) {
      this.activeRunId = null;
    }
    for (const item of items) {
      this.options.closeOutput(item.output);
    }
    this.flushedRuns += 1;
    this.options.onFlush?.(items.length);
    this.options.present();
  }

  private dropRunsExcept(runId: number, reason: string) {
    for (const run of Array.from(this.runs.values())) {
      if (run.id !== runId) {
        this.dropBufferedRun(run, reason);
      }
    }
  }

  private dropBufferedRun(run: BufferedRun, reason: string) {
    this.clearTimers(run);
    this.runs.delete(run.id);
    if (this.activeRunId === run.id) {
      this.activeRunId = null;
    }
    for (const item of run.decodedItems) {
      this.options.closeOutput(item.output);
    }
    this.droppedRuns += 1;
    this.options.onDrop?.(reason, run.decodedItems.length);
  }

  private clearTimers(run: BufferedRun) {
    if (run.idleTimer !== null) {
      clearTimeout(run.idleTimer);
      run.idleTimer = null;
    }
    if (run.deadlineTimer !== null) {
      clearTimeout(run.deadlineTimer);
      run.deadlineTimer = null;
    }
  }
}

function decodedByteEstimate(job: NativeBrowserImageDecodeJob) {
  const width = Math.max(0, job.bbox.right - job.bbox.left);
  const height = Math.max(0, job.bbox.bottom - job.bbox.top);
  return width * height * 4;
}
