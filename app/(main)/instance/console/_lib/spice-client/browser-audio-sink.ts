/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type {
  SessionAudioChunk,
  SessionAudioControl,
} from './runtime/messages';

export class BrowserSpiceAudioSink {
  private audioContext: AudioContext | null = null;
  private audioGain: GainNode | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private audioWorkletReady: Promise<void> | null = null;
  private opusDecoder: AudioDecoder | null = null;
  private opusDecoderReady: Promise<boolean> | null = null;
  private opusTimestampUs = 0;

  async handleAudio(payload: SessionAudioChunk) {
    if (payload.channels <= 0 || payload.sampleRate <= 0 || payload.pcm.byteLength < 2) {
      return;
    }
    if (payload.mode === 3) {
      await this.handleOpusAudio(payload);
      return;
    }

    const context = this.ensureAudioContext();
    await context.resume().catch(() => {});
    await this.ensureAudioWorklet();
    this.audioWorkletNode?.port.postMessage(
      {
        type: 'chunk',
        pcm: payload.pcm,
        channels: payload.channels,
      },
      [payload.pcm],
    );
  }

  handleControl(payload: SessionAudioControl) {
    if (payload.muted === undefined && payload.volume === undefined) {
      return;
    }

    const context = this.ensureAudioContext();
    const gain = this.audioGain ?? context.createGain();
    if (!this.audioGain) {
      gain.connect(context.destination);
      this.audioGain = gain;
    }
    const averageVolume = payload.volume?.length
      ? payload.volume.reduce((sum, value) => sum + value, 0) / payload.volume.length / 0xffff
      : gain.gain.value;
    gain.gain.value = payload.muted ? 0 : Math.max(0, Math.min(1, averageVolume));
    if (payload.volume) {
      this.audioWorkletNode?.port.postMessage({ type: 'volume', volume: payload.volume });
    }
    if (payload.muted !== undefined) {
      this.audioWorkletNode?.port.postMessage({ type: 'mute', muted: payload.muted });
    }
  }

  stop() {
    this.audioWorkletNode?.port.postMessage({ type: 'reset' });
    this.opusDecoder?.reset();
    this.opusTimestampUs = 0;
  }

  dispose() {
    this.opusDecoder?.close();
    this.opusDecoder = null;
    this.opusDecoderReady = null;
    this.audioWorkletNode?.disconnect();
    this.audioWorkletNode = null;
    void this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.audioGain = null;
    this.audioWorkletReady = null;
    this.opusTimestampUs = 0;
  }

  private ensureAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ latencyHint: 'interactive' });
      this.audioGain = this.audioContext.createGain();
      this.audioGain.connect(this.audioContext.destination);
    }
    return this.audioContext;
  }

  private async ensureAudioWorklet() {
    if (this.audioWorkletNode) {
      return;
    }
    const context = this.ensureAudioContext();
    if (!this.audioWorkletReady) {
      this.audioWorkletReady = context.audioWorklet
        .addModule('/ui/spice-client/audio.worklet.js')
        .catch(() => {});
    }
    await this.audioWorkletReady;
    if (!this.audioWorkletNode) {
      this.audioWorkletNode = new AudioWorkletNode(context, 'spice-audio-sink', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.audioWorkletNode.connect(this.audioGain ?? context.destination);
    }
  }

  private async handleOpusAudio(payload: SessionAudioChunk) {
    const ready = await this.ensureOpusDecoder(payload.channels, payload.sampleRate);
    if (!ready || !this.opusDecoder || typeof EncodedAudioChunk === 'undefined') {
      return;
    }
    const durationUs = Math.max(
      1000,
      Math.round((payload.pcm.byteLength / Math.max(1, payload.sampleRate)) * 1000),
    );
    const chunk = new EncodedAudioChunk({
      type: 'key',
      timestamp: this.opusTimestampUs,
      duration: durationUs,
      data: payload.pcm,
    });
    this.opusTimestampUs += durationUs;
    this.opusDecoder.decode(chunk);
  }

  private async ensureOpusDecoder(channels: number, sampleRate: number) {
    if (this.opusDecoder) {
      return true;
    }
    const Decoder = window.AudioDecoder;
    if (!Decoder || typeof EncodedAudioChunk === 'undefined') {
      return false;
    }
    if (!this.opusDecoderReady) {
      this.opusDecoderReady = Decoder.isConfigSupported({
        codec: 'opus',
        sampleRate,
        numberOfChannels: channels,
      }).then(async (support) => {
        if (!support.supported || !support.config) {
          return false;
        }
        await this.ensureAudioWorklet();
        this.opusDecoder = new Decoder({
          output: (audioData) => this.handleDecodedAudio(audioData),
          error: () => {},
        });
        this.opusDecoder.configure(support.config);
        return true;
      }).catch(() => false);
    }
    return this.opusDecoderReady;
  }

  private handleDecodedAudio(audioData: AudioData) {
    const frames = audioData.numberOfFrames;
    const channelCount = audioData.numberOfChannels;
    const floats = new Float32Array(frames * channelCount);
    audioData.copyTo(floats, { planeIndex: 0, format: 'f32' });
    audioData.close();

    const pcm = new ArrayBuffer(floats.length * 2);
    const out = new Int16Array(pcm);
    for (let index = 0; index < floats.length; index += 1) {
      out[index] = Math.max(
        -32768,
        Math.min(32767, Math.round((floats[index] ?? 0) * 32767)),
      );
    }
    this.audioWorkletNode?.port.postMessage(
      { type: 'chunk', pcm, channels: channelCount },
      [pcm],
    );
  }
}
