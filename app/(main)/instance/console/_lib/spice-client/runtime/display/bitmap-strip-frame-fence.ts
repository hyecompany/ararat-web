/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { SpiceWorkerDiagnostics } from '../messages.js';
import type { ConsoleRenderer } from '../render/webgpu-adapter.js';
import type { NativeDisplayEvent, NativeDrawEvent } from './native-display-events.js';

export class BitmapStripFrameFence {
  private active = false;
  private lastRight = 0;
  private lastBottom = 0;
  private lastAtMs = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private nativeRunActive = false;

  constructor(
    private readonly renderer: () => ConsoleRenderer | null,
    private readonly diagnostics: () => SpiceWorkerDiagnostics | null,
    private readonly queueBusy: () => boolean,
  ) {}

  observeDraw(event: NativeDisplayEvent) {
    const nativeHint = nativeBitmapStripHint(event);
    if (nativeHint) {
      this.observeNativeHint(nativeHint);
      return;
    }
    if (!isBitmapPutStrip(event)) {
      this.end();
      return;
    }
    const bbox = event.bbox;
    const now = performance.now();
    const startsNewRun =
      !this.active ||
      bbox.left !== this.lastRight ||
      Math.abs(bbox.bottom - this.lastBottom) > 4 ||
      now - this.lastAtMs > 24;
    if (startsNewRun && this.active) {
      this.flush('boundary');
    }
    if (startsNewRun) {
      this.begin();
    }
    this.lastRight = bbox.right;
    this.lastBottom = bbox.bottom;
    this.lastAtMs = now;
    this.armFlush();
  }

  private observeNativeHint(hint: {
    runId: number;
    startsRun: boolean;
    closesPreviousRun: boolean;
    itemCount?: number;
  }) {
    if (hint.closesPreviousRun && this.active) {
      this.flush('boundary');
    }
    if (hint.startsRun || !this.active) {
      this.begin();
    }
    this.nativeRunActive = true;
    this.lastRight = hint.runId;
    this.lastBottom = 0;
    this.lastAtMs = performance.now();
    const diagnostics = this.diagnostics();
    if (diagnostics && hint.itemCount !== undefined) {
      diagnostics.performance.qxlBandItems = hint.itemCount;
      diagnostics.performance.qxlBandMaxSize = Math.max(
        diagnostics.performance.qxlBandMaxSize,
        hint.itemCount,
      );
    }
  }

  completeIfIdle() {
    if (!this.active || this.queueBusy()) {
      return;
    }
    if (this.nativeRunActive) {
      return;
    }
    const elapsedMs = performance.now() - this.lastAtMs;
    if (elapsedMs < 4) {
      this.armFlush();
      return;
    }
    this.flush('idle');
  }

  dispose() {
    this.clearTimer();
    this.active = false;
    this.nativeRunActive = false;
  }

  private begin() {
    this.active = true;
    this.renderer()?.setCanvasPresentationSuspended(true);
    const diagnostics = this.diagnostics();
    if (diagnostics) {
      diagnostics.performance.qxlBandMode = 'qxl-bitmap-video';
      diagnostics.performance.qxlBandActive = true;
      diagnostics.performance.qxlBandsStarted += 1;
    }
  }

  private end() {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.nativeRunActive = false;
    this.clearTimer();
    this.renderer()?.setCanvasPresentationSuspended(false);
    const diagnostics = this.diagnostics();
    if (diagnostics) {
      diagnostics.performance.qxlBandActive = false;
      diagnostics.performance.qxlBandsFlushed += 1;
      diagnostics.performance.qxlBandFlushReasons.nonStrip =
        (diagnostics.performance.qxlBandFlushReasons.nonStrip ?? 0) + 1;
    }
  }

  private armFlush() {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush('timeout');
    }, 48);
  }

  private flush(reason: 'idle' | 'timeout' | 'boundary') {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.nativeRunActive = false;
    this.clearTimer();
    this.renderer()?.setCanvasPresentationSuspended(false);
    const diagnostics = this.diagnostics();
    if (diagnostics) {
      diagnostics.performance.qxlBandActive = false;
      diagnostics.performance.qxlBandsFlushed += 1;
      diagnostics.performance.qxlBandFlushReasons[reason] =
        (diagnostics.performance.qxlBandFlushReasons[reason] ?? 0) + 1;
    }
  }

  private clearTimer() {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

function nativeBitmapStripHint(event: NativeDisplayEvent) {
  if (event.type !== 'draw' || event.frameHint?.kind !== 'bitmapStrip') {
    return null;
  }
  return {
    runId: event.frameHint.runId,
    startsRun: event.frameHint.startsRun,
    closesPreviousRun: event.frameHint.closesPreviousRun,
    itemCount: event.frameHint.itemCount,
  };
}

function isBitmapPutStrip(event: NativeDisplayEvent): event is NativeDrawEvent {
  if (event.type !== 'draw') {
    return false;
  }
  const width = event.bbox.right - event.bbox.left;
  const height = event.bbox.bottom - event.bbox.top;
  const payload = event.image?.payload;
  const descriptor = event.image?.descriptor;
  return (
    event.kind === 'copy' &&
    event.ropDescriptor === 8 &&
    payload?.kind === 'bitmap' &&
    payload.format === 8 &&
    typeof descriptor?.width === 'number' &&
    typeof descriptor.height === 'number' &&
    width > 0 &&
    width <= 64 &&
    height >= 96 &&
    descriptor.width <= 64 &&
    descriptor.height >= 96
  );
}
