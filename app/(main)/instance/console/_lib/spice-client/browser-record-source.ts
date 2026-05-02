/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

import type {
  SessionControlMessage,
  SessionRecordControl,
} from './runtime/messages';

interface BrowserRecordSourceOptions {
  postControl: (message: SessionControlMessage, transfer?: ArrayBuffer[]) => void;
}

interface RecordStartOptions {
  channels: number;
  sampleRate: number;
  format: number;
}

type RecordWorkletMessage =
  | { type: 'chunk'; pcm: ArrayBuffer; frames: number }
  | { type: 'error'; message: string };

const SPICE_AUDIO_FMT_S16 = 1;
const DEFAULT_RECORD_CHUNK_MS = 20;

export class BrowserSpiceRecordSource {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private silentSink: GainNode | null = null;
  private startTimeMs = 0;
  private sentFrames = 0;
  private targetSampleRate = 0;
  private started = false;

  constructor(private readonly options: BrowserRecordSourceOptions) {}

  async start(payload: RecordStartOptions) {
    await this.stop();
    if (payload.format !== SPICE_AUDIO_FMT_S16) {
      this.reportError(`Unsupported SPICE record format ${payload.format}.`);
      return;
    }

    const channels = Math.max(1, Math.min(2, Math.floor(payload.channels || 1)));
    const sampleRate = Math.max(8000, Math.floor(payload.sampleRate || 44100));
    this.targetSampleRate = sampleRate;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: channels },
          sampleRate: { ideal: sampleRate },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      const context = new AudioContext({ sampleRate });
      await context.audioWorklet.addModule('/ui/spice-client/record.worklet.js');
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'spice-record-source', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          channels,
          targetSampleRate: sampleRate,
          chunkFrames: Math.max(1, Math.round(sampleRate * DEFAULT_RECORD_CHUNK_MS / 1000)),
        },
      });
      const sink = context.createGain();
      sink.gain.value = 0;
      worklet.port.onmessage = (event: MessageEvent<RecordWorkletMessage>) => {
        this.handleWorkletMessage(event.data);
      };

      source.connect(worklet);
      worklet.connect(sink);
      sink.connect(context.destination);
      await context.resume();

      this.audioContext = context;
      this.mediaStream = stream;
      this.sourceNode = source;
      this.workletNode = worklet;
      this.silentSink = sink;
      this.startTimeMs = performance.now();
      this.sentFrames = 0;
      this.started = true;
    } catch (error) {
      await this.stop();
      this.reportError(
        error instanceof Error ? error.message : 'Microphone capture failed.',
      );
    }
  }

  applyControl(payload: SessionRecordControl) {
    this.workletNode?.port.postMessage({
      type: 'control',
      muted: payload.muted,
      volume: payload.volume,
    });
  }

  async stop() {
    this.started = false;
    this.workletNode?.port.postMessage({ type: 'stop' });
    this.workletNode?.disconnect();
    this.sourceNode?.disconnect();
    this.silentSink?.disconnect();
    for (const track of this.mediaStream?.getTracks() ?? []) {
      track.stop();
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.silentSink = null;
    this.sentFrames = 0;
    this.targetSampleRate = 0;
  }

  private handleWorkletMessage(message: RecordWorkletMessage) {
    if (!this.started) {
      return;
    }
    if (message.type === 'error') {
      this.reportError(message.message);
      return;
    }
    if (message.type !== 'chunk' || message.pcm.byteLength === 0) {
      return;
    }

    const multimediaTime = Math.max(
      0,
      Math.floor(this.startTimeMs + (this.sentFrames * 1000) / this.targetSampleRate),
    );
    this.sentFrames += message.frames;
    this.options.postControl(
      {
        type: 'record_chunk',
        payload: { pcm: message.pcm, multimediaTime },
      },
      [message.pcm],
    );
  }

  private reportError(message: string) {
    this.options.postControl({
      type: 'record_error',
      payload: { message },
    });
  }
}
