/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export interface DisplayWorkItem {
  lane: string;
  commitToken: bigint;
  byteLength: number;
  isCurrent: () => boolean;
  execute: () => void | Promise<void>;
  onStale?: () => void;
}

export interface DisplayWorkQueueSnapshot {
  activeTasks: number;
  peakActiveTasks: number;
  queuedTasks: number;
  peakQueuedTasks: number;
  queuedBytes: number;
  peakQueuedBytes: number;
  completedTasks: number;
  staleQueuedDrops: number;
  avgQueueAgeMs: number | null;
  laneDepths: Record<string, number>;
  peakLaneDepths: Record<string, number>;
}

interface QueuedDisplayWorkItem extends DisplayWorkItem {
  enqueuedAtMs: number;
}

export class DisplayWorkQueue {
  private static readonly syncPumpBudgetMs = 6;
  private readonly queue: QueuedDisplayWorkItem[] = [];
  private readonly laneDepths = new Map<string, number>();
  private readonly peakLaneDepths = new Map<string, number>();
  private readonly maxConcurrent: number;
  private activeTasks = 0;
  private peakActiveTasks = 0;
  private queuedBytes = 0;
  private peakQueuedBytes = 0;
  private peakQueuedTasks = 0;
  private completedTasks = 0;
  private staleQueuedDrops = 0;
  private totalQueueAgeMs = 0;
  private measuredQueueAges = 0;
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly options: { maxConcurrent: number; onProgress?: () => void },
  ) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
  }

  enqueue(item: DisplayWorkItem) {
    if (this.disposed) {
      return;
    }
    if (!item.isCurrent()) {
      this.staleQueuedDrops += 1;
      item.onStale?.();
      this.options.onProgress?.();
      return;
    }
    const queued: QueuedDisplayWorkItem = {
      ...item,
      byteLength: Math.max(0, Math.floor(item.byteLength)),
      enqueuedAtMs: performance.now(),
    };
    this.queue.push(queued);
    this.queuedBytes += queued.byteLength;
    this.peakQueuedBytes = Math.max(this.peakQueuedBytes, this.queuedBytes);
    this.peakQueuedTasks = Math.max(this.peakQueuedTasks, this.queue.length);
    this.bumpLaneDepth(queued.lane, 1);
    this.schedule();
  }

  snapshot(): DisplayWorkQueueSnapshot {
    return {
      activeTasks: this.activeTasks,
      peakActiveTasks: this.peakActiveTasks,
      queuedTasks: this.queue.length,
      peakQueuedTasks: this.peakQueuedTasks,
      queuedBytes: this.queuedBytes,
      peakQueuedBytes: this.peakQueuedBytes,
      completedTasks: this.completedTasks,
      staleQueuedDrops: this.staleQueuedDrops,
      avgQueueAgeMs:
        this.measuredQueueAges === 0
          ? null
          : this.totalQueueAgeMs / this.measuredQueueAges,
      laneDepths: mapToRecord(this.laneDepths),
      peakLaneDepths: mapToRecord(this.peakLaneDepths),
    };
  }

  dispose() {
    this.disposed = true;
    if (this.scheduled !== null) {
      clearTimeout(this.scheduled);
      this.scheduled = null;
    }
    this.queue.length = 0;
    this.laneDepths.clear();
    this.queuedBytes = 0;
  }

  private schedule() {
    if (this.scheduled !== null || this.disposed) {
      return;
    }
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      this.pump();
    }, 0);
  }

  private pump() {
    if (this.disposed) {
      return;
    }

    const pumpStartedAt = performance.now();
    while (this.activeTasks < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) {
        break;
      }
      this.queuedBytes = Math.max(0, this.queuedBytes - item.byteLength);
      this.bumpLaneDepth(item.lane, -1);

      if (!item.isCurrent()) {
        this.staleQueuedDrops += 1;
        item.onStale?.();
        this.options.onProgress?.();
        continue;
      }

      const queueAge = performance.now() - item.enqueuedAtMs;
      this.totalQueueAgeMs += queueAge;
      this.measuredQueueAges += 1;
      this.activeTasks += 1;
      this.peakActiveTasks = Math.max(this.peakActiveTasks, this.activeTasks);

      try {
        const result = item.execute();
        if (result && typeof (result as Promise<void>).finally === 'function') {
          void (result as Promise<void>).finally(() => this.finishTask());
        } else {
          this.finishTask();
          if (performance.now() - pumpStartedAt >= DisplayWorkQueue.syncPumpBudgetMs) {
            break;
          }
        }
      } catch (_error) {
        this.finishTask();
        if (performance.now() - pumpStartedAt >= DisplayWorkQueue.syncPumpBudgetMs) {
          break;
        }
      }
    }

    if (this.queue.length > 0 && this.activeTasks < this.maxConcurrent) {
      this.schedule();
    }
  }

  private finishTask() {
    this.activeTasks = Math.max(0, this.activeTasks - 1);
    this.completedTasks += 1;
    this.options.onProgress?.();
    if (this.queue.length > 0) {
      this.schedule();
    }
  }

  private bumpLaneDepth(lane: string, delta: number) {
    const next = Math.max(0, (this.laneDepths.get(lane) ?? 0) + delta);
    if (next === 0) {
      this.laneDepths.delete(lane);
    } else {
      this.laneDepths.set(lane, next);
    }
    this.peakLaneDepths.set(
      lane,
      Math.max(this.peakLaneDepths.get(lane) ?? 0, next),
    );
  }
}

function mapToRecord(map: Map<string, number>) {
  const record: Record<string, number> = {};
  for (const [key, value] of map) {
    record[key] = value;
  }
  return record;
}
