/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type {
  RuntimeFastPathToggles,
  SessionInitPayload,
  SessionStage,
  SessionWorkerOutbound,
  SpiceWorkerDiagnostics,
} from '../messages.js';
import {
  browserImageDecodeJob,
  monitorConfig,
  primarySurfaceSize,
  wasmBinaryImageDecodeJob,
  wasmBitmapDecodeJob,
  wasmLzRgbDecodeJob,
  type NativeBrowserImageDecodeJob,
  type NativeDisplayEvent,
  type NativeStreamDataEvent,
  type NativeWasmBinaryImageDecodeJob,
  type NativeWasmBitmapDecodeJob,
  type NativeWasmLzRgbDecodeJob,
} from '../display/native-display-events.js';
import { DisplayWorkQueue } from '../display/display-work-queue.js';
import { BitmapStripFrameFence } from '../display/bitmap-strip-frame-fence.js';
import { BrowserDecodeBridge } from '../decode/webcodecs-bridge.js';
import type {
  NativeSpiceEngine,
  SpiceNativeModule,
} from '../native/spice-native.js';
import { ConsoleRenderer } from '../render/webgpu-adapter.js';

type WorkerPost = (message: SessionWorkerOutbound, transfer?: Transferable[]) => void;

export interface BrowserSpiceDisplayPipelineOptions {
  canvas: OffscreenCanvas;
  capabilityProbe: SessionInitPayload['capabilityProbe'];
  backendPolicy?: SessionInitPayload['backendPolicy'];
  toggles: RuntimeFastPathToggles;
  post: WorkerPost;
  nativeEngine: () => NativeSpiceEngine | null;
  nativeModule: () => SpiceNativeModule | null;
  diagnostics: () => SpiceWorkerDiagnostics | null;
  setResolution: (width: number, height: number) => void;
  updateStage: (stage: SessionStage) => void;
  recordUnsupported: (reason: string) => void;
}

type WasmRgbaJob =
  | NativeWasmBitmapDecodeJob
  | NativeWasmLzRgbDecodeJob
  | NativeWasmBinaryImageDecodeJob;

export class BrowserSpiceDisplayPipeline {
  private renderer: ConsoleRenderer | null = null;
  private decodeBridge: BrowserDecodeBridge | null = null;
  private workQueue: DisplayWorkQueue | null = null;
  private toggles: RuntimeFastPathToggles;
  private initialDisplayMarked = false;
  private initialDisplayRevealWorkTarget: number | null = null;
  private readonly stripFence: BitmapStripFrameFence;

  constructor(private readonly options: BrowserSpiceDisplayPipelineOptions) {
    this.toggles = options.toggles;
    this.stripFence = new BitmapStripFrameFence(
      () => this.renderer,
      () => this.options.diagnostics(),
      () => {
        const queue = this.workQueue?.snapshot();
        return Boolean(queue && (queue.queuedTasks > 0 || queue.activeTasks > 0));
      },
    );
  }

  async initialize() {
    this.decodeBridge = this.createDecodeBridge();
    this.workQueue = new DisplayWorkQueue({
      maxConcurrent: 2,
      onProgress: () => this.revealInitialDisplayIfReady(),
    });
    this.renderer = new ConsoleRenderer(this.options.canvas);
    await this.renderer.initialize(this.options.backendPolicy);
    this.renderer.setCanvasPresentationSuspended(true);
  }

  updateToggles(toggles: RuntimeFastPathToggles) {
    this.toggles = toggles;
    this.decodeBridge = this.createDecodeBridge();
    this.refreshDiagnostics();
  }

  resize(width: number, height: number) {
    this.renderer?.resize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
  }

  dispose() {
    this.stripFence.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.decodeBridge = null;
    this.workQueue?.dispose();
    this.workQueue = null;
  }

  apply(event: NativeDisplayEvent) {
    const diagnostics = this.options.diagnostics();
    if (!diagnostics) {
      return;
    }
    diagnostics.debug.displayPackets[event.type] =
      (diagnostics.debug.displayPackets[event.type] ?? 0) + 1;

    switch (event.type) {
      case 'mode':
        this.resize(event.width, event.height);
        this.options.setResolution(event.width, event.height);
        this.options.updateStage('display-initialized');
        break;
      case 'surfaceCreate':
        this.applySurfaceCreate(event);
        break;
      case 'surfaceDestroy':
        if (event.surfaceId === 0) {
          this.renderer?.presentClear(0, 0, 0, 1);
        }
        break;
      case 'monitorsConfig':
        this.applyMonitorsConfig(event);
        break;
      case 'reset':
        this.applyReset();
        break;
      case 'mark':
        this.initialDisplayMarked = true;
        this.initialDisplayRevealWorkTarget = this.currentWorkPosition();
        this.revealInitialDisplayIfReady();
        break;
      case 'copyBits':
        this.enqueueCopyBits(event);
        break;
      case 'streamData':
      case 'streamDataSized':
        this.enqueueStreamData(event);
        break;
      case 'streamClip':
        this.options.recordUnsupported('stream-clip-not-applied');
        break;
      case 'streamActivateReport':
        this.options.recordUnsupported('stream-report-disabled-unexpected-activate');
        break;
      case 'draw':
        this.enqueueDraw(event);
        break;
    }
  }

  recordEventFilter(rawDisplayEvents: unknown[], accepted: number) {
    const diagnostics = this.options.diagnostics();
    if (!diagnostics) {
      return;
    }
    const reason =
      `accepted:${accepted}/${rawDisplayEvents.length}:` +
      displayEventShapeSummary(rawDisplayEvents);
    diagnostics.debug.displayEventFilters[reason] =
      (diagnostics.debug.displayEventFilters[reason] ?? 0) + 1;
    this.options.recordUnsupported(`display-event-filtered:${reason}`);
  }

  refreshDiagnostics() {
    const diagnostics = this.options.diagnostics();
    if (!diagnostics) {
      return;
    }
    const renderer = this.renderer?.snapshot();
    if (renderer) {
      diagnostics.backend = renderer.backend;
      diagnostics.rendering.compositorBackend = renderer.backend;
      diagnostics.debug.presentsRequested = renderer.presentsRequested;
      diagnostics.debug.presentsCompleted = renderer.presentsCompleted;
      diagnostics.performance.gpuMathOps = renderer.gpuMathOps;
      diagnostics.performance.gpuMathArea = renderer.gpuMathArea;
    }
    this.refreshWorkDiagnostics(diagnostics);
    this.refreshDecodeDiagnostics(diagnostics);
  }

  private applySurfaceCreate(event: NativeDisplayEvent) {
    const primary = primarySurfaceSize(event);
    if (!primary) {
      return;
    }
    this.initialDisplayMarked = false;
    this.initialDisplayRevealWorkTarget = null;
    this.renderer?.setCanvasPresentationSuspended(true);
    this.options.setResolution(primary.width, primary.height);
    this.renderer?.resetSurface(primary.width, primary.height);
    this.options.updateStage('display-initialized');
  }

  private applyMonitorsConfig(event: NativeDisplayEvent) {
    const config = monitorConfig(event);
    if (config) {
      this.options.post({ type: 'monitors_config', payload: config });
    }
  }

  private applyReset() {
    this.initialDisplayMarked = false;
    this.initialDisplayRevealWorkTarget = null;
    this.renderer?.setCanvasPresentationSuspended(true);
    this.renderer?.presentClear(0, 0, 0, 1);
    this.options.updateStage('display-authenticated');
  }

  private enqueueCopyBits(event: NativeDisplayEvent) {
    if (event.type !== 'copyBits') {
      return;
    }
    const token = tokenFromNativeValue(event.commitToken);
    if (token === null) {
      this.options.recordUnsupported('copy-bits-invalid-token');
      return;
    }
    this.enqueueWork(
      'gpu-copy-bits',
      token,
      Math.max(0, (event.bbox.right - event.bbox.left) * (event.bbox.bottom - event.bbox.top) * 4),
      () => this.applyCopyBits(event, token),
    );
  }

  private enqueueDraw(event: NativeDisplayEvent) {
    this.stripFence.observeDraw(event);
    this.recordDrawDiagnostics(event);
    const browserJob = browserImageDecodeJob(event);
    if (browserJob) {
      this.enqueueWork(
        browserJob.lane,
        browserJob.commitToken,
        browserJob.byteCost,
        () => this.decodeAndPresentBrowserImage(browserJob),
      );
      return;
    }
    const lzRgbJob = wasmLzRgbDecodeJob(event);
    if (lzRgbJob) {
      this.enqueueWork(
        lzRgbJob.lane,
        lzRgbJob.commitToken,
        lzRgbJob.byteCost,
        () => this.decodeAndPresentWasmLzRgb(lzRgbJob),
      );
      return;
    }
    const binaryJob = wasmBinaryImageDecodeJob(event);
    if (binaryJob) {
      this.enqueueWork(
        binaryJob.lane,
        binaryJob.commitToken,
        binaryJob.byteCost,
        () => this.decodeAndPresentWasmBinaryImage(binaryJob),
      );
      return;
    }
    const bitmapJob = wasmBitmapDecodeJob(event);
    if (bitmapJob) {
      this.enqueueWork(
        bitmapJob.lane,
        bitmapJob.commitToken,
        bitmapJob.byteCost,
        () => this.decodeAndPresentWasmBitmap(bitmapJob),
      );
      return;
    }
    this.options.recordUnsupported(`draw-no-decode:${drawDiagnosticKind(event)}`);
  }

  private enqueueStreamData(event: NativeStreamDataEvent) {
    if (event.codecType !== 1) {
      this.recordStreamDecode(`unsupported-codec-${event.codecType}`);
      this.options.recordUnsupported(`stream-codec-${event.codecType}`);
      return;
    }
    const token = tokenFromNativeValue(event.commitToken);
    const bytes = arrayBufferFromStreamPayload(event.data);
    if (token === null || !bytes) {
      this.recordStreamDecode('invalid-payload');
      this.options.recordUnsupported('stream-frame-invalid-payload');
      return;
    }
    if (this.options.nativeEngine()?.check_visual_token(token) === false) {
      const diagnostics = this.options.diagnostics();
      if (diagnostics) {
        diagnostics.performance.droppedStaleOps += 1;
        diagnostics.performance.canceledDecodeQueuedTasks += 1;
      }
      this.recordStreamApply('stale-before-queue');
      return;
    }
    this.recordStreamDecode(event.type === 'streamDataSized' ? 'fallback-mjpeg-sized' : 'fallback-mjpeg');
    const job: NativeBrowserImageDecodeJob = {
      codec: 'mjpeg',
      bytes,
      byteCost: bytes.byteLength,
      lane: 'stream-mjpeg',
      priority: 0,
      compose: {
        ropDescriptor: 8,
        scaleMode: 0,
        maskPresent: false,
      },
      width: event.width,
      height: event.height,
      bbox: event.dest,
      srcArea: null,
      commitToken: token,
      surfaceId: event.surfaceId,
      surfaceGeneration: event.surfaceGeneration,
    };
    this.enqueueWork(job.lane, job.commitToken, job.byteCost, () =>
      this.decodeAndPresentBrowserImage(job),
    );
  }

  private enqueueWork(
    lane: string,
    commitToken: bigint,
    byteLength: number,
    execute: () => void | Promise<void>,
  ) {
    this.workQueue?.enqueue({
      lane,
      commitToken,
      byteLength,
      isCurrent: () => this.options.nativeEngine()?.check_visual_token(commitToken) === true,
      execute,
      onStale: () => {
        const diagnostics = this.options.diagnostics();
        if (!diagnostics) {
          return;
        }
        diagnostics.performance.droppedStaleOps += 1;
        diagnostics.performance.canceledDecodeQueuedTasks += 1;
      },
    });
    this.refreshDiagnostics();
  }

  private async decodeAndPresentBrowserImage(job: NativeBrowserImageDecodeJob) {
    const nativeEngine = this.options.nativeEngine();
    if (
      !nativeEngine?.check_visual_token(job.commitToken) ||
      !this.decodeBridge ||
      !this.renderer
    ) {
      return;
    }
    const output = await this.decodeBridge.decodeBrowserImage({
      id: Number(job.commitToken),
      codec: job.codec,
      bytes: job.bytes,
      sequenceId: Number(job.commitToken),
      commitToken: job.commitToken,
      surfaceId: job.surfaceId,
      surfaceGeneration: job.surfaceGeneration,
    });
    if (!output) {
      this.recordStreamJobApply(job, 'decode-empty');
      return;
    }
    if (!nativeEngine.check_visual_token(job.commitToken)) {
      this.decodeBridge.noteStaleDrop(output);
      this.decodeBridge.closeOutput(output);
      this.recordStreamJobApply(job, 'stale-after-decode-token');
      return;
    }
    if (!this.renderer.presentExternalImageRect(output, job.width, job.height, job.bbox, job.srcArea, job.compose)) {
      this.options.recordUnsupported('browser-image-present-failed');
      this.decodeBridge.closeOutput(output);
      this.recordStreamJobApply(job, 'present-failed');
      return;
    }
    if (!nativeEngine.commit_visual_token(job.commitToken)) {
      this.decodeBridge.noteStaleDrop(output);
      this.decodeBridge.closeOutput(output);
      this.recordStreamJobApply(job, 'commit-rejected');
      return;
    }
    this.decodeBridge.closeOutput(output);
    this.recordStreamJobApply(job, 'fallback-gpu-external-image');
    this.noteVisualCommit();
  }

  private decodeAndPresentWasmBitmap(job: NativeWasmBitmapDecodeJob) {
    if (!this.options.nativeEngine()?.check_visual_token(job.commitToken) || !this.renderer) {
      return;
    }
    const rgba = this.options.nativeModule()?.bitmap_decode?.(
      job.bytes,
      job.width,
      job.height,
      job.stride,
      job.format,
      job.flags,
    );
    if (!rgba || rgba.byteLength !== job.width * job.height * 4) {
      return;
    }
    this.recordDecodedSample('bitmap', job.width, job.height, rgba);
    this.presentDecodedRgba(job, rgba);
  }

  private decodeAndPresentWasmBinaryImage(job: NativeWasmBinaryImageDecodeJob) {
    if (!this.options.nativeEngine()?.check_visual_token(job.commitToken) || !this.renderer) {
      return;
    }
    const nativeModule = this.options.nativeModule();
    const decode = job.codec === 'quic' ? nativeModule?.quic_decode : nativeModule?.lz4_decode;
    const rgba = decode?.(job.bytes, job.width, job.height);
    if (!rgba || rgba.byteLength !== job.width * job.height * 4) {
      this.options.recordUnsupported(`${job.codec}-decode-empty`);
      return;
    }
    this.recordDecodedSample(job.codec, job.width, job.height, rgba);
    this.presentDecodedRgba(job, rgba);
  }

  private decodeAndPresentWasmLzRgb(job: NativeWasmLzRgbDecodeJob) {
    if (!this.options.nativeEngine()?.check_visual_token(job.commitToken) || !this.renderer) {
      return;
    }
    const rgba = this.options.nativeModule()?.lz_rgb_image_decode?.(job.bytes, job.width, job.height);
    if (!rgba || rgba.byteLength !== job.width * job.height * 4) {
      this.options.recordUnsupported('lz-rgb-decode-empty');
      return;
    }
    this.recordDecodedSample('lzRgb', job.width, job.height, rgba);
    this.presentDecodedRgba(job, rgba);
  }

  private presentDecodedRgba(job: WasmRgbaJob, rgba: Uint8Array) {
    const nativeEngine = this.options.nativeEngine();
    if (!nativeEngine?.check_visual_token(job.commitToken) || !this.renderer) {
      return;
    }
    if (!this.renderer.presentRgbaRect(rgba, job.width, job.height, job.bbox, job.srcArea, job.compose)) {
      this.options.recordUnsupported('wasm-rgba-present-failed');
      return;
    }
    if (!nativeEngine.commit_visual_token(job.commitToken)) {
      return;
    }
    this.noteVisualCommit();
  }

  private applyCopyBits(event: NativeDisplayEvent, token: bigint) {
    const nativeEngine = this.options.nativeEngine();
    if (event.type !== 'copyBits' || !nativeEngine?.check_visual_token(token) || !this.renderer) {
      return;
    }
    if (!this.renderer.copySurfaceRect(event.bbox, event.srcPos)) {
      this.options.recordUnsupported('copy-bits-present-failed');
      return;
    }
    if (!nativeEngine.commit_visual_token(token)) {
      return;
    }
    this.noteVisualCommit();
  }

  private noteVisualCommit() {
    this.stripFence.completeIfIdle();
    this.revealInitialDisplayIfReady();
  }

  private currentWorkPosition() {
    const queue = this.workQueue?.snapshot();
    if (!queue) {
      return 0;
    }
    return queue.completedTasks + queue.activeTasks + queue.queuedTasks;
  }

  private revealInitialDisplayIfReady() {
    if (!this.initialDisplayMarked || this.initialDisplayRevealWorkTarget === null) {
      return;
    }
    const queue = this.workQueue?.snapshot();
    if (!queue || queue.completedTasks < this.initialDisplayRevealWorkTarget) {
      return;
    }
    this.initialDisplayRevealWorkTarget = null;
    this.renderer?.setCanvasPresentationSuspended(false);
    this.options.updateStage('first-frame');
  }

  private recordDrawDiagnostics(event: NativeDisplayEvent) {
    const diagnostics = this.options.diagnostics();
    if (!diagnostics || event.type !== 'draw') {
      return;
    }
    const image = event.image;
    const payload = image?.payload;
    const descriptor = image?.descriptor;
    const kind = typeof event.kind === 'string' ? event.kind : 'unknown';
    diagnostics.debug.drawCopyKinds[kind] =
      (diagnostics.debug.drawCopyKinds[kind] ?? 0) + 1;
    if (typeof event.ropDescriptor === 'number') {
      const key = String(event.ropDescriptor);
      diagnostics.debug.drawCopyRops[key] =
        (diagnostics.debug.drawCopyRops[key] ?? 0) + 1;
    }
    const entry = {
      atMs: performance.now(),
      type: typeof event.messageType === 'number' ? event.messageType : 0,
      kind,
      ropDescriptor: typeof event.ropDescriptor === 'number' ? event.ropDescriptor : null,
      imageDescriptorType: typeof descriptor?.imageType === 'number' ? descriptor.imageType : null,
      bitmapFormat: typeof payload?.format === 'number' ? payload.format : null,
      bitmapFlags: typeof payload?.flags === 'number' ? payload.flags : null,
      imageWidth: typeof descriptor?.width === 'number' ? descriptor.width : null,
      imageHeight: typeof descriptor?.height === 'number' ? descriptor.height : null,
      imageStride: typeof payload?.stride === 'number' ? payload.stride : null,
      lzType: null,
      frameHint: event.frameHint ?? null,
      execution: event.execution ?? null,
      imageDataLength: payload?.data instanceof Uint8Array
        ? payload.data.byteLength
        : Array.isArray(payload?.data)
          ? payload.data.length
          : null,
      box: event.bbox
        ? {
            left: event.bbox.left,
            top: event.bbox.top,
            right: event.bbox.right,
            bottom: event.bbox.bottom,
          }
        : null,
    };
    diagnostics.debug.recentDisplayOps = [
      entry,
      ...diagnostics.debug.recentDisplayOps,
    ].slice(0, 12);
  }

  private recordDecodedSample(codec: string, width: number, height: number, bytes: Uint8Array) {
    const diagnostics = this.options.diagnostics();
    if (!diagnostics) {
      return;
    }
    let checksum = 0;
    let nonZero = 0;
    const length = Math.min(bytes.byteLength, 64);
    for (let index = 0; index < length; index += 1) {
      const value = bytes[index] ?? 0;
      checksum = (checksum + value * (index + 1)) >>> 0;
      if (value !== 0) {
        nonZero += 1;
      }
    }
    diagnostics.debug.lastDecodedSample = {
      codec,
      width,
      height,
      byteLength: bytes.byteLength,
      firstBytesChecksum: checksum,
      firstBytesNonZero: nonZero,
    };
  }

  private refreshWorkDiagnostics(diagnostics: SpiceWorkerDiagnostics) {
    const queue = this.workQueue?.snapshot();
    if (!queue) {
      return;
    }
    diagnostics.performance.activeWorkers = queue.activeTasks;
    diagnostics.performance.peakActiveWorkers = Math.max(
      diagnostics.performance.peakActiveWorkers,
      queue.peakActiveTasks,
    );
    diagnostics.performance.queuedTasks = queue.queuedTasks;
    diagnostics.performance.peakQueuedTasks = Math.max(
      diagnostics.performance.peakQueuedTasks,
      queue.peakQueuedTasks,
    );
    diagnostics.performance.ingressQueueDepth = queue.queuedTasks;
    diagnostics.performance.ingressQueuedBytes = queue.queuedBytes;
    diagnostics.performance.runQueueDepth = queue.queuedTasks;
    diagnostics.performance.peakRunQueueDepth = Math.max(
      diagnostics.performance.peakRunQueueDepth,
      queue.peakQueuedTasks,
    );
    diagnostics.performance.avgQueueAgeMs = queue.avgQueueAgeMs;
    diagnostics.performance.decodeQueueDepths = queue.laneDepths;
    diagnostics.performance.peakDecodeQueueDepths = queue.peakLaneDepths;
    diagnostics.performance.laneDepths = queue.laneDepths;
    diagnostics.performance.canceledDecodeQueuedTasks = Math.max(
      diagnostics.performance.canceledDecodeQueuedTasks,
      queue.staleQueuedDrops,
    );
  }

  private refreshDecodeDiagnostics(diagnostics: SpiceWorkerDiagnostics) {
    const decode = this.decodeBridge?.snapshot();
    if (!decode) {
      return;
    }
    diagnostics.performance.browserCodecSupport = decode.support;
    diagnostics.performance.webCodecsImageDecoderJobs = decode.imageDecoderJobs;
    diagnostics.performance.imageBitmapDecodeJobs = decode.imageBitmapJobs;
    diagnostics.performance.webCodecsVideoDecoderJobs = decode.videoDecoderJobs;
    diagnostics.performance.browserImageDecodeJobs =
      decode.imageDecoderJobs + decode.imageBitmapJobs;
    diagnostics.performance.browserVideoDecodeJobs = decode.videoDecoderJobs;
    diagnostics.performance.browserDecodeFailures = decode.failures;
    diagnostics.performance.browserDecodeStaleDrops = decode.staleDrops;
    diagnostics.performance.browserDecodeClosedOutputs = decode.closedOutputs;
    diagnostics.performance.browserDecodeReadbackFallbacks = decode.readbackFallbacks;
  }

  private createDecodeBridge() {
    return new BrowserDecodeBridge(this.options.capabilityProbe, {
      browserImageDecode: this.toggles.browserImageDecode,
      browserVideoDecode: this.toggles.browserVideoDecode,
      forceWasmDecode: this.toggles.forceWasmDecode,
      disableReadbackFallback: this.toggles.disableReadbackFallback,
    });
  }

  private recordStreamDecode(source: string) {
    const diagnostics = this.options.diagnostics();
    if (!diagnostics) {
      return;
    }
    const sources = diagnostics.performance.streamFrameDecodeSources;
    sources[source] = (sources[source] ?? 0) + 1;
  }

  private recordStreamApply(source: string) {
    const diagnostics = this.options.diagnostics();
    if (!diagnostics) {
      return;
    }
    const sources = diagnostics.performance.streamFrameApplySources;
    sources[source] = (sources[source] ?? 0) + 1;
    if (source === 'fallback-gpu-external-image') {
      diagnostics.performance.streamOrderedApplies += 1;
      diagnostics.performance.qxlBandMode = 'spice-stream';
    }
  }

  private recordStreamJobApply(job: NativeBrowserImageDecodeJob, source: string) {
    if (job.lane !== 'stream-mjpeg') {
      return;
    }
    this.recordStreamApply(source);
  }
}

function tokenFromNativeValue(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  return null;
}

function arrayBufferFromStreamPayload(data: Uint8Array | number[]) {
  if (data instanceof Uint8Array) {
    if (
      data.byteOffset === 0 &&
      data.byteLength === data.buffer.byteLength &&
      data.buffer instanceof ArrayBuffer
    ) {
      return data.buffer;
    }
    return data.slice().buffer;
  }
  if (Array.isArray(data)) {
    return Uint8Array.from(data).buffer;
  }
  return null;
}

function drawDiagnosticKind(event: NativeDisplayEvent) {
  if (event.type !== 'draw') {
    return 'not-draw';
  }
  const kind = typeof event.kind === 'string' ? event.kind : 'unknown';
  const payload = event.image?.payload;
  const payloadKind = typeof payload?.kind === 'string' ? payload.kind : 'no-image';
  const codec = typeof payload?.codec === 'string' ? payload.codec : 'no-codec';
  const imageType =
    typeof event.image?.descriptor?.imageType === 'number'
      ? event.image.descriptor.imageType
      : 'no-type';
  return `${kind}:${payloadKind}:${codec}:${imageType}`;
}

function displayEventShapeSummary(events: unknown[]) {
  const first = events.find((event) => event && typeof event === 'object') as
    | Record<string, unknown>
    | undefined;
  if (!first) {
    return 'empty';
  }
  const keys = Object.keys(first).slice(0, 10).join(',');
  const type = typeof first.type === 'string' ? first.type : 'no-type';
  const tokenType = typeof first.commitToken;
  const surfaceType = typeof first.surfaceId;
  return `${type}:keys=${keys}:token=${tokenType}:surface=${surfaceType}`;
}
