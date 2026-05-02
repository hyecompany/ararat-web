/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { SessionMonitorsConfig } from '../messages.js';

export interface NativeDisplayHead {
  monitorId: number;
  surfaceId: number;
  width: number;
  height: number;
  x: number;
  y: number;
  flags: number;
}

export interface NativeDrawEvent {
  type: 'draw';
  messageType?: number;
  kind?: string;
  commitToken: number | bigint;
  surfaceId: number;
  surfaceGeneration: number;
  bbox: { top: number; left: number; bottom: number; right: number };
  srcArea?: { top: number; left: number; bottom: number; right: number } | null;
  ropDescriptor?: number | null;
  scaleMode?: number | null;
  frameHint?: NativeDisplayFrameHint;
  execution?: NativeVisualExecutionPlan;
  image?: {
    descriptor?: {
      id?: number | bigint;
      imageType?: number;
      width?: number;
      height?: number;
    };
    payload?: {
      kind?: string;
      codec?: string;
      format?: number;
      flags?: number;
      stride?: number;
      data?: Uint8Array | number[];
    };
  } | null;
}

export type NativeDisplayFrameHint =
  | { kind: 'none' }
  | {
      kind: 'bitmapStrip';
      runId: number;
      startsRun: boolean;
      closesPreviousRun: boolean;
      itemCount?: number;
    };

export type NativeVisualExecutionPlan =
  | {
      kind: 'drawCopy';
      decode: NativeVisualDecodePlan;
      compose?: NativeDrawCopyComposePlan;
      byteCost?: number;
      lane?: string;
      priority?: number;
    }
  | { kind: 'unsupported'; reason?: string };

export type NativeVisualDecodePlan =
  | { kind: 'browserImage'; codec?: string }
  | { kind: 'wasmBitmap' }
  | { kind: 'wasmLzRgb' }
  | { kind: 'wasmBinaryImage'; codec?: string }
  | { kind: 'gpuSurfaceCopy'; surfaceId?: number }
  | { kind: 'protocolCacheRef' };

export interface NativeDrawCopyComposePlan {
  ropDescriptor?: number;
  scaleMode?: number;
  maskPresent?: boolean;
  maskFlags?: number | null;
}

export interface NativeCopyBitsEvent {
  type: 'copyBits';
  commitToken: number | bigint;
  surfaceId: number;
  surfaceGeneration: number;
  bbox: NativeDrawRect;
  srcPos: { x: number; y: number };
  clip?: {
    clipType?: number;
    rects?: NativeDrawRect[];
  };
}

export interface NativeGpuCommitEvent {
  type: 'nativeGpuCommit';
  commitToken: number | bigint;
  surfaceId: number;
  surfaceGeneration: number;
  bbox: NativeDrawRect;
  videoLike?: boolean;
  presented?: boolean;
  byteLength?: number;
}

export type NativeDisplayEvent =
  | { type: 'mode'; width: number; height: number; bits: number }
  | {
      type: 'surfaceCreate';
      surfaceId: number;
      width: number;
      height: number;
      format: number;
      flags: number;
      primary: boolean;
    }
  | { type: 'surfaceDestroy'; surfaceId: number }
  | { type: 'monitorsConfig'; count: number; maxAllowed: number; heads: NativeDisplayHead[] }
  | { type: 'reset' }
  | { type: 'mark' }
  | NativeDrawEvent
  | NativeCopyBitsEvent
  | NativeGpuCommitEvent
  | {
      type:
        | 'cacheInvalidateList'
        | 'cacheInvalidatePalette'
        | 'cacheInvalidateAllPalettes'
        | 'streamClip'
        | 'streamDestroy'
        | 'streamDestroyAll'
        | 'streamActivateReport';
    }
  | NativeStreamCreateEvent
  | NativeStreamDataEvent
  | {
      type: 'cacheInvalidateAllPixmaps';
      epoch?: number | bigint | null;
      pending?: boolean;
      waitBarrier?: number | bigint;
      waitList?: unknown[];
    };

export interface NativeStreamCreateEvent {
  type: 'streamCreate';
  surfaceId: number;
  surfaceGeneration?: number;
  id: number;
  codecType: number;
  streamWidth: number;
  streamHeight: number;
  srcWidth: number;
  srcHeight: number;
  dest: NativeDrawRect;
}

export interface NativeStreamDataEvent {
  type: 'streamData' | 'streamDataSized';
  surfaceId: number;
  surfaceGeneration: number;
  commitToken: number | bigint;
  id: number;
  codecType: number;
  multimediaTime: number;
  width: number;
  height: number;
  dest: NativeDrawRect;
  byteLength: number;
  data: Uint8Array | number[];
}

export interface NativeBrowserImageDecodeJob {
  codec: 'jpeg' | 'mjpeg' | 'png';
  bytes: ArrayBuffer;
  byteCost: number;
  lane: string;
  priority: number;
  compose: NativeDrawCopyComposePlan | null;
  width: number;
  height: number;
  bbox: NativeDrawRect;
  srcArea: NativeDrawRect | null;
  commitToken: bigint;
  surfaceId: number;
  surfaceGeneration: number;
}

export interface NativeWasmBitmapDecodeJob {
  bytes: Uint8Array;
  byteCost: number;
  lane: string;
  priority: number;
  compose: NativeDrawCopyComposePlan | null;
  width: number;
  height: number;
  stride: number;
  format: number;
  flags: number;
  bbox: NativeDrawRect;
  srcArea: NativeDrawRect | null;
  commitToken: bigint;
  surfaceId: number;
  surfaceGeneration: number;
}

export interface NativeWasmLzRgbDecodeJob {
  bytes: Uint8Array;
  byteCost: number;
  lane: string;
  priority: number;
  compose: NativeDrawCopyComposePlan | null;
  width: number;
  height: number;
  bbox: NativeDrawRect;
  srcArea: NativeDrawRect | null;
  commitToken: bigint;
  surfaceId: number;
  surfaceGeneration: number;
}

export interface NativeWasmBinaryImageDecodeJob {
  codec: 'quic' | 'lz4';
  bytes: Uint8Array;
  byteCost: number;
  lane: string;
  priority: number;
  compose: NativeDrawCopyComposePlan | null;
  width: number;
  height: number;
  bbox: NativeDrawRect;
  srcArea: NativeDrawRect | null;
  commitToken: bigint;
  surfaceId: number;
  surfaceGeneration: number;
}

export interface NativeDrawRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function nativeDisplayEvents(value: unknown): NativeDisplayEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isNativeDisplayEvent);
}

export function primarySurfaceSize(event: NativeDisplayEvent) {
  if (event.type !== 'surfaceCreate' || event.surfaceId !== 0 || !event.primary) {
    return null;
  }
  return {
    width: positiveInt(event.width),
    height: positiveInt(event.height),
  };
}

export function monitorConfig(event: NativeDisplayEvent): SessionMonitorsConfig | null {
  if (event.type !== 'monitorsConfig' || event.heads.length === 0) {
    return null;
  }
  const originX = Math.min(...event.heads.map((head) => head.x));
  const originY = Math.min(...event.heads.map((head) => head.y));
  const right = Math.max(...event.heads.map((head) => head.x + head.width));
  const bottom = Math.max(...event.heads.map((head) => head.y + head.height));
  return {
    count: positiveInt(event.count),
    maxAllowed: positiveInt(event.maxAllowed),
    origin: { x: nonNegativeInt(originX), y: nonNegativeInt(originY) },
    width: positiveInt(right - originX),
    height: positiveInt(bottom - originY),
    heads: event.heads.map((head) => ({
      monitorId: positiveInt(head.monitorId),
      surfaceId: positiveInt(head.surfaceId),
      width: positiveInt(head.width),
      height: positiveInt(head.height),
      x: nonNegativeInt(head.x),
      y: nonNegativeInt(head.y),
      flags: nonNegativeInt(head.flags),
    })),
  };
}

export function browserImageDecodeJob(
  event: NativeDisplayEvent,
): NativeBrowserImageDecodeJob | null {
  if (!isNativeDrawEvent(event)) {
    return null;
  }
  const execution = drawCopyExecution(event);
  const decode = execution?.decode;
  const codec =
    decode?.kind === 'browserImage' &&
    (decode.codec === 'jpeg' || decode.codec === 'mjpeg' || decode.codec === 'png')
      ? decode.codec
      : null;
  if (!execution || !codec) {
    return null;
  }
  const payload = event.image?.payload;
  const descriptor = event.image?.descriptor;
  if (payload?.kind !== 'binary') {
    return null;
  }
  const bytes = arrayBufferFromPayload(payload.data);
  const token = bigintToken(event.commitToken);
  if (!bytes || token === null || !isNumber(descriptor?.width) || !isNumber(descriptor?.height)) {
    return null;
  }
  return {
    codec,
    bytes,
    byteCost: nonNegativeInt(execution.byteCost ?? bytes.byteLength),
    lane: nativeLane(execution.lane, 'browser-image'),
    priority: nonNegativeInt(execution.priority ?? 2),
    compose: normalizedCompose(execution.compose),
    width: positiveInt(descriptor.width),
    height: positiveInt(descriptor.height),
    bbox: normalizedRect(event.bbox),
    srcArea: normalizedRectOrNull(event.srcArea),
    commitToken: token,
    surfaceId: positiveInt(event.surfaceId),
    surfaceGeneration: positiveInt(event.surfaceGeneration),
  };
}

export function wasmBitmapDecodeJob(
  event: NativeDisplayEvent,
): NativeWasmBitmapDecodeJob | null {
  if (!isNativeDrawEvent(event)) {
    return null;
  }
  const execution = drawCopyExecution(event);
  if (execution?.decode.kind !== 'wasmBitmap') {
    return null;
  }
  const payload = event.image?.payload;
  const descriptor = event.image?.descriptor;
  if (payload?.kind !== 'bitmap') {
    return null;
  }
  const bytes = uint8ArrayFromPayload(payload.data);
  const token = bigintToken(event.commitToken);
  if (
    !bytes ||
    token === null ||
    !isNumber(descriptor?.width) ||
    !isNumber(descriptor?.height) ||
    !isNumber(payload.stride) ||
    !isNumber(payload.format) ||
    !isNumber(payload.flags)
  ) {
    return null;
  }
  return {
    bytes,
    byteCost: nonNegativeInt(execution.byteCost ?? bytes.byteLength),
    lane: nativeLane(execution.lane, 'wasm-bitmap'),
    priority: nonNegativeInt(execution.priority ?? 1),
    compose: normalizedCompose(execution.compose),
    width: positiveInt(descriptor.width),
    height: positiveInt(descriptor.height),
    stride: positiveInt(payload.stride),
    format: positiveInt(payload.format),
    flags: nonNegativeInt(payload.flags),
    bbox: normalizedRect(event.bbox),
    srcArea: normalizedRectOrNull(event.srcArea),
    commitToken: token,
    surfaceId: positiveInt(event.surfaceId),
    surfaceGeneration: positiveInt(event.surfaceGeneration),
  };
}

export function wasmLzRgbDecodeJob(
  event: NativeDisplayEvent,
): NativeWasmLzRgbDecodeJob | null {
  if (!isNativeDrawEvent(event)) {
    return null;
  }
  const execution = drawCopyExecution(event);
  if (execution?.decode.kind !== 'wasmLzRgb') {
    return null;
  }
  const payload = event.image?.payload;
  const descriptor = event.image?.descriptor;
  if (payload?.kind !== 'binary') {
    return null;
  }
  const bytes = uint8ArrayFromPayload(payload.data);
  const token = bigintToken(event.commitToken);
  if (!bytes || token === null || !isNumber(descriptor?.width) || !isNumber(descriptor?.height)) {
    return null;
  }
  return {
    bytes,
    byteCost: nonNegativeInt(execution.byteCost ?? bytes.byteLength),
    lane: nativeLane(execution.lane, 'wasm-lz-rgb'),
    priority: nonNegativeInt(execution.priority ?? 2),
    compose: normalizedCompose(execution.compose),
    width: positiveInt(descriptor.width),
    height: positiveInt(descriptor.height),
    bbox: normalizedRect(event.bbox),
    srcArea: normalizedRectOrNull(event.srcArea),
    commitToken: token,
    surfaceId: positiveInt(event.surfaceId),
    surfaceGeneration: positiveInt(event.surfaceGeneration),
  };
}

export function wasmBinaryImageDecodeJob(
  event: NativeDisplayEvent,
): NativeWasmBinaryImageDecodeJob | null {
  if (!isNativeDrawEvent(event)) {
    return null;
  }
  const execution = drawCopyExecution(event);
  const decode = execution?.decode;
  const codec =
    decode?.kind === 'wasmBinaryImage' && (decode.codec === 'quic' || decode.codec === 'lz4')
      ? decode.codec
      : null;
  if (!execution || !codec) {
    return null;
  }
  const payload = event.image?.payload;
  const descriptor = event.image?.descriptor;
  if (payload?.kind !== 'binary') {
    return null;
  }
  const bytes = uint8ArrayFromPayload(payload.data);
  const token = bigintToken(event.commitToken);
  if (!bytes || token === null || !isNumber(descriptor?.width) || !isNumber(descriptor?.height)) {
    return null;
  }
  return {
    codec,
    bytes,
    byteCost: nonNegativeInt(execution.byteCost ?? bytes.byteLength),
    lane: nativeLane(execution.lane, `wasm-${codec}`),
    priority: nonNegativeInt(execution.priority ?? 2),
    compose: normalizedCompose(execution.compose),
    width: positiveInt(descriptor.width),
    height: positiveInt(descriptor.height),
    bbox: normalizedRect(event.bbox),
    srcArea: normalizedRectOrNull(event.srcArea),
    commitToken: token,
    surfaceId: positiveInt(event.surfaceId),
    surfaceGeneration: positiveInt(event.surfaceGeneration),
  };
}

function isNativeDisplayEvent(value: unknown): value is NativeDisplayEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'mode':
      return isNumber(value.width) && isNumber(value.height) && isNumber(value.bits);
    case 'surfaceCreate':
      return (
        isNumber(value.surfaceId) &&
        isNumber(value.width) &&
        isNumber(value.height) &&
        isNumber(value.format) &&
        isNumber(value.flags) &&
        typeof value.primary === 'boolean'
      );
    case 'surfaceDestroy':
      return isNumber(value.surfaceId);
    case 'monitorsConfig':
      return (
        isNumber(value.count) &&
        isNumber(value.maxAllowed) &&
        Array.isArray(value.heads) &&
        value.heads.every(isNativeDisplayHead)
      );
    case 'reset':
    case 'mark':
    case 'cacheInvalidateList':
    case 'cacheInvalidatePalette':
    case 'cacheInvalidateAllPalettes':
    case 'streamClip':
    case 'streamDestroy':
    case 'streamDestroyAll':
    case 'streamActivateReport':
      return true;
    case 'streamCreate':
      return (
        isNumber(value.surfaceId) &&
        isNumber(value.id) &&
        isNumber(value.codecType) &&
        isNumber(value.streamWidth) &&
        isNumber(value.streamHeight) &&
        isRecord(value.dest)
      );
    case 'streamData':
    case 'streamDataSized':
      return (
        isNumber(value.surfaceId) &&
        isNumber(value.surfaceGeneration) &&
        (isNumber(value.commitToken) || typeof value.commitToken === 'bigint') &&
        isNumber(value.id) &&
        isNumber(value.codecType) &&
        isNumber(value.width) &&
        isNumber(value.height) &&
        isRecord(value.dest) &&
        (value.data instanceof Uint8Array || Array.isArray(value.data))
      );
    case 'cacheInvalidateAllPixmaps':
      return true;
    case 'copyBits':
      return (
        isNumber(value.surfaceId) &&
        isNumber(value.surfaceGeneration) &&
        (isNumber(value.commitToken) || typeof value.commitToken === 'bigint') &&
        isRecord(value.bbox) &&
        isRecord(value.srcPos) &&
        isNumber(value.srcPos.x) &&
        isNumber(value.srcPos.y)
      );
    case 'nativeGpuCommit':
      return (
        isNumber(value.surfaceId) &&
        isNumber(value.surfaceGeneration) &&
        (isNumber(value.commitToken) || typeof value.commitToken === 'bigint') &&
        isRecord(value.bbox)
      );
    case 'draw':
      return (
        isNumber(value.surfaceId) &&
        isNumber(value.surfaceGeneration) &&
        (isNumber(value.commitToken) || typeof value.commitToken === 'bigint')
      );
    default:
      return false;
  }
}

function isNativeDrawEvent(event: NativeDisplayEvent): event is NativeDrawEvent {
  return (
    event.type === 'draw' &&
    isNumber((event as { surfaceId?: unknown }).surfaceId) &&
    isNumber((event as { surfaceGeneration?: unknown }).surfaceGeneration) &&
    (typeof (event as { commitToken?: unknown }).commitToken === 'number' ||
      typeof (event as { commitToken?: unknown }).commitToken === 'bigint')
  );
}

function drawCopyExecution(event: NativeDrawEvent) {
  return event.execution?.kind === 'drawCopy' ? event.execution : null;
}

function isNativeDisplayHead(value: unknown): value is NativeDisplayHead {
  return (
    isRecord(value) &&
    isNumber(value.monitorId) &&
    isNumber(value.surfaceId) &&
    isNumber(value.width) &&
    isNumber(value.height) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isNumber(value.flags)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function bigintToken(value: number | bigint): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }
  if (Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  return null;
}

function arrayBufferFromPayload(data: Uint8Array | number[] | undefined) {
  return uint8ArrayFromPayload(data)?.buffer ?? null;
}

function uint8ArrayFromPayload(data: Uint8Array | number[] | undefined) {
  if (data instanceof Uint8Array) {
    return data.slice();
  }
  if (Array.isArray(data)) {
    return Uint8Array.from(data);
  }
  return null;
}

function positiveInt(value: number) {
  return Math.max(1, Math.floor(value));
}

function nonNegativeInt(value: number) {
  return Math.max(0, Math.floor(value));
}

function normalizedRect(value: unknown): NativeDrawRect {
  if (!isRecord(value)) {
    return { top: 0, left: 0, bottom: 1, right: 1 };
  }
  const top = isNumber(value.top) ? Math.floor(value.top) : 0;
  const left = isNumber(value.left) ? Math.floor(value.left) : 0;
  const bottom = isNumber(value.bottom) ? Math.floor(value.bottom) : top + 1;
  const right = isNumber(value.right) ? Math.floor(value.right) : left + 1;
  return {
    top,
    left,
    bottom: Math.max(top + 1, bottom),
    right: Math.max(left + 1, right),
  };
}

function normalizedRectOrNull(value: unknown): NativeDrawRect | null {
  if (!isRecord(value)) {
    return null;
  }
  return normalizedRect(value);
}

function normalizedCompose(value: unknown): NativeDrawCopyComposePlan | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    ropDescriptor: isNumber(value.ropDescriptor) ? nonNegativeInt(value.ropDescriptor) : undefined,
    scaleMode: isNumber(value.scaleMode) ? nonNegativeInt(value.scaleMode) : undefined,
    maskPresent: typeof value.maskPresent === 'boolean' ? value.maskPresent : undefined,
    maskFlags: isNumber(value.maskFlags) ? nonNegativeInt(value.maskFlags) : null,
  };
}

function nativeLane(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
