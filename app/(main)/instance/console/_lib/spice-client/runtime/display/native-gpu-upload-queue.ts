/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export interface NativeGpuUploadQueueSnapshot {
  activeTasks: number;
  peakActiveTasks: number;
  queuedTasks: number;
  peakQueuedTasks: number;
  queuedBytes: number;
  peakQueuedBytes: number;
  completedTasks: number;
  staleQueuedDrops: number;
  staleResultDrops: number;
  failedTasks: number;
  avgQueueAgeMs: number | null;
  laneDepths: Record<string, number>;
  peakLaneDepths: Record<string, number>;
}

export interface NativeGpuUploadQueueItem {
  lane: string;
  priority: number;
  byteCost: number;
  videoLike: boolean;
  coherenceEpoch: number;
  isStillWanted: () => boolean;
  run: () => boolean | Promise<boolean>;
  onCommitted?: () => void;
  onStale?: () => void;
  onFailure?: () => void;
}

interface QueuedNativeGpuUpload extends NativeGpuUploadQueueItem {
  id: number;
  enqueuedAtMs: number;
}

const DEFAULT_MAX_QUEUED_BYTES = 192 * 1024 * 1024;

export class NativeGpuUploadQueue {
  private static readonly syncPumpBudgetMs = 6;
  private static readonly maxSyncItemsPerPump = 96;
  private readonly queue: QueuedNativeGpuUpload[] = [];
  private readonly laneDepths = new Map<string, number>();
  private readonly peakLaneDepths = new Map<string, number>();
  private nextId = 1;
  private activeTasks = 0;
  private peakActiveTasks = 0;
  private queuedBytes = 0;
  private peakQueuedBytes = 0;
  private peakQueuedTasks = 0;
  private completedTasks = 0;
  private staleQueuedDrops = 0;
  private staleResultDrops = 0;
  private failedTasks = 0;
  private totalQueueAgeMs = 0;
  private measuredQueueAges = 0;
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly options: {
      maxQueuedBytes?: number;
      onProgress?: () => void;
    } = {},
  ) {}

  enqueue(item: NativeGpuUploadQueueItem) {
    if (this.disposed) {
      return false;
    }
    if (!item.isStillWanted()) {
      this.staleQueuedDrops += 1;
      item.onStale?.();
      this.options.onProgress?.();
      return false;
    }
    const queued: QueuedNativeGpuUpload = {
      ...item,
      id: this.nextId,
      byteCost: Math.max(0, Math.floor(item.byteCost)),
      priority: Math.max(0, Math.floor(item.priority)),
      enqueuedAtMs: performance.now(),
    };
    this.nextId = (this.nextId + 1) % Number.MAX_SAFE_INTEGER || 1;
    if (!this.makeRoomFor(queued)) {
      this.failedTasks += 1;
      queued.onFailure?.();
      this.options.onProgress?.();
      return false;
    }
    this.queue.push(queued);
    this.queue.sort(compareQueuedUploads);
    this.queuedBytes += queued.byteCost;
    this.peakQueuedBytes = Math.max(this.peakQueuedBytes, this.queuedBytes);
    this.peakQueuedTasks = Math.max(this.peakQueuedTasks, this.queue.length);
    this.bumpLaneDepth(queued.lane, 1);
    this.schedule();
    return true;
  }

  dropVideoLikeBefore(coherenceEpoch: number) {
    let dropped = 0;
    const retained: QueuedNativeGpuUpload[] = [];
    for (const item of this.queue) {
      if (item.videoLike && item.coherenceEpoch < coherenceEpoch) {
        this.queuedBytes = Math.max(0, this.queuedBytes - item.byteCost);
        this.bumpLaneDepth(item.lane, -1);
        this.staleQueuedDrops += 1;
        dropped += 1;
        item.onStale?.();
        continue;
      }
      retained.push(item);
    }
    if (dropped > 0) {
      this.queue.length = 0;
      this.queue.push(...retained);
      this.options.onProgress?.();
    }
    return dropped;
  }

  snapshot(): NativeGpuUploadQueueSnapshot {
    return {
      activeTasks: this.activeTasks,
      peakActiveTasks: this.peakActiveTasks,
      queuedTasks: this.queue.length,
      peakQueuedTasks: this.peakQueuedTasks,
      queuedBytes: this.queuedBytes,
      peakQueuedBytes: this.peakQueuedBytes,
      completedTasks: this.completedTasks,
      staleQueuedDrops: this.staleQueuedDrops,
      staleResultDrops: this.staleResultDrops,
      failedTasks: this.failedTasks,
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
    for (const item of this.queue) {
      item.onStale?.();
    }
    this.queue.length = 0;
    this.laneDepths.clear();
    this.queuedBytes = 0;
  }

  private makeRoomFor(next: QueuedNativeGpuUpload) {
    const maxQueuedBytes = this.options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
    if (next.byteCost > maxQueuedBytes) {
      return false;
    }
    if (this.queuedBytes + next.byteCost <= maxQueuedBytes) {
      return true;
    }
    if (next.videoLike) {
      this.dropVideoLikeBefore(next.coherenceEpoch);
    }
    while (this.queuedBytes + next.byteCost > maxQueuedBytes) {
      let dropIndex = -1;
      for (let index = this.queue.length - 1; index >= 0; index -= 1) {
        if (this.queue[index].videoLike) {
          dropIndex = index;
          break;
        }
      }
      if (dropIndex < 0) {
        break;
      }
      const [dropped] = this.queue.splice(dropIndex, 1);
      this.queuedBytes = Math.max(0, this.queuedBytes - dropped.byteCost);
      this.bumpLaneDepth(dropped.lane, -1);
      this.staleQueuedDrops += 1;
      dropped.onStale?.();
    }
    return this.queuedBytes + next.byteCost <= maxQueuedBytes;
  }

  private schedule() {
    if (this.disposed || this.scheduled !== null) {
      return;
    }
    this.scheduled = setTimeout(() => {
      this.scheduled = null;
      this.pump();
    }, 0);
  }

  private pump() {
    if (this.disposed || this.activeTasks > 0) {
      return;
    }

    const pumpStartedAt = performance.now();
    let syncItems = 0;
    while (!this.disposed && this.activeTasks === 0 && this.queue.length > 0) {
      const item = this.nextQueuedItem();
      if (!item) {
        break;
      }
      const queueAge = performance.now() - item.enqueuedAtMs;
      this.totalQueueAgeMs += queueAge;
      this.measuredQueueAges += 1;
      this.activeTasks = 1;
      this.peakActiveTasks = Math.max(this.peakActiveTasks, this.activeTasks);
      try {
        const result = item.run();
        if (result && typeof (result as Promise<boolean>).then === 'function') {
          void (result as Promise<boolean>)
            .then((committed) => this.completeItem(item, committed))
            .catch(() => this.failItem(item));
          return;
        }
        this.completeItem(item, result === true, false);
      } catch {
        this.failItem(item, false);
      }
      syncItems += 1;
      if (
        syncItems >= NativeGpuUploadQueue.maxSyncItemsPerPump ||
        performance.now() - pumpStartedAt >= NativeGpuUploadQueue.syncPumpBudgetMs
      ) {
        break;
      }
    }

    if (this.queue.length > 0 && this.activeTasks === 0) {
      this.schedule();
    }
  }

  private nextQueuedItem() {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.queuedBytes = Math.max(0, this.queuedBytes - item.byteCost);
      this.bumpLaneDepth(item.lane, -1);
      if (item.isStillWanted()) {
        return item;
      }
      this.staleQueuedDrops += 1;
      item.onStale?.();
    }
    return null;
  }

  private completeItem(
    item: QueuedNativeGpuUpload,
    committed: boolean,
    reschedule = true,
  ) {
    this.activeTasks = 0;
    if (committed) {
      this.completedTasks += 1;
      item.onCommitted?.();
    } else {
      this.staleResultDrops += 1;
      item.onStale?.();
    }
    this.options.onProgress?.();
    if (reschedule && this.queue.length > 0) {
      this.schedule();
    }
  }

  private failItem(item: QueuedNativeGpuUpload, reschedule = true) {
    this.activeTasks = 0;
    this.failedTasks += 1;
    item.onFailure?.();
    this.options.onProgress?.();
    if (reschedule && this.queue.length > 0) {
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

function compareQueuedUploads(left: QueuedNativeGpuUpload, right: QueuedNativeGpuUpload) {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }
  if (left.videoLike && right.videoLike && left.coherenceEpoch !== right.coherenceEpoch) {
    return right.coherenceEpoch - left.coherenceEpoch;
  }
  return left.id - right.id;
}

function mapToRecord(map: Map<string, number>) {
  const record: Record<string, number> = {};
  for (const [key, value] of map) {
    record[key] = value;
  }
  return record;
}
