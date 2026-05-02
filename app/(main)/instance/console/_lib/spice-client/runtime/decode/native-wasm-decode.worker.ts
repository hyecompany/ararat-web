/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import initNative, {
  bitmap_decode,
  lz4_decode,
  lz_rgb_image_decode,
  quic_decode,
} from '../pkg/spice_native.js';

type NativeWasmDecodeKind = 'bitmap' | 'lz-rgb' | 'quic' | 'lz4';

interface NativeWasmDecodeRequest {
  id: number;
  kind: NativeWasmDecodeKind;
  bytes: ArrayBuffer;
  width: number;
  height: number;
  stride?: number;
  format?: number;
  flags?: number;
}

type NativeWasmDecodeWorkerInbound =
  | { type: 'init' }
  | { type: 'decode'; payload: NativeWasmDecodeRequest }
  | { type: 'dispose' };

type NativeWasmDecodeWorkerOutbound =
  | { type: 'ready' }
  | {
      type: 'decoded';
      payload: {
        id: number;
        rgba: ArrayBuffer;
        width: number;
        height: number;
      };
    }
  | { type: 'error'; payload: { id: number; message: string } };

const workerScope = self as typeof self & {
  postMessage: (message: NativeWasmDecodeWorkerOutbound, transfer?: Transferable[]) => void;
};

let runtimeReady: Promise<unknown> | null = null;
let disposed = false;

function ensureRuntime() {
  if (!runtimeReady) {
    runtimeReady = initNative();
  }
  return runtimeReady;
}

function expectedRgbaBytes(width: number, height: number) {
  return Math.max(1, Math.floor(width)) * Math.max(1, Math.floor(height)) * 4;
}

function decodePayload(request: NativeWasmDecodeRequest) {
  const bytes = new Uint8Array(request.bytes);
  switch (request.kind) {
    case 'bitmap':
      return bitmap_decode(
        bytes,
        request.width,
        request.height,
        request.stride ?? request.width * 4,
        request.format ?? 8,
        request.flags ?? 0,
      );
    case 'lz-rgb':
      return lz_rgb_image_decode(bytes, request.width, request.height);
    case 'quic':
      return quic_decode(bytes, request.width, request.height);
    case 'lz4':
      return lz4_decode(bytes, request.width, request.height);
  }
}

self.onmessage = (event: MessageEvent<NativeWasmDecodeWorkerInbound>) => {
  const message = event.data;
  if (message.type === 'dispose') {
    disposed = true;
    close();
    return;
  }

  void (async () => {
    try {
      await ensureRuntime();
      if (disposed) {
        return;
      }
      if (message.type === 'init') {
        workerScope.postMessage({ type: 'ready' });
        return;
      }

      const decoded = decodePayload(message.payload);
      const expected = expectedRgbaBytes(message.payload.width, message.payload.height);
      if (decoded.byteLength !== expected) {
        throw new Error(
          `${message.payload.kind} decode returned ${decoded.byteLength} bytes; expected ${expected}.`,
        );
      }

      const rgba = new Uint8Array(decoded.byteLength);
      rgba.set(decoded);
      workerScope.postMessage(
        {
          type: 'decoded',
          payload: {
            id: message.payload.id,
            rgba: rgba.buffer,
            width: message.payload.width,
            height: message.payload.height,
          },
        },
        [rgba.buffer],
      );
    } catch (error) {
      if (message.type === 'decode') {
        workerScope.postMessage({
          type: 'error',
          payload: {
            id: message.payload.id,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  })();
};
