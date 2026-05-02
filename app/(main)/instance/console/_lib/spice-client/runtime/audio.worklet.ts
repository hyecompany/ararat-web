/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

interface QueuedPcmChunk {
  samples: Int16Array;
  channels: number;
  offsetFrames: number;
}

class SpiceAudioSinkProcessor extends AudioWorkletProcessor {
  private readonly queue: QueuedPcmChunk[] = [];
  private gain = 1;
  private muted = false;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      const message = event.data as {
        type?: string;
        pcm?: ArrayBuffer;
        channels?: number;
        volume?: number[];
        muted?: boolean;
      };
      switch (message.type) {
        case 'chunk':
          if (message.pcm && message.channels && message.channels > 0) {
            this.queue.push({
              samples: new Int16Array(message.pcm),
              channels: Math.max(1, Math.floor(message.channels)),
              offsetFrames: 0,
            });
          }
          break;
        case 'volume':
          if (Array.isArray(message.volume) && message.volume.length > 0) {
            this.gain = Math.max(0, Math.min(1, (message.volume[0] ?? 0xffff) / 0xffff));
          }
          break;
        case 'mute':
          this.muted = message.muted === true;
          break;
        case 'reset':
          this.queue.length = 0;
          break;
      }
    };
  }

  process(_inputs: unknown[], outputs: Float32Array[][]) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }
    const frameCount = output[0]?.length ?? 0;
    const gain = this.muted ? 0 : this.gain;

    for (let frame = 0; frame < frameCount; frame += 1) {
      const chunk = this.queue[0];
      if (!chunk) {
        for (const channel of output) {
          channel[frame] = 0;
        }
        continue;
      }

      for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
        const sourceChannel = Math.min(channelIndex, chunk.channels - 1);
        const sampleIndex = chunk.offsetFrames * chunk.channels + sourceChannel;
        output[channelIndex][frame] = ((chunk.samples[sampleIndex] ?? 0) / 32768) * gain;
      }

      chunk.offsetFrames += 1;
      if (chunk.offsetFrames * chunk.channels >= chunk.samples.length) {
        this.queue.shift();
      }
    }

    return true;
  }
}

registerProcessor('spice-audio-sink', SpiceAudioSinkProcessor);

export {};
