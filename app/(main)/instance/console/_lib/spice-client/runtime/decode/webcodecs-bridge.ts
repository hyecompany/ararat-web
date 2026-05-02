/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { SessionInitPayload } from '../messages.js';

export type BrowserDecodeRoute =
  | 'image-decoder'
  | 'image-bitmap'
  | 'video-decoder'
  | 'wasm'
  | 'none';

export type BrowserDecodeCodec =
  | 'jpeg'
  | 'mjpeg'
  | 'vp8'
  | 'vp9'
  | 'h264'
  | 'h265'
  | 'png'
  | 'raw'
  | 'lz'
  | 'lz_plt'
  | 'quic'
  | 'glz'
  | 'zlib_glz'
  | 'lz4';

export interface BrowserDecodeJob {
  id: number;
  codec: BrowserDecodeCodec;
  bytes: ArrayBuffer;
  mimeType?: string | null;
  sequenceId: number;
  commitToken: bigint;
  surfaceId: number;
  surfaceGeneration: number;
}

export interface BrowserDecodeSnapshot {
  support: Record<string, boolean>;
  imageDecoderJobs: number;
  imageBitmapJobs: number;
  videoDecoderJobs: number;
  failures: number;
  staleDrops: number;
  closedOutputs: number;
  readbackFallbacks: number;
}

type BrowserImageDecoderConstructor = new (init: {
  data: BufferSource;
  type: string;
}) => {
  decode: () => Promise<{ image: ImageBitmap | VideoFrameLike }>;
  close: () => void;
};

interface VideoFrameLike {
  close: () => void;
}

interface BrowserVideoDecoderConstructor {
  isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
}

interface WebCodecsGlobal {
  ImageDecoder?: BrowserImageDecoderConstructor;
  VideoDecoder?: BrowserVideoDecoderConstructor;
}

export class BrowserDecodeBridge {
  private readonly support: Record<string, boolean>;
  private imageDecoderJobs = 0;
  private imageBitmapJobs = 0;
  private videoDecoderJobs = 0;
  private failures = 0;
  private staleDrops = 0;
  private closedOutputs = 0;
  private readbackFallbacks = 0;

  constructor(
    capabilityProbe: SessionInitPayload['capabilityProbe'] | undefined,
    private readonly options: {
      browserImageDecode: boolean;
      browserVideoDecode: boolean;
      forceWasmDecode: boolean;
      disableReadbackFallback: boolean;
      preferImageBitmap?: boolean;
    },
  ) {
    const globals = webCodecsGlobal();
    this.support = {
      imageBitmap: capabilityProbe?.imageBitmap ?? typeof createImageBitmap === 'function',
      imageDecoder:
        capabilityProbe?.imageDecoder ?? typeof globals.ImageDecoder !== 'undefined',
      videoDecoder:
        capabilityProbe?.videoDecoder ?? typeof globals.VideoDecoder !== 'undefined',
      jpegImageDecoder:
        capabilityProbe?.jpegImageDecoder ??
        (capabilityProbe?.imageDecoder ?? typeof globals.ImageDecoder !== 'undefined'),
      jpegImageBitmap:
        capabilityProbe?.jpegImageBitmap ?? typeof createImageBitmap === 'function',
      mjpeg: capabilityProbe?.videoCodecs?.mjpeg ?? false,
      vp8: capabilityProbe?.videoCodecs?.vp8 ?? false,
      vp9: capabilityProbe?.videoCodecs?.vp9 ?? false,
      h264: capabilityProbe?.videoCodecs?.h264 ?? false,
      h265: capabilityProbe?.videoCodecs?.h265 ?? false,
    };
  }

  chooseRoute(codec: BrowserDecodeCodec): BrowserDecodeRoute {
    if (this.options.forceWasmDecode) {
      return 'wasm';
    }
    if ((codec === 'jpeg' || codec === 'mjpeg') && this.options.browserImageDecode) {
      if (this.options.preferImageBitmap && this.support.jpegImageBitmap) {
        return 'image-bitmap';
      }
      if (this.support.jpegImageDecoder) {
        return 'image-decoder';
      }
      if (this.support.jpegImageBitmap) {
        return 'image-bitmap';
      }
    }
    if (
      (codec === 'vp8' || codec === 'vp9' || codec === 'h264' || codec === 'h265') &&
      this.options.browserVideoDecode &&
      this.support[codec]
    ) {
      return 'video-decoder';
    }
    if (codec === 'png' && this.options.browserImageDecode && this.support.imageBitmap) {
      return 'image-bitmap';
    }
    if (codec === 'raw') {
      return 'none';
    }
    return 'wasm';
  }

  async decodeBrowserImage(job: BrowserDecodeJob): Promise<ImageBitmap | VideoFrameLike | null> {
    const route = this.chooseRoute(job.codec);
    if (route === 'image-decoder') {
      this.imageDecoderJobs += 1;
      return this.decodeWithImageDecoder(job);
    }
    if (route === 'image-bitmap') {
      this.imageBitmapJobs += 1;
      return this.decodeWithImageBitmap(job);
    }
    return null;
  }

  closeOutput(output: ImageBitmap | VideoFrameLike | null) {
    if (!output || !('close' in output) || typeof output.close !== 'function') {
      return;
    }
    output.close();
    this.closedOutputs += 1;
  }

  noteStaleDrop(output: ImageBitmap | VideoFrameLike | null) {
    this.staleDrops += 1;
    this.closeOutput(output);
  }

  snapshot(): BrowserDecodeSnapshot {
    return {
      support: { ...this.support },
      imageDecoderJobs: this.imageDecoderJobs,
      imageBitmapJobs: this.imageBitmapJobs,
      videoDecoderJobs: this.videoDecoderJobs,
      failures: this.failures,
      staleDrops: this.staleDrops,
      closedOutputs: this.closedOutputs,
      readbackFallbacks: this.readbackFallbacks,
    };
  }

  private async decodeWithImageDecoder(job: BrowserDecodeJob) {
    const ImageDecoder = webCodecsGlobal().ImageDecoder;
    if (!ImageDecoder) {
      return null;
    }
    const decoder = new ImageDecoder({
      data: job.bytes,
      type: job.mimeType ?? mimeTypeForCodec(job.codec),
    });
    try {
      const result = await decoder.decode();
      return result.image;
    } catch {
      this.failures += 1;
      return null;
    } finally {
      decoder.close();
    }
  }

  private async decodeWithImageBitmap(job: BrowserDecodeJob) {
    if (typeof createImageBitmap !== 'function') {
      return null;
    }
    try {
      const blob = new Blob([job.bytes], {
        type: job.mimeType ?? mimeTypeForCodec(job.codec),
      });
      return await createImageBitmap(blob);
    } catch {
      this.failures += 1;
      return null;
    }
  }
}

export async function probeVideoCodec(codec: BrowserDecodeCodec, codecString: string) {
  const VideoDecoder = webCodecsGlobal().VideoDecoder;
  const probe = VideoDecoder?.isConfigSupported;
  if (!probe) {
    return false;
  }
  try {
    const result = await probe({ codec: codecString });
    return result.supported === true;
  } catch {
    return false;
  }
}

function webCodecsGlobal() {
  return globalThis as unknown as WebCodecsGlobal;
}

function mimeTypeForCodec(codec: BrowserDecodeCodec) {
  switch (codec) {
    case 'jpeg':
    case 'mjpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return 'application/octet-stream';
  }
}
