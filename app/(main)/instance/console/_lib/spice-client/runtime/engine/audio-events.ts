/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type {
  SessionWorkerOutbound,
  SpiceWorkerDiagnostics,
} from '../messages.js';

type WorkerPost = (message: SessionWorkerOutbound, transfer?: Transferable[]) => void;

export class BrowserSpiceAudioEvents {
  private channels = 0;
  private sampleRate = 0;
  private format = 0;
  private mode = 1;

  constructor(private readonly post: WorkerPost) {}

  apply(event: unknown, diagnostics: SpiceWorkerDiagnostics | null) {
    if (!event || typeof event !== 'object' || !diagnostics) {
      return;
    }

    const record = event as Record<string, unknown>;
    switch (record.type) {
      case 'start':
        this.applyStart(record, diagnostics);
        break;
      case 'mode':
        this.applyMode(record, diagnostics);
        break;
      case 'data':
        this.applyData(record, diagnostics);
        break;
      case 'volume':
        this.applyVolume(record, diagnostics);
        break;
      case 'mute':
        diagnostics.audio.muted = positiveNumber(record.mute) !== 0;
        this.post({ type: 'audio_control', payload: { muted: diagnostics.audio.muted } });
        break;
      case 'latency':
        diagnostics.audio.latencyMs = positiveNumber(record.latencyMs);
        this.post({ type: 'audio_control', payload: { latencyMs: diagnostics.audio.latencyMs } });
        break;
      case 'stop':
        diagnostics.audio.channelOpen = false;
        this.post({ type: 'audio_stop' });
        break;
    }
  }

  private applyStart(record: Record<string, unknown>, diagnostics: SpiceWorkerDiagnostics) {
    this.channels = positiveNumber(record.channels);
    this.sampleRate = positiveNumber(record.frequency);
    this.format = positiveNumber(record.format);
    diagnostics.audio.channels = this.channels;
    diagnostics.audio.sampleRate = this.sampleRate;
    diagnostics.audio.mode = this.mode;
    diagnostics.audio.multimediaTime = positiveNumber(record.time);
    diagnostics.audio.channelAttempted = true;
    diagnostics.audio.channelOpen = true;
  }

  private applyMode(record: Record<string, unknown>, diagnostics: SpiceWorkerDiagnostics) {
    this.mode = positiveNumber(record.mode);
    diagnostics.audio.mode = this.mode;
    if (this.mode !== 1) {
      diagnostics.audio.unsupportedMode = String(this.mode);
    }
  }

  private applyData(record: Record<string, unknown>, diagnostics: SpiceWorkerDiagnostics) {
    const data = bytesFromNativeValue(record.data);
    if (
      !data ||
      this.format !== 1 ||
      this.mode !== 1 ||
      this.channels <= 0 ||
      this.sampleRate <= 0
    ) {
      if (this.mode !== 1) {
        diagnostics.audio.unsupportedMode = String(this.mode);
      }
      return;
    }

    const pcm = arrayBufferFromBytes(data);
    const multimediaTime = positiveNumber(record.time);
    diagnostics.audio.chunkCount += 1;
    diagnostics.audio.multimediaTime = multimediaTime;
    this.post(
      {
        type: 'audio',
        payload: {
          pcm,
          channels: this.channels,
          sampleRate: this.sampleRate,
          mode: this.mode,
          multimediaTime,
        },
      },
      [pcm],
    );
  }

  private applyVolume(record: Record<string, unknown>, diagnostics: SpiceWorkerDiagnostics) {
    if (!Array.isArray(record.volumes)) {
      return;
    }
    diagnostics.audio.volume = record.volumes.filter(
      (value): value is number => typeof value === 'number',
    );
    this.post({ type: 'audio_control', payload: { volume: diagnostics.audio.volume } });
  }
}

function bytesFromNativeValue(value: unknown): Uint8Array | ArrayBuffer | null {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return value;
  }
  if (Array.isArray(value) && value.every((entry) => Number.isInteger(entry))) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function arrayBufferFromBytes(data: Uint8Array | ArrayBuffer) {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}
