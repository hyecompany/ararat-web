/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

declare const sampleRate: number;

interface SpiceRecordProcessorOptions {
  processorOptions?: {
    channels?: number;
    targetSampleRate?: number;
    chunkFrames?: number;
  };
}

class SpiceRecordSourceProcessor extends AudioWorkletProcessor {
  private readonly channels: number;
  private readonly targetSampleRate: number;
  private readonly chunkFrames: number;
  private readonly resampleRatio: number;
  private readonly pending: number[] = [];
  private resampleCursor = 0;
  private muted = false;
  private gain = 1;
  private stopped = false;

  constructor(options?: SpiceRecordProcessorOptions) {
    super(options);
    const processorOptions = options?.processorOptions ?? {};
    this.channels = clampInt(processorOptions.channels ?? 2, 1, 2);
    this.targetSampleRate = Math.max(8000, Math.floor(processorOptions.targetSampleRate ?? sampleRate));
    this.chunkFrames = Math.max(1, Math.floor(processorOptions.chunkFrames ?? this.targetSampleRate / 50));
    this.resampleRatio = sampleRate / this.targetSampleRate;
    this.port.onmessage = (event) => this.handleMessage(event.data);
  }

  process(inputs: Float32Array[][]) {
    if (this.stopped) {
      return false;
    }
    const input = inputs[0];
    if (!input || input.length === 0 || input[0]?.length === 0) {
      return true;
    }

    const inputFrames = input[0]!.length;
    while (this.resampleCursor < inputFrames) {
      const base = Math.floor(this.resampleCursor);
      const next = Math.min(inputFrames - 1, base + 1);
      const mix = this.resampleCursor - base;
      for (let channel = 0; channel < this.channels; channel += 1) {
        const source = input[Math.min(channel, input.length - 1)] ?? input[0]!;
        const sample = source[base]! + (source[next]! - source[base]!) * mix;
        this.pending.push(this.muted ? 0 : clampSample(sample * this.gain));
      }
      this.resampleCursor += this.resampleRatio;
    }
    this.resampleCursor -= inputFrames;
    this.flushCompleteChunks();
    return true;
  }

  private handleMessage(message: unknown) {
    if (!message || typeof message !== 'object') {
      return;
    }
    const record = message as Record<string, unknown>;
    if (record.type === 'stop') {
      this.flushRemainder();
      this.stopped = true;
      return;
    }
    if (record.type !== 'control') {
      return;
    }
    if (typeof record.muted === 'boolean') {
      this.muted = record.muted;
    }
    if (Array.isArray(record.volume) && record.volume.length > 0) {
      const average =
        record.volume.reduce(
          (sum, value) => sum + (typeof value === 'number' ? value : 0),
          0,
        ) / record.volume.length;
      this.gain = Math.max(0, average / 65535);
    }
  }

  private flushCompleteChunks() {
    const samplesPerChunk = this.chunkFrames * this.channels;
    while (this.pending.length >= samplesPerChunk) {
      this.postChunk(this.pending.splice(0, samplesPerChunk), this.chunkFrames);
    }
  }

  private flushRemainder() {
    if (this.pending.length === 0) {
      return;
    }
    const frames = Math.floor(this.pending.length / this.channels);
    if (frames > 0) {
      this.postChunk(this.pending.splice(0, frames * this.channels), frames);
    }
    this.pending.length = 0;
  }

  private postChunk(samples: number[], frames: number) {
    const pcm = new Int16Array(samples.length);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    this.port.postMessage(
      { type: 'chunk', pcm: pcm.buffer, frames },
      [pcm.buffer],
    );
  }
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clampSample(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

registerProcessor('spice-record-source', SpiceRecordSourceProcessor);
