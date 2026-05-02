/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export interface NativeSpiceEngine {
  open_channel(
    channelKey: string,
    channelType: number,
    channelId: number,
    connectionId: number,
  ): Uint8Array;
  submit_encrypted_ticket(channelKey: string, ticket: Uint8Array): Uint8Array;
  ingest_channel_bytes(channelKey: string, bytes: Uint8Array): unknown;
  flushPendingNativeBitmapUploads?(maxItems: number): unknown;
  setRawBitmapCoalesceMode?(enabled: boolean): void;
  resizeNative?(width: number, height: number): void;
  control(message: unknown): unknown;
  check_visual_token(token: bigint): boolean;
  commit_visual_token(token: bigint): boolean;
  uploadExternalImageAndCommit?(
    token: bigint,
    source: ImageBitmap,
    sourceWidth: number,
    sourceHeight: number,
    destLeft: number,
    destTop: number,
    destRight: number,
    destBottom: number,
    srcLeft: number,
    srcTop: number,
    srcRight: number,
    srcBottom: number,
    ropDescriptor: number,
    scaleMode: number,
    maskPresent: boolean,
    present: boolean,
  ): boolean;
  uploadBitmapAndCommit?(
    token: bigint,
    bytes: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    stride: number,
    format: number,
    flags: number,
    destLeft: number,
    destTop: number,
    destRight: number,
    destBottom: number,
    srcLeft: number,
    srcTop: number,
    srcRight: number,
    srcBottom: number,
    ropDescriptor: number,
    scaleMode: number,
    maskPresent: boolean,
    present: boolean,
  ): boolean;
  uploadRgbaAndCommit?(
    token: bigint,
    bytes: Uint8Array,
    sourceWidth: number,
    sourceHeight: number,
    destLeft: number,
    destTop: number,
    destRight: number,
    destBottom: number,
    srcLeft: number,
    srcTop: number,
    srcRight: number,
    srcBottom: number,
    ropDescriptor: number,
    scaleMode: number,
    maskPresent: boolean,
    present: boolean,
  ): boolean;
  presentPrimary?(): boolean | void;
  diagnostics(): unknown;
  dispose(): void;
}

export type NativeSpiceRuntime = NativeSpiceEngine;

export interface NativeSpiceRuntimeConstructor {
  createForOffscreenCanvas(
    canvas: OffscreenCanvas,
    width: number,
    height: number,
  ): Promise<NativeSpiceRuntime>;
}

export interface SpiceNativeModule {
  default: () => Promise<unknown>;
  SpiceEngine?: new () => NativeSpiceEngine;
  SpiceNativeRuntime?: NativeSpiceRuntimeConstructor;
  initThreadPool?: (threads: number) => Promise<unknown>;
  bitmap_decode?: (
    input: Uint8Array,
    width: number,
    height: number,
    stride: number,
    format: number,
    flags: number,
  ) => Uint8Array;
  lz_rgb_image_decode?: (
    input: Uint8Array,
    expectedWidth: number,
    expectedHeight: number,
  ) => Uint8Array;
  quic_decode?: (
    input: Uint8Array,
    width: number,
    height: number,
  ) => Uint8Array;
  lz4_decode?: (
    input: Uint8Array,
    width: number,
    height: number,
  ) => Uint8Array;
}

let nativeModulePromise: Promise<SpiceNativeModule | null> | null = null;

export function loadSpiceNativeModule() {
  if (!nativeModulePromise) {
    nativeModulePromise = import('../pkg/spice_native.js')
      .then(async (loadedModule) => {
        const wasmModule = loadedModule as SpiceNativeModule;
        await wasmModule.default();
        return wasmModule;
      })
      .catch(() => null);
  }
  return nativeModulePromise;
}

export async function createNativeSpiceEngine() {
  const nativeModule = await loadSpiceNativeModule();
  if (!nativeModule?.SpiceEngine) {
    return null;
  }
  return new nativeModule.SpiceEngine();
}

export async function createNativeSpiceRuntime(
  canvas: OffscreenCanvas,
  width: number,
  height: number,
) {
  const nativeModule = await loadSpiceNativeModule();
  if (!nativeModule?.SpiceNativeRuntime) {
    return null;
  }
  try {
    return await nativeModule.SpiceNativeRuntime.createForOffscreenCanvas(
      canvas,
      Math.max(1, Math.floor(width)),
      Math.max(1, Math.floor(height)),
    );
  } catch {
    return null;
  }
}
