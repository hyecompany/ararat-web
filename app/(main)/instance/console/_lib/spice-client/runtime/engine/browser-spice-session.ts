/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { createDiagnostics, defaultRuntimeToggles } from '../diagnostics.js';
import type {
  SessionControlMessage,
  SessionInitPayload,
  SessionMonitorsConfig,
  SessionStage,
  SessionWorkerOutbound,
  SpiceWorkerDiagnostics,
} from '../messages.js';
import { detectSharedMemoryRuntimeCapability } from '../shared-memory-policy.js';
import { SpiceChannelType } from '../constants.js';
import {
  browserImageDecodeJob,
  monitorConfig,
  nativeDisplayEvents,
  primarySurfaceSize,
  type NativeWasmBitmapDecodeJob,
  type NativeBrowserImageDecodeJob,
  type NativeDisplayEvent,
  wasmBinaryImageDecodeJob,
  wasmBitmapDecodeJob,
  wasmLzRgbDecodeJob,
} from '../display/native-display-events.js';
import { BrowserDecodeBridge } from '../decode/webcodecs-bridge.js';
import { NativeBrowserImageRunBuffer } from '../decode/native-browser-image-run-buffer.js';
import {
  NativeWasmDecodePool,
  type NativeWasmDecodeJob,
  type NativeWasmDecodedImage,
} from '../decode/native-wasm-decode-pool.js';
import { NativeGpuUploadQueue } from '../display/native-gpu-upload-queue.js';
import {
  createNativeSpiceEngine,
  createNativeSpiceRuntime,
  loadSpiceNativeModule,
  type NativeSpiceEngine,
  type SpiceNativeModule,
} from '../native/spice-native.js';
import { encryptSpiceTicket } from '../transport/spice-ticket.js';
import type { RuntimeSpiceChannel, RuntimeSpiceChannelOptions } from '../transport/channel.js';
import { SharedMemoryWebSocketChannel } from '../transport/shared-memory-channel.js';
import { RuntimeWebSocketChannel } from '../transport/websocket-channel.js';
import { BrowserSpiceAudioEvents } from './audio-events.js';
import { BrowserSpiceCursorEvents } from './cursor-events.js';
import { BrowserSpiceDisplayPipeline } from './display-pipeline.js';
import { BrowserSpicePortEvents } from './port-events.js';
import { BrowserSpiceRecordEvents } from './record-events.js';

type WorkerPost = (message: SessionWorkerOutbound, transfer?: Transferable[]) => void;
type NavigatorWithGpu = Navigator & { gpu?: unknown };
const NATIVE_SHARED_RING_TRANSPORT_ACTIVE = true;
const SPICE_BITMAP_FMT_32BIT = 8;
const SPICE_BITMAP_FMT_RGBA = 9;
const SPICE_BITMAP_FLAGS_TOP_DOWN = 4;
const NATIVE_BITMAP_UPLOAD_FLUSH_BATCH = 256;

interface NativeBrowserDecodeQueueItem {
  job: NativeBrowserImageDecodeJob;
  videoLike: boolean;
  coherenceEpoch: number;
  runId?: number;
}

interface NativeBitmapStripFrameEpoch {
  epoch: number;
  minLeft: number;
  maxRight: number;
  lastLeft: number;
  lastRight: number;
  top: number;
  bottom: number;
  lastAtMs: number;
}

export class BrowserSpiceSession {
  private displayPipeline: BrowserSpiceDisplayPipeline | null = null;
  private nativeEngine: NativeSpiceEngine | null = null;
  private nativeModule: SpiceNativeModule | null = null;
  private nativeGraphicsRuntimeActive = false;
  private nativeBrowserDecodeBridge: BrowserDecodeBridge | null = null;
  private nativeWasmDecodePool: NativeWasmDecodePool | null = null;
  private nativeGpuUploadQueue: NativeGpuUploadQueue | null = null;
  private nativeBrowserDecodeInFlight = 0;
  private nativeBrowserDecodeQueue: NativeBrowserDecodeQueueItem[] = [];
  private nativeBrowserDecodeQueuedBytes = 0;
  private nativeBrowserDecodeCoherenceEpoch = 0;
  private nativeGpuUploadCoherenceEpoch = 0;
  private nativeWasmDecodeCoherenceEpoch = 0;
  private nativeBrowserImageRunBuffer: NativeBrowserImageRunBuffer | null = null;
  private nativeBitmapStripFrame: NativeBitmapStripFrameEpoch | null = null;
  private nativeBitmapStripFrameEpoch = 0;
  private nativePresentTimer: number | null = null;
  private nativePresentFirstScheduledAt: number | null = null;
  private nativeBitmapUploadPumpTimer: number | null = null;
  private diagnostics: SpiceWorkerDiagnostics | null = null;
  private toggles = defaultRuntimeToggles();
  private controlSocket: WebSocket | null = null;
  private dataChannels = new Map<string, RuntimeSpiceChannel>();
  private diagnosticsTimer: number | null = null;
  private disposed = false;
  private startedAt = performance.now();
  private sessionId: number | null = null;
  private readonly audioEvents: BrowserSpiceAudioEvents;
  private readonly recordEvents: BrowserSpiceRecordEvents;
  private readonly cursorEvents: BrowserSpiceCursorEvents;
  private readonly portEvents: BrowserSpicePortEvents;

  constructor(
    private readonly payload: SessionInitPayload,
    private readonly post: WorkerPost,
  ) {
    this.toggles = {
      ...this.toggles,
      ...payload.runtimeToggles,
    };
    this.audioEvents = new BrowserSpiceAudioEvents(post);
    this.recordEvents = new BrowserSpiceRecordEvents(post);
    this.cursorEvents = new BrowserSpiceCursorEvents(post);
    this.portEvents = new BrowserSpicePortEvents(post);
  }

  async start() {
    this.startedAt = performance.now();
    const sharedMemory = detectSharedMemoryRuntimeCapability();
    this.diagnostics = createDiagnostics({
      stage: 'connecting-main',
      toggles: this.toggles,
      webgpu: typeof navigator !== 'undefined' && Boolean((navigator as NavigatorWithGpu).gpu),
      webusb: this.payload.webUsbRedirection === true,
      webdav: this.payload.portBridge?.webdav === true,
      sharedMemory: sharedMemory.eligible,
      trace: ['fresh runtime boot'],
    });
    this.diagnostics.performance.sharedMemoryRequested = this.toggles.sharedMemoryBuffers;
    this.diagnostics.performance.sharedMemoryEligible = sharedMemory.eligible;
    this.diagnostics.performance.sharedMemoryEnabled =
      this.sharedMemoryTransportEnabled(sharedMemory);
    this.diagnostics.performance.sharedMemoryDisabledReason = sharedMemoryDisabledReason(
      this.toggles.sharedMemoryBuffers,
      sharedMemory,
    );
    this.nativeModule = await loadSpiceNativeModule();
    this.nativeEngine = await this.createNativeGraphicsRuntime();
    if (this.nativeEngine) {
      this.diagnostics.performance.nativeDecodeReady = true;
      if (this.nativeGraphicsRuntimeActive) {
        this.diagnostics.backend = 'native-wasm/wgpu-rs';
        this.diagnostics.rendering.compositorBackend = 'native-wgpu-rs';
        this.diagnostics.rendering.details =
          'Rust/WASM SPICE runtime owns protocol, decode commit checks, and wgpu presentation.';
        this.diagnostics.displayStack.evidence.push('Rust/wgpu SpiceNativeRuntime loaded');
        this.resetNativeBrowserDecodeBridge();
        this.resetNativeWasmDecodePool();
        this.resetNativeGpuUploadQueue();
      } else {
        this.diagnostics.displayStack.evidence.push('WASM SpiceEngine loaded');
      }
    } else {
      await this.initializeFallbackDisplayPipeline();
      this.nativeEngine = await createNativeSpiceEngine();
      if (this.nativeEngine) {
        this.diagnostics.performance.nativeDecodeReady = true;
        this.diagnostics.displayStack.evidence.push(
          'WASM SpiceEngine loaded with TS renderer fallback',
        );
      } else {
        this.diagnostics.displayStack.evidence.push('WASM SpiceEngine pending');
      }
    }
    this.displayPipeline?.refreshDiagnostics();
    this.publishDiagnostics();

    this.openControlSocket();
    this.openMainSocket();
    this.post({
      type: 'webusb_status',
      payload: {
        available: false,
        enabled: this.payload.webUsbRedirection === true,
        attached: false,
        devices: [],
        message:
          this.payload.webUsbRedirection === true
            ? 'WebUSB exists, but SPICE usbredir bridging is not implemented yet.'
            : null,
      },
    });
    this.post({ type: 'ready' });
    this.startDiagnosticsTimer();
  }

  handleControl(message: SessionControlMessage) {
    if (this.disposed) {
      return;
    }

    const controlEvents = this.nativeEngine?.control(message);
    this.applyNativeControlEvents(controlEvents);
    if (!this.diagnostics) {
      return;
    }

    switch (message.type) {
      case 'resize':
        this.setResolution(message.payload.width, message.payload.height);
        this.sendConsoleControlResize(message.payload.width, message.payload.height);
        break;
      case 'key':
        if (message.payload.down) {
          this.diagnostics.performance.inputKeyDownSends += 1;
        } else {
          this.diagnostics.performance.inputKeyUpSends += 1;
        }
        break;
      case 'mouse_button':
        this.diagnostics.performance.inputMouseButtonSends += 1;
        break;
      case 'runtime_toggles':
        this.toggles = { ...this.toggles, ...message.payload };
        this.nativeEngine?.setRawBitmapCoalesceMode?.(this.toggles.rawBitmapCoalesce === true);
        if (this.nativeGraphicsRuntimeActive) {
          this.resetNativeBrowserDecodeBridge();
        }
        {
          const sharedMemory = detectSharedMemoryRuntimeCapability();
          this.diagnostics.performance.sharedMemoryEligible = sharedMemory.eligible;
          this.diagnostics.performance.sharedMemoryEnabled =
            this.sharedMemoryTransportEnabled(sharedMemory);
          this.diagnostics.performance.sharedMemoryDisabledReason = sharedMemoryDisabledReason(
            this.toggles.sharedMemoryBuffers,
            sharedMemory,
          );
        }
        this.diagnostics.performance.sharedMemoryRequested = this.toggles.sharedMemoryBuffers;
        this.displayPipeline?.updateToggles(this.toggles);
        break;
      case 'webusb_attach':
        this.post({
          type: 'webusb_status',
          payload: {
            available: true,
            enabled: true,
            attached: false,
            devices: [message.payload],
            message:
              'WebUSB permission granted; SPICE usbredir protocol bridge is not implemented yet.',
          },
        });
        break;
    }
  }

  dispose() {
    this.disposed = true;
    if (this.diagnosticsTimer !== null) {
      clearInterval(this.diagnosticsTimer);
      this.diagnosticsTimer = null;
    }
    if (this.nativePresentTimer !== null) {
      clearTimeout(this.nativePresentTimer);
      this.nativePresentTimer = null;
    }
    if (this.nativeBitmapUploadPumpTimer !== null) {
      clearTimeout(this.nativeBitmapUploadPumpTimer);
      this.nativeBitmapUploadPumpTimer = null;
    }
    this.nativePresentFirstScheduledAt = null;
    for (const channel of this.dataChannels.values()) {
      channel.dispose();
    }
    this.dataChannels.clear();
    if (this.controlSocket && this.controlSocket.readyState < WebSocket.CLOSING) {
      this.controlSocket.close(1000, 'SPICE client disposed');
    }
    this.controlSocket = null;
    this.displayPipeline?.dispose();
    this.displayPipeline = null;
    this.nativeBrowserImageRunBuffer?.dispose();
    this.nativeBrowserImageRunBuffer = null;
    this.nativeGpuUploadQueue?.dispose();
    this.nativeGpuUploadQueue = null;
    this.nativeWasmDecodePool?.dispose();
    this.nativeWasmDecodePool = null;
    this.nativeEngine?.dispose();
    this.nativeEngine = null;
    this.nativeModule = null;
    this.nativeGraphicsRuntimeActive = false;
    this.nativeBrowserDecodeBridge = null;
    this.nativeBrowserDecodeQueue = [];
    this.nativeBrowserDecodeQueuedBytes = 0;
    this.nativeBrowserDecodeInFlight = 0;
    this.nativeBitmapStripFrame = null;
    this.nativeBitmapStripFrameEpoch = 0;
    this.nativeGpuUploadCoherenceEpoch = 0;
    this.nativeWasmDecodeCoherenceEpoch = 0;
    this.portEvents.clear();
    this.post({ type: 'disposed' });
  }

  private async createNativeGraphicsRuntime() {
    if (
      this.payload.backendPolicy?.disableWebGpu ||
      this.payload.capabilityProbe?.webgpu === false
    ) {
      return null;
    }
    const runtime = await createNativeSpiceRuntime(
      this.payload.canvas,
      this.payload.canvas.width || 1024,
      this.payload.canvas.height || 768,
    );
    runtime?.setRawBitmapCoalesceMode?.(this.toggles.rawBitmapCoalesce === true);
    this.nativeGraphicsRuntimeActive = runtime !== null;
    return runtime;
  }

  private async initializeFallbackDisplayPipeline() {
    this.nativeGraphicsRuntimeActive = false;
    this.displayPipeline = new BrowserSpiceDisplayPipeline({
      canvas: this.payload.canvas,
      capabilityProbe: this.payload.capabilityProbe,
      backendPolicy: this.payload.backendPolicy,
      toggles: this.toggles,
      post: this.post,
      nativeEngine: () => this.nativeEngine,
      nativeModule: () => this.nativeModule,
      diagnostics: () => this.diagnostics,
      setResolution: (width, height) => this.setResolution(width, height),
      updateStage: (stage) => this.updateStage(stage),
      recordUnsupported: (reason) => this.recordUnsupported(reason),
    });
    await this.displayPipeline.initialize();
  }

  private createNativeBrowserDecodeBridge() {
    return new BrowserDecodeBridge(this.payload.capabilityProbe, {
      browserImageDecode: this.toggles.browserImageDecode,
      browserVideoDecode: this.toggles.browserVideoDecode,
      forceWasmDecode: this.toggles.forceWasmDecode,
      disableReadbackFallback: this.toggles.disableReadbackFallback,
      preferImageBitmap: true,
    });
  }

  private resetNativeBrowserDecodeBridge() {
    this.nativeBrowserImageRunBuffer?.dispose();
    this.nativeBrowserDecodeBridge = this.createNativeBrowserDecodeBridge();
    this.nativeBrowserImageRunBuffer = new NativeBrowserImageRunBuffer({
      minQuietMs: 10,
      maxRunMs: 36,
      maxBufferedDecodedBytes: 96 * 1024 * 1024,
      closeOutput: (output) => this.nativeBrowserDecodeBridge?.closeOutput(output),
      checkToken: (job) => this.nativeEngine?.check_visual_token(job.commitToken) === true,
      upload: (job, output) => this.uploadNativeBrowserImage(job, output),
      present: () => this.scheduleNativePresent(24, true),
      onDrop: (_reason, itemCount) => {
        this.diagnostics!.performance.canceledDecodeQueuedTasks += itemCount;
        this.diagnostics!.performance.droppedStaleOps += itemCount;
      },
      onStale: (itemCount) => {
        this.diagnostics!.performance.browserDecodeStaleDrops += itemCount;
        this.diagnostics!.performance.droppedStaleOps += itemCount;
      },
      onFlush: (itemCount) => {
        this.diagnostics!.performance.qxlBandsFlushed += 1;
        this.diagnostics!.performance.qxlBandItems += itemCount;
        this.diagnostics!.performance.qxlBandMaxSize = Math.max(
          this.diagnostics!.performance.qxlBandMaxSize,
          itemCount,
        );
      },
    });
  }

  private resetNativeWasmDecodePool() {
    this.nativeWasmDecodePool?.dispose();
    this.nativeWasmDecodePool = new NativeWasmDecodePool();
    this.diagnostics?.displayStack.evidence.push('Native WASM decode worker pool active');
  }

  private resetNativeGpuUploadQueue() {
    this.nativeGpuUploadQueue?.dispose();
    this.nativeGpuUploadQueue = new NativeGpuUploadQueue({
      maxQueuedBytes: 192 * 1024 * 1024,
    });
    this.diagnostics?.displayStack.evidence.push('Native GPU upload queue active');
  }

  private openMainSocket() {
    const mainUrl = this.payload.websockets['0'];
    if (!mainUrl) {
      this.recordUnsupported('missing-main-websocket');
      return;
    }
    const channel = this.createRuntimeChannel({
      key: 'main:0',
      url: mainUrl,
      onOpen: () => {
        this.setChannel('main', true);
        const link = this.nativeEngine?.open_channel('main:0', SpiceChannelType.MAIN, 0, 0);
        if (link) {
          channel.send(link);
        }
      },
      onClose: () => this.setChannel('main', false),
      onError: (_key, message) => this.recordUnsupported(message),
      onBytes: (key, bytes, backing) => {
        this.observeIngress(bytes.byteLength, backing);
        const events = this.nativeEngine?.ingest_channel_bytes(key, bytes);
        this.applyNativeEvents(key, events);
        this.scheduleNativeBitmapUploadPump();
      },
    });
    this.dataChannels.set('main:0', channel);
    channel.connect();
  }

  private openControlSocket() {
    const controlUrl = this.payload.websockets.control;
    if (!controlUrl) {
      return;
    }
    const socket = new WebSocket(controlUrl);
    this.controlSocket = socket;
    socket.onopen = () => this.setChannel('control', true);
    socket.onclose = () => this.setChannel('control', false);
  }

  private sendConsoleControlResize(width: number, height: number) {
    if (!this.controlSocket || this.controlSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.controlSocket.send(
      JSON.stringify({
        type: 'window-resize',
        metadata: { width, height },
      }),
    );
  }

  private setResolution(width: number, height: number) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    if (this.payload.canvas.width !== safeWidth || this.payload.canvas.height !== safeHeight) {
      this.payload.canvas.width = safeWidth;
      this.payload.canvas.height = safeHeight;
    }
    if (this.nativeGraphicsRuntimeActive) {
      try {
        this.nativeEngine?.resizeNative?.(safeWidth, safeHeight);
      } catch {
        this.recordUnsupported('native-resize-failed');
      }
    } else {
      this.displayPipeline?.resize(safeWidth, safeHeight);
    }
    this.post({ type: 'resolution', payload: { width: safeWidth, height: safeHeight } });
    const monitors: SessionMonitorsConfig = {
      count: 1,
      maxAllowed: 1,
      origin: { x: 0, y: 0 },
      width: safeWidth,
      height: safeHeight,
      heads: [
        {
          monitorId: 0,
          surfaceId: 0,
          width: safeWidth,
          height: safeHeight,
          x: 0,
          y: 0,
          flags: 0,
        },
      ],
    };
    this.post({ type: 'monitors_config', payload: monitors });
  }

  private updateStage(stage: SessionStage) {
    if (!this.diagnostics) {
      return;
    }
    this.diagnostics.session.stage = stage;
    if (stage === 'first-frame' && this.diagnostics.performance.firstFrameMs === null) {
      this.diagnostics.performance.firstFrameMs = performance.now() - this.startedAt;
      this.diagnostics.displayStack.graphicsPath = 'spice-surface';
    }
    this.publishDiagnostics();
  }

  private setChannel(channel: keyof SpiceWorkerDiagnostics['session']['channels'], open: boolean) {
    if (!this.diagnostics) {
      return;
    }
    this.diagnostics.session.channels[channel] = open;
    this.publishDiagnostics();
  }

  private createRuntimeChannel(options: RuntimeSpiceChannelOptions): RuntimeSpiceChannel {
    if (this.sharedMemoryTransportEnabled()) {
      return new SharedMemoryWebSocketChannel(options);
    }
    return new RuntimeWebSocketChannel(options);
  }

  private sharedMemoryTransportEnabled(capability = detectSharedMemoryRuntimeCapability()) {
    return (
      this.toggles.sharedMemoryBuffers && capability.eligible && NATIVE_SHARED_RING_TRANSPORT_ACTIVE
    );
  }

  private observeIngress(bytes: number, backing: ArrayBuffer | SharedArrayBuffer) {
    if (!this.diagnostics) {
      return;
    }
    const sharedBody =
      typeof SharedArrayBuffer !== 'undefined' && backing instanceof SharedArrayBuffer;
    this.diagnostics.performance.ingressPacketsConsumed += 1;
    this.diagnostics.performance.ingressBytesConsumed += bytes;
    if (sharedBody) {
      this.diagnostics.performance.sharedMemoryBodies += 1;
      this.diagnostics.performance.sharedMemoryBodyBytes += bytes;
      this.diagnostics.performance.sharedDecodeBufferRequests += 1;
      this.diagnostics.performance.sharedDecodeBufferBytes += bytes;
    } else if (this.toggles.sharedMemoryBuffers) {
      this.diagnostics.performance.sharedMemoryFallbackCopies += 1;
      this.diagnostics.performance.packetCopiedBodyBytes += bytes;
    } else {
      this.diagnostics.performance.packetCopiedBodyBytes += bytes;
    }
  }

  private applyNativeEvents(channelKey: string, events: unknown) {
    if (!events || !this.diagnostics) {
      return;
    }
    if (typeof events === 'object') {
      const outbound = (events as { outbound?: unknown }).outbound;
      if (Array.isArray(outbound)) {
        const channel = this.dataChannels.get(channelKey);
        for (const packet of outbound) {
          const bytes = bytesFromNativeValue(packet);
          if (bytes) {
            channel?.send(bytes);
          }
        }
      }
      const ticketPublicKeys = (events as { ticketPublicKeys?: unknown }).ticketPublicKeys;
      if (Array.isArray(ticketPublicKeys)) {
        for (const publicKey of ticketPublicKeys) {
          const bytes = bytesFromNativeValue(publicKey);
          if (bytes) {
            void this.sendEncryptedTicket(
              channelKey,
              bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
            );
          }
        }
      }
      const readyChannels = (events as { readyChannels?: unknown }).readyChannels;
      if (Array.isArray(readyChannels) && readyChannels.includes(channelKey)) {
        if (channelKey === 'main:0') {
          this.updateStage('main-authenticated');
        } else {
          this.setChannelForKey(channelKey, true);
        }
      }
      const sessionUpdate = (events as { sessionUpdate?: unknown }).sessionUpdate;
      if (sessionUpdate && typeof sessionUpdate === 'object') {
        this.applySessionUpdate(sessionUpdate as Record<string, unknown>);
      }
      const rawDisplayEvents = (events as { displayEvents?: unknown }).displayEvents;
      const displayEvents = nativeDisplayEvents(rawDisplayEvents);
      if (Array.isArray(rawDisplayEvents) && displayEvents.length !== rawDisplayEvents.length) {
        this.recordDisplayEventFilter(rawDisplayEvents, displayEvents.length);
      }
      for (const event of displayEvents) {
        this.applyDisplayEvent(event);
      }
      const audioEvents = (events as { audioEvents?: unknown }).audioEvents;
      if (Array.isArray(audioEvents)) {
        for (const event of audioEvents) {
          this.audioEvents.apply(event, this.diagnostics);
        }
      }
      const recordEvents = (events as { recordEvents?: unknown }).recordEvents;
      if (Array.isArray(recordEvents)) {
        for (const event of recordEvents) {
          this.recordEvents.apply(event, this.diagnostics);
        }
      }
      const cursorEvents = (events as { cursorEvents?: unknown }).cursorEvents;
      if (Array.isArray(cursorEvents)) {
        for (const event of cursorEvents) {
          this.cursorEvents.apply(event);
        }
      }
      const portEvents = (events as { portEvents?: unknown }).portEvents;
      if (Array.isArray(portEvents)) {
        for (const event of portEvents) {
          this.portEvents.apply(event);
        }
      }
      const channelsToOpen = (events as { channelsToOpen?: unknown }).channelsToOpen;
      if (Array.isArray(channelsToOpen)) {
        for (const descriptor of channelsToOpen) {
          if (
            descriptor &&
            typeof descriptor === 'object' &&
            typeof (descriptor as { channelType?: unknown }).channelType === 'number' &&
            typeof (descriptor as { channelId?: unknown }).channelId === 'number'
          ) {
            this.openSpiceChannel(
              (descriptor as { channelType: number }).channelType,
              (descriptor as { channelId: number }).channelId,
            );
          }
        }
        if (channelsToOpen.length > 0) {
          this.updateStage('channels-list');
        }
      }
    }
    const nativeDiagnostics = this.nativeEngine?.diagnostics();
    if (nativeDiagnostics && typeof nativeDiagnostics === 'object') {
      this.mergeNativeDiagnostics(nativeDiagnostics as Record<string, unknown>);
    }
  }

  private applyDisplayEvent(event: NativeDisplayEvent) {
    if (this.displayPipeline) {
      this.displayPipeline.apply(event);
      return;
    }
    this.applyNativeGraphicsDisplayEvent(event);
  }

  private recordDisplayEventFilter(rawDisplayEvents: unknown[], accepted: number) {
    if (this.displayPipeline) {
      this.displayPipeline.recordEventFilter(rawDisplayEvents, accepted);
      return;
    }
    if (!this.diagnostics) {
      return;
    }
    const reason =
      `accepted:${accepted}/${rawDisplayEvents.length}:` +
      rawDisplayEvents
        .map((event) =>
          event && typeof event === 'object'
            ? String((event as { type?: unknown }).type ?? 'object')
            : typeof event,
        )
        .join(',');
    this.diagnostics.debug.displayEventFilters[reason] =
      (this.diagnostics.debug.displayEventFilters[reason] ?? 0) + 1;
    this.recordUnsupported(`display-event-filtered:${reason}`);
  }

  private applyNativeGraphicsDisplayEvent(event: NativeDisplayEvent) {
    if (!this.diagnostics) {
      return;
    }
    this.diagnostics.debug.displayPackets[event.type] =
      (this.diagnostics.debug.displayPackets[event.type] ?? 0) + 1;
    switch (event.type) {
      case 'mode':
        this.setResolution(event.width, event.height);
        this.updateStage('display-initialized');
        break;
      case 'surfaceCreate': {
        const primary = primarySurfaceSize(event);
        if (primary) {
          this.setResolution(primary.width, primary.height);
          this.updateStage('display-initialized');
        }
        break;
      }
      case 'monitorsConfig': {
        const config = monitorConfig(event);
        if (config) {
          this.post({ type: 'monitors_config', payload: config });
        }
        break;
      }
      case 'reset':
        this.updateStage('display-authenticated');
        break;
      case 'mark':
        this.updateStage('first-frame');
        break;
      case 'streamCreate':
      case 'streamDestroy':
      case 'streamDestroyAll':
        this.finishNativeBitmapStripFrame();
        break;
      case 'streamClip':
        this.recordUnsupported('stream-clip-not-applied');
        this.finishNativeBitmapStripFrame();
        break;
      case 'streamActivateReport':
        this.recordUnsupported('stream-report-disabled-unexpected-activate');
        this.finishNativeBitmapStripFrame();
        break;
      case 'nativeGpuCommit':
        this.applyNativeGpuCommit(event);
        break;
      default:
        if (this.enqueueNativeStreamDecode(event)) {
          break;
        }
        if (this.enqueueNativeBrowserImageDecode(event)) {
          break;
        }
        if (this.enqueueNativeBitmapGpuUpload(event)) {
          break;
        }
        if (this.enqueueNativeWasmDecode(event)) {
          break;
        }
        this.finishNativeBitmapStripFrame();
        break;
    }
  }

  private enqueueNativeBrowserImageDecode(event: NativeDisplayEvent) {
    const job = browserImageDecodeJob(event);
    if (!job) {
      return false;
    }
    if (event.type === 'draw' && event.frameHint?.kind === 'bitmapStrip') {
      const frame = this.nativeBitmapStripFrameForEvent(event);
      if (frame) {
        const runEpoch = frame.epoch;
        this.nativeBrowserDecodeCoherenceEpoch = Math.max(
          this.nativeBrowserDecodeCoherenceEpoch,
          runEpoch,
        );
        if (frame.startsFrame) {
          this.nativeBrowserImageRunBuffer?.beginRun(runEpoch, {
            flushActiveIfComplete: true,
          });
          this.dropQueuedVideoLikeBrowserDecodes(runEpoch);
        }
        this.enqueueNativeBrowserImageJob(job, {
          videoLike: true,
          coherenceEpoch: runEpoch,
          runId: runEpoch,
        });
        return true;
      }
    }
    this.finishNativeBitmapStripFrame();
    this.enqueueNativeBrowserImageJob(job);
    return true;
  }

  private enqueueNativeStreamDecode(event: NativeDisplayEvent) {
    if (event.type !== 'streamData' && event.type !== 'streamDataSized') {
      return false;
    }
    if (event.codecType !== 1) {
      this.noteStreamDecode(`unsupported-codec-${event.codecType}`);
      this.recordUnsupported(`stream-codec-${event.codecType}`);
      return true;
    }
    const token = bigintFromNativeValue(event.commitToken);
    const bytes = bytesFromNativeValue(event.data);
    if (token === null || !bytes) {
      this.noteStreamDecode('invalid-payload');
      this.recordUnsupported('stream-frame-invalid-payload');
      return true;
    }
    const data = arrayBufferFromNativeBytes(bytes);
    this.noteStreamDecode(event.type === 'streamDataSized' ? 'native-mjpeg-sized' : 'native-mjpeg');
    this.enqueueNativeBrowserImageJob(
      {
        codec: 'mjpeg',
        bytes: data,
        byteCost: data.byteLength,
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
      },
      { videoLike: true },
    );
    return true;
  }

  private enqueueNativeBitmapGpuUpload(event: NativeDisplayEvent) {
    const job = wasmBitmapDecodeJob(event);
    if (!job || !this.canUploadNativeBitmapOnGpu(job)) {
      return false;
    }
    const engine = this.nativeEngine;
    if (!engine?.check_visual_token(job.commitToken)) {
      if (event.type !== 'draw' || event.frameHint?.kind !== 'bitmapStrip') {
        this.finishNativeBitmapStripFrame();
      }
      return true;
    }
    if (!this.nativeGpuUploadQueue) {
      this.resetNativeGpuUploadQueue();
    }

    let videoLike = this.isVideoLikeBitmapGpuJob(job, event);
    let coherenceEpoch = this.nativeGpuUploadCoherenceEpoch;
    if (event.type === 'draw' && event.frameHint?.kind === 'bitmapStrip') {
      const frame = this.nativeBitmapStripFrameForEvent(event);
      if (frame) {
        videoLike = true;
        coherenceEpoch = frame.epoch;
        this.nativeGpuUploadCoherenceEpoch = Math.max(
          this.nativeGpuUploadCoherenceEpoch,
          coherenceEpoch,
        );
        if (frame.startsFrame) {
          this.nativeGpuUploadQueue?.dropVideoLikeBefore(coherenceEpoch);
          this.cancelVideoLikeNativeWasmDecodes(coherenceEpoch);
        }
      }
    } else {
      this.finishNativeBitmapStripFrame();
      if (videoLike) {
        coherenceEpoch = this.nativeGpuUploadCoherenceEpoch + 1;
        this.nativeGpuUploadCoherenceEpoch = coherenceEpoch;
        this.nativeGpuUploadQueue?.dropVideoLikeBefore(coherenceEpoch);
        this.cancelVideoLikeNativeWasmDecodes(coherenceEpoch);
      }
    }

    const expectedEpoch = coherenceEpoch;
    this.nativeGpuUploadQueue?.enqueue({
      lane: 'gpu-bitmap-upload',
      priority: job.priority,
      byteCost: job.byteCost,
      videoLike,
      coherenceEpoch: expectedEpoch,
      isStillWanted: () =>
        this.nativeEngine?.check_visual_token(job.commitToken) === true &&
        (!videoLike || expectedEpoch === this.nativeGpuUploadCoherenceEpoch),
      run: () => this.uploadNativeBitmapGpuImage(job),
      onCommitted: () => this.scheduleNativePresent(videoLike ? 10 : 4, videoLike),
      onStale: () => {
        this.diagnostics!.performance.canceledDecodeQueuedTasks += 1;
        this.diagnostics!.performance.droppedStaleOps += 1;
      },
      onFailure: () => {
        this.diagnostics!.performance.browserDecodeFailures += 1;
        this.recordUnsupported('native-bitmap-gpu-upload-rejected');
      },
    });
    return true;
  }

  private applyNativeGpuCommit(event: NativeDisplayEvent) {
    if (event.type !== 'nativeGpuCommit') {
      return;
    }
    const area = rectArea(event.bbox);
    this.diagnostics!.performance.directPrimaryUploadCount += 1;
    this.diagnostics!.performance.directPrimaryUploadArea += area;
    this.diagnostics!.performance.gpuPixelEffectCount += 1;
    this.diagnostics!.performance.gpuComputeArea += area;
    const sources = this.diagnostics!.performance.streamFrameApplySources;
    sources.nativeGpuBitmap = (sources.nativeGpuBitmap ?? 0) + 1;
    if (event.videoLike === true) {
      this.diagnostics!.performance.qxlBandMode = 'qxl-bitmap-video';
      this.diagnostics!.performance.qxlBandBitmapStripSamples += 1;
    }
    this.finishNativeBitmapStripFrame();
    if (event.presented === true) {
      return;
    }
    this.scheduleNativePresent(event.videoLike === true ? 10 : 4, event.videoLike === true);
  }

  private canUploadNativeBitmapOnGpu(job: NativeWasmBitmapDecodeJob) {
    if (!this.nativeGraphicsRuntimeActive || !this.nativeEngine?.uploadBitmapAndCommit) {
      return false;
    }
    if (job.surfaceId !== 0) {
      return false;
    }
    if (job.compose?.maskPresent === true) {
      return false;
    }
    return job.format === SPICE_BITMAP_FMT_32BIT || job.format === SPICE_BITMAP_FMT_RGBA;
  }

  private enqueueNativeWasmDecode(event: NativeDisplayEvent) {
    const job = nativeWasmDecodeJob(event);
    if (!job) {
      return false;
    }
    const engine = this.nativeEngine;
    if (!engine?.check_visual_token(job.commitToken)) {
      if (event.type !== 'draw' || event.frameHint?.kind !== 'bitmapStrip') {
        this.finishNativeBitmapStripFrame();
      }
      return true;
    }
    if (!this.nativeGraphicsRuntimeActive || !engine.uploadRgbaAndCommit) {
      this.recordUnsupported('native-wasm-decode-upload-unavailable');
      return true;
    }
    if (!this.nativeWasmDecodePool) {
      this.resetNativeWasmDecodePool();
    }
    let videoLike = this.isVideoLikeWasmJob(job);
    if (event.type === 'draw' && event.frameHint?.kind === 'bitmapStrip') {
      const frame = this.nativeBitmapStripFrameForEvent(event);
      if (frame) {
        videoLike = true;
        job.videoLike = true;
        job.coherenceEpoch = frame.epoch;
        this.nativeWasmDecodeCoherenceEpoch = Math.max(
          this.nativeWasmDecodeCoherenceEpoch,
          frame.epoch,
        );
        if (frame.startsFrame) {
          this.cancelVideoLikeNativeWasmDecodes(frame.epoch);
        }
      }
    } else if (videoLike) {
      const coherenceEpoch = this.nativeWasmDecodeCoherenceEpoch + 1;
      this.nativeWasmDecodeCoherenceEpoch = coherenceEpoch;
      job.videoLike = true;
      job.coherenceEpoch = coherenceEpoch;
      this.cancelVideoLikeNativeWasmDecodes(coherenceEpoch);
    }
    void this.nativeWasmDecodePool
      ?.decode(job, () => {
        if (this.nativeEngine?.check_visual_token(job.commitToken) !== true) {
          return false;
        }
        if (job.videoLike && job.coherenceEpoch !== this.nativeWasmDecodeCoherenceEpoch) {
          return false;
        }
        return true;
      })
      .then((decoded) => {
        if (!this.nativeEngine?.check_visual_token(job.commitToken)) {
          this.diagnostics!.performance.canceledDecodeInFlightTasks += 1;
          return;
        }
        if (!this.uploadNativeWasmDecodedImage(job, decoded)) {
          this.diagnostics!.performance.browserDecodeStaleDrops += 1;
          return;
        }
        this.scheduleNativePresent(videoLike ? 10 : 4, videoLike);
      })
      .catch((error) => {
        if (
          error instanceof Error &&
          (error.message.includes('canceled') || error.message.includes('stale'))
        ) {
          return;
        }
        if (this.nativeEngine?.check_visual_token(job.commitToken)) {
          this.diagnostics!.performance.browserDecodeFailures += 1;
        }
      });
    return true;
  }

  private uploadNativeBitmapGpuImage(job: NativeWasmBitmapDecodeJob) {
    const engine = this.nativeEngine;
    if (!engine?.uploadBitmapAndCommit) {
      return false;
    }
    const source = job.srcArea ?? {
      left: 0,
      top: 0,
      right: job.width,
      bottom: job.height,
    };
    const compose = job.compose ?? {};
    return engine.uploadBitmapAndCommit(
      job.commitToken,
      job.bytes,
      job.width,
      job.height,
      job.stride,
      job.format,
      job.flags | (job.format === SPICE_BITMAP_FMT_RGBA ? SPICE_BITMAP_FLAGS_TOP_DOWN : 0),
      job.bbox.left,
      job.bbox.top,
      job.bbox.right,
      job.bbox.bottom,
      source.left,
      source.top,
      source.right,
      source.bottom,
      compose.ropDescriptor ?? 8,
      compose.scaleMode ?? 0,
      false,
      false,
    );
  }

  private uploadNativeWasmDecodedImage(job: NativeWasmDecodeJob, decoded: NativeWasmDecodedImage) {
    const engine = this.nativeEngine;
    if (!engine?.uploadRgbaAndCommit) {
      return false;
    }
    const source = job.srcArea ?? {
      left: 0,
      top: 0,
      right: decoded.width,
      bottom: decoded.height,
    };
    const compose = job.compose ?? {};
    return engine.uploadRgbaAndCommit(
      job.commitToken,
      decoded.rgba,
      decoded.width,
      decoded.height,
      job.bbox.left,
      job.bbox.top,
      job.bbox.right,
      job.bbox.bottom,
      source.left,
      source.top,
      source.right,
      source.bottom,
      compose.ropDescriptor ?? 8,
      compose.scaleMode ?? 0,
      compose.maskPresent === true,
      false,
    );
  }

  private nativeBitmapStripFrameForEvent(event: NativeDisplayEvent) {
    if (event.type !== 'draw' || event.frameHint?.kind !== 'bitmapStrip') {
      return null;
    }
    const bbox = event.bbox;
    const now = performance.now();
    const active = this.nativeBitmapStripFrame;
    const startsFrame =
      !active ||
      now - active.lastAtMs > 45 ||
      Math.abs(bbox.top - active.top) > 24 ||
      Math.abs(bbox.bottom - active.bottom) > 24 ||
      bbox.left < active.lastLeft - 32;
    const epoch = startsFrame ? this.nativeBitmapStripFrameEpoch + 1 : active.epoch;
    if (startsFrame) {
      this.nativeBitmapStripFrameEpoch = epoch;
      this.diagnostics!.performance.qxlBandsStarted += 1;
      this.diagnostics!.performance.qxlBandMode = 'qxl-bitmap-video';
    }
    this.nativeBitmapStripFrame = {
      epoch,
      minLeft: active && active.epoch === epoch ? Math.min(active.minLeft, bbox.left) : bbox.left,
      maxRight:
        active && active.epoch === epoch ? Math.max(active.maxRight, bbox.right) : bbox.right,
      lastLeft: bbox.left,
      lastRight: bbox.right,
      top: bbox.top,
      bottom: bbox.bottom,
      lastAtMs: now,
    };
    return { epoch, startsFrame };
  }

  private finishNativeBitmapStripFrame() {
    if (!this.nativeBitmapStripFrame) {
      return;
    }
    this.nativeBrowserImageRunBuffer?.finishActiveRun();
    this.nativeBitmapStripFrame = null;
  }

  private enqueueNativeBrowserImageJob(
    job: NativeBrowserImageDecodeJob,
    options: { coherenceEpoch?: number; runId?: number; videoLike?: boolean } = {},
  ) {
    if (!this.nativeGraphicsRuntimeActive || !this.nativeEngine?.uploadExternalImageAndCommit) {
      return;
    }
    if (!this.nativeEngine.check_visual_token(job.commitToken)) {
      this.diagnostics!.performance.droppedStaleOps += 1;
      return;
    }
    const maxQueuedBytes = 96 * 1024 * 1024;
    if (this.nativeBrowserDecodeQueuedBytes + job.byteCost > maxQueuedBytes) {
      this.nativeBrowserImageRunBuffer?.noteItemCanceled(options.runId);
      this.diagnostics!.performance.canceledDecodeQueuedTasks += 1;
      this.diagnostics!.performance.droppedStaleOps += 1;
      return;
    }
    const videoLike = options.videoLike ?? this.isVideoLikeBrowserJob(job);
    const coherenceEpoch =
      options.coherenceEpoch ??
      (videoLike
        ? this.nativeBrowserDecodeCoherenceEpoch + 1
        : this.nativeBrowserDecodeCoherenceEpoch);
    if (videoLike) {
      this.nativeBrowserDecodeCoherenceEpoch = coherenceEpoch;
      this.dropQueuedVideoLikeBrowserDecodes(coherenceEpoch);
    }
    if (options.runId !== undefined) {
      this.nativeBrowserImageRunBuffer?.expectItem(options.runId);
    }
    this.nativeBrowserDecodeQueue.push({
      job,
      videoLike,
      coherenceEpoch,
      runId: options.runId,
    });
    this.nativeBrowserDecodeQueuedBytes += job.byteCost;
    this.pumpNativeBrowserDecodeQueue();
  }

  private pumpNativeBrowserDecodeQueue() {
    if (this.disposed || !this.nativeBrowserDecodeBridge || !this.nativeEngine) {
      return;
    }
    const maxConcurrent = 4;
    while (
      this.nativeBrowserDecodeInFlight < maxConcurrent &&
      this.nativeBrowserDecodeQueue.length > 0
    ) {
      const item = this.nativeBrowserDecodeQueue.shift()!;
      const { job } = item;
      this.nativeBrowserDecodeQueuedBytes = Math.max(
        0,
        this.nativeBrowserDecodeQueuedBytes - job.byteCost,
      );
      if (this.isStaleVideoLikeBrowserDecode(item)) {
        this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
        this.diagnostics!.performance.canceledDecodeQueuedTasks += 1;
        this.diagnostics!.performance.droppedStaleOps += 1;
        continue;
      }
      if (!this.nativeEngine.check_visual_token(job.commitToken)) {
        this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
        this.diagnostics!.performance.canceledDecodeQueuedTasks += 1;
        this.diagnostics!.performance.droppedStaleOps += 1;
        continue;
      }
      this.nativeBrowserDecodeInFlight += 1;
      void this.processNativeBrowserDecode(item).finally(() => {
        this.nativeBrowserDecodeInFlight = Math.max(0, this.nativeBrowserDecodeInFlight - 1);
        this.pumpNativeBrowserDecodeQueue();
      });
    }
  }

  private async processNativeBrowserDecode(item: NativeBrowserDecodeQueueItem) {
    const { job } = item;
    const bridge = this.nativeBrowserDecodeBridge;
    const engine = this.nativeEngine;
    if (!bridge || !engine?.uploadExternalImageAndCommit) {
      return;
    }
    if (!engine.check_visual_token(job.commitToken)) {
      this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
      this.diagnostics!.performance.canceledDecodeQueuedTasks += 1;
      this.diagnostics!.performance.droppedStaleOps += 1;
      return;
    }
    if (this.isStaleVideoLikeBrowserDecode(item)) {
      this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
      this.diagnostics!.performance.canceledDecodeInFlightTasks += 1;
      this.diagnostics!.performance.droppedStaleOps += 1;
      return;
    }
    const sequenceId = Number(job.commitToken & BigInt(0xffffffff));
    const output = await bridge.decodeBrowserImage({
      id: sequenceId,
      codec: job.codec,
      bytes: job.bytes,
      sequenceId,
      commitToken: job.commitToken,
      surfaceId: job.surfaceId,
      surfaceGeneration: job.surfaceGeneration,
    });
    if (!output) {
      this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
      this.diagnostics!.performance.browserDecodeFailures += 1;
      this.noteStreamApply(job, 'decode-empty');
      return;
    }
    if (typeof ImageBitmap === 'undefined' || !(output instanceof ImageBitmap)) {
      this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
      bridge.closeOutput(output);
      this.noteStreamApply(job, 'decode-non-imagebitmap');
      this.recordUnsupported('native-browser-decode-non-imagebitmap');
      return;
    }
    if (!engine.check_visual_token(job.commitToken)) {
      this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
      bridge.noteStaleDrop(output);
      this.diagnostics!.performance.browserDecodeStaleDrops += 1;
      this.diagnostics!.performance.droppedStaleOps += 1;
      this.noteStreamApply(job, 'stale-after-decode-token');
      return;
    }
    if (this.isStaleVideoLikeBrowserDecode(item)) {
      this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
      bridge.noteStaleDrop(output);
      this.diagnostics!.performance.browserDecodeStaleDrops += 1;
      this.diagnostics!.performance.droppedStaleOps += 1;
      this.noteStreamApply(job, 'stale-after-decode-epoch');
      return;
    }
    let outputOwnedByRunBuffer = false;
    try {
      if (item.runId !== undefined) {
        if (this.nativeBrowserImageRunBuffer?.addDecoded(item.runId, job, output)) {
          outputOwnedByRunBuffer = true;
          return;
        }
        this.diagnostics!.performance.browserDecodeStaleDrops += 1;
        return;
      }
      const committed = this.uploadNativeBrowserImage(job, output);
      if (!committed) {
        this.diagnostics!.performance.browserDecodeStaleDrops += 1;
      } else {
        this.scheduleNativePresent(item.videoLike ? 10 : 4, item.videoLike);
      }
    } finally {
      if (!outputOwnedByRunBuffer) {
        bridge.closeOutput(output);
      }
    }
  }

  private uploadNativeBrowserImage(job: NativeBrowserImageDecodeJob, output: ImageBitmap) {
    const engine = this.nativeEngine;
    if (!engine?.uploadExternalImageAndCommit) {
      return false;
    }
    const source = job.srcArea ?? {
      left: 0,
      top: 0,
      right: job.width,
      bottom: job.height,
    };
    const compose = job.compose ?? {};
    const committed = engine.uploadExternalImageAndCommit(
      job.commitToken,
      output,
      job.width,
      job.height,
      job.bbox.left,
      job.bbox.top,
      job.bbox.right,
      job.bbox.bottom,
      source.left,
      source.top,
      source.right,
      source.bottom,
      compose.ropDescriptor ?? 8,
      compose.scaleMode ?? 0,
      compose.maskPresent === true,
      false,
    );
    this.noteStreamApply(
      job,
      committed ? 'native-gpu-external-image' : 'native-gpu-external-reject',
    );
    return committed;
  }

  private presentNativePrimary() {
    try {
      const presented = this.nativeEngine?.presentPrimary?.();
      if (presented === false) {
        if (this.diagnostics) {
          this.diagnostics.performance.nativePresentSkippedForPending += 1;
          this.diagnostics.performance.presentCoalescedCount += 1;
        }
        this.scheduleNativeBitmapUploadPump(0);
        this.scheduleNativePresent(4, false);
        return;
      }
      this.nativePresentFirstScheduledAt = null;
    } catch {
      this.recordUnsupported('native-present-primary-failed');
    }
  }

  private nativeBitmapUploadPumpDelayMs() {
    return 8;
  }

  private scheduleNativeBitmapUploadPump(delayMs?: number) {
    if (
      this.disposed ||
      !this.nativeGraphicsRuntimeActive ||
      !this.nativeEngine?.flushPendingNativeBitmapUploads ||
      this.nativeBitmapUploadPumpTimer !== null
    ) {
      return;
    }
    const delay = delayMs ?? this.nativeBitmapUploadPumpDelayMs();
    this.nativeBitmapUploadPumpTimer = setTimeout(() => {
      this.nativeBitmapUploadPumpTimer = null;
      this.flushNativeBitmapUploadPump();
    }, delay) as unknown as number;
  }

  private flushNativeBitmapUploadPump() {
    if (
      this.disposed ||
      !this.nativeGraphicsRuntimeActive ||
      !this.nativeEngine?.flushPendingNativeBitmapUploads
    ) {
      return;
    }
    const events = this.nativeEngine.flushPendingNativeBitmapUploads(
      NATIVE_BITMAP_UPLOAD_FLUSH_BATCH,
    );
    this.applyNativeEvents('display:0', events);
    this.refreshRendererDiagnostics();
    const pending = this.diagnostics?.performance.nativePendingBitmapUploads ?? 0;
    if (pending > 0) {
      this.scheduleNativeBitmapUploadPump(1);
    }
  }

  private scheduleNativePresent(delayMs: number, resetExisting: boolean) {
    if (!this.nativeEngine?.presentPrimary) {
      return;
    }
    const now = performance.now();
    const maxDelayMs = resetExisting ? 18 : 12;
    if (this.nativePresentFirstScheduledAt === null) {
      this.nativePresentFirstScheduledAt = now;
    }
    if (this.nativePresentTimer !== null) {
      if (!resetExisting) {
        this.diagnostics!.performance.presentCoalescedCount += 1;
        return;
      }
      const elapsedMs = now - this.nativePresentFirstScheduledAt;
      if (elapsedMs >= maxDelayMs) {
        clearTimeout(this.nativePresentTimer);
        this.nativePresentTimer = null;
        this.diagnostics!.performance.presentUrgentCount += 1;
        this.presentNativePrimary();
        return;
      }
      clearTimeout(this.nativePresentTimer);
      this.nativePresentTimer = null;
      delayMs = Math.max(0, Math.min(delayMs, maxDelayMs - elapsedMs));
      this.diagnostics!.performance.presentCoalescedCount += 1;
    }
    const scheduledAt = now;
    this.nativePresentTimer = setTimeout(() => {
      this.nativePresentTimer = null;
      const elapsed = performance.now() - scheduledAt;
      const current = this.diagnostics!.performance.presentPacingAvgDelayMs;
      this.diagnostics!.performance.presentPacingAvgDelayMs =
        current === 0 ? elapsed : current * 0.85 + elapsed * 0.15;
      this.presentNativePrimary();
    }, delayMs) as unknown as number;
  }

  private isVideoLikeBrowserJob(job: NativeBrowserImageDecodeJob) {
    if (job.lane === 'stream-mjpeg') {
      return true;
    }
    const area =
      Math.max(0, job.bbox.right - job.bbox.left) * Math.max(0, job.bbox.bottom - job.bbox.top);
    const surfaceArea = Math.max(1, this.payload.canvas.width * this.payload.canvas.height);
    return area / surfaceArea > 0.35;
  }

  private noteStreamDecode(source: string) {
    if (!this.diagnostics) {
      return;
    }
    const sources = this.diagnostics.performance.streamFrameDecodeSources;
    sources[source] = (sources[source] ?? 0) + 1;
  }

  private noteStreamApply(job: NativeBrowserImageDecodeJob, source: string) {
    if (!this.diagnostics || job.lane !== 'stream-mjpeg') {
      return;
    }
    const sources = this.diagnostics.performance.streamFrameApplySources;
    sources[source] = (sources[source] ?? 0) + 1;
    if (source === 'native-gpu-external-image') {
      this.diagnostics.performance.streamOrderedApplies += 1;
      this.diagnostics.performance.qxlBandMode = 'spice-stream';
    }
  }

  private isVideoLikeWasmJob(job: NativeWasmDecodeJob) {
    const area =
      Math.max(0, job.bbox.right - job.bbox.left) * Math.max(0, job.bbox.bottom - job.bbox.top);
    const surfaceArea = Math.max(1, this.payload.canvas.width * this.payload.canvas.height);
    return job.videoLike === true || area / surfaceArea > 0.35;
  }

  private isVideoLikeBitmapGpuJob(job: NativeWasmBitmapDecodeJob, event: NativeDisplayEvent) {
    if (event.type === 'draw' && event.frameHint?.kind === 'bitmapStrip') {
      return true;
    }
    const area =
      Math.max(0, job.bbox.right - job.bbox.left) * Math.max(0, job.bbox.bottom - job.bbox.top);
    const surfaceArea = Math.max(1, this.payload.canvas.width * this.payload.canvas.height);
    return area / surfaceArea > 0.35;
  }

  private cancelVideoLikeNativeWasmDecodes(currentEpoch: number) {
    const canceled =
      this.nativeWasmDecodePool?.cancelWhere(
        (job) => job.videoLike === true && (job.coherenceEpoch ?? 0) < currentEpoch,
      ) ?? 0;
    if (canceled === 0) {
      return;
    }
    this.diagnostics!.performance.canceledDecodeQueuedTasks += canceled;
    this.diagnostics!.performance.droppedStaleOps += canceled;
  }

  private isStaleVideoLikeBrowserDecode(item: NativeBrowserDecodeQueueItem) {
    return item.videoLike && item.coherenceEpoch < this.nativeBrowserDecodeCoherenceEpoch;
  }

  private dropQueuedVideoLikeBrowserDecodes(currentEpoch: number) {
    const retained: NativeBrowserDecodeQueueItem[] = [];
    for (const item of this.nativeBrowserDecodeQueue) {
      if (item.videoLike && item.coherenceEpoch < currentEpoch) {
        this.nativeBrowserImageRunBuffer?.noteItemCanceled(item.runId);
        this.nativeBrowserDecodeQueuedBytes = Math.max(
          0,
          this.nativeBrowserDecodeQueuedBytes - item.job.byteCost,
        );
        this.diagnostics!.performance.canceledDecodeQueuedTasks += 1;
        this.diagnostics!.performance.droppedStaleOps += 1;
        continue;
      }
      retained.push(item);
    }
    this.nativeBrowserDecodeQueue = retained;
  }

  private applyNativeControlEvents(events: unknown) {
    if (!events || typeof events !== 'object') {
      return;
    }
    const channelPackets = (events as { channelPackets?: unknown }).channelPackets;
    if (!Array.isArray(channelPackets)) {
      return;
    }
    for (const item of channelPackets) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const channelKey = (item as { channelKey?: unknown }).channelKey;
      const packet = (item as { packet?: unknown }).packet;
      if (typeof channelKey !== 'string') {
        continue;
      }
      const bytes = bytesFromNativeValue(packet);
      if (bytes) {
        this.dataChannels.get(channelKey)?.send(bytes);
      }
    }
  }

  private openSpiceChannel(channelType: number, channelId: number) {
    if (channelType === SpiceChannelType.USBREDIR) {
      this.diagnostics?.trace.push(
        `usbredir channel ${channelId} unavailable: browser usbredir bridge is not implemented`,
      );
      this.recordUnsupported(`usbredir-${channelId}:not-implemented`);
      this.post({
        type: 'webusb_status',
        payload: {
          available: this.payload.webUsbRedirection === true,
          enabled: this.payload.webUsbRedirection === true,
          attached: false,
          devices: [],
          message: 'USB/camera passthrough needs a real usbredir bridge; channel skipped.',
        },
      });
      return;
    }
    const key = `${channelType}:${channelId}`;
    if (this.dataChannels.has(key)) {
      return;
    }
    const url = this.payload.websockets[String(channelType)] ?? this.payload.websockets['0'];
    if (!url) {
      this.recordUnsupported(`channel-${channelType}:${channelId}:missing-websocket`);
      return;
    }
    const channel = this.createRuntimeChannel({
      key,
      url,
      ingressBatchWindowMs: channelType === SpiceChannelType.DISPLAY ? 4 : 0,
      maxIngressBatchBytes: channelType === SpiceChannelType.DISPLAY ? 16 * 1024 * 1024 : undefined,
      onOpen: () => {
        const link = this.nativeEngine?.open_channel(
          key,
          channelType,
          channelId,
          this.sessionId ?? 0,
        );
        if (link) {
          channel.send(link);
        }
        this.setChannelForType(channelType, true);
      },
      onClose: () => this.setChannelForType(channelType, false),
      onError: (_key, message) => this.recordUnsupported(message),
      onBytes: (currentKey, bytes, backing) => {
        this.observeIngress(bytes.byteLength, backing);
        const events = this.nativeEngine?.ingest_channel_bytes(currentKey, bytes);
        this.applyNativeEvents(currentKey, events);
        this.scheduleNativeBitmapUploadPump();
      },
    });
    this.dataChannels.set(key, channel);
    channel.connect();
    if (channelType === SpiceChannelType.DISPLAY) {
      this.updateStage('connecting-display');
    }
  }

  private applySessionUpdate(update: Record<string, unknown>) {
    if (!this.diagnostics) {
      return;
    }
    if (typeof update.sessionId === 'number') {
      this.sessionId = update.sessionId;
      this.diagnostics.session.sessionId = update.sessionId;
    }
    if (typeof update.currentMouseMode === 'number') {
      this.diagnostics.session.currentMouseMode = update.currentMouseMode;
    }
    if (typeof update.multimediaTime === 'number') {
      this.diagnostics.session.multimediaTime = update.multimediaTime;
    }
    if (this.diagnostics.session.stage === 'main-authenticated') {
      this.updateStage('main-init');
    }
  }

  private setChannelForKey(key: string, open: boolean) {
    const [type] = key.split(':');
    this.setChannelForType(Number(type), open);
  }

  private setChannelForType(channelType: number, open: boolean) {
    switch (channelType) {
      case SpiceChannelType.MAIN:
        this.setChannel('main', open);
        break;
      case SpiceChannelType.DISPLAY:
        this.setChannel('display', open);
        if (open) {
          this.updateStage('display-authenticated');
        }
        break;
      case SpiceChannelType.INPUTS:
        this.setChannel('inputs', open);
        break;
      case SpiceChannelType.CURSOR:
        this.setChannel('cursor', open);
        break;
      case SpiceChannelType.PLAYBACK:
        this.setChannel('playback', open);
        break;
      case SpiceChannelType.RECORD:
        this.setChannel('record', open);
        break;
      case SpiceChannelType.PORT:
        this.setChannel('port', open);
        break;
      case SpiceChannelType.WEBDAV:
        this.setChannel('webdav', open);
        break;
    }
  }

  private async sendEncryptedTicket(channelKey: string, publicKey: Uint8Array) {
    try {
      const ticket = await encryptSpiceTicket(publicKey);
      const packet = this.nativeEngine?.submit_encrypted_ticket(channelKey, ticket);
      if (packet) {
        this.dataChannels.get(channelKey)?.send(packet);
      }
    } catch (error) {
      this.recordUnsupported(
        error instanceof Error ? `ticket-encrypt:${error.message}` : 'ticket-encrypt',
      );
    }
  }

  private mergeNativeDiagnostics(nativeDiagnostics: Record<string, unknown>) {
    if (!this.diagnostics) {
      return;
    }
    const engineDiagnostics = nativeDiagnostics.engine;
    if (engineDiagnostics && typeof engineDiagnostics === 'object') {
      this.mergeNativeDiagnostics(engineDiagnostics as Record<string, unknown>);
    }
    const performance = nativeDiagnostics.performance;
    if (performance && typeof performance === 'object') {
      Object.assign(this.diagnostics.performance, performance);
      const unsupportedCounts =
        mapLikeToObject((performance as Record<string, unknown>).unsupportedCounts) ??
        mapLikeToObject((performance as Record<string, unknown>).unsupported_counts);
      if (unsupportedCounts) {
        this.diagnostics.performance.unsupportedCounts = unsupportedCounts;
      }
      const displayMessageCounts =
        mapLikeToObject((performance as Record<string, unknown>).displayMessageCounts) ??
        mapLikeToObject((performance as Record<string, unknown>).display_message_counts);
      if (displayMessageCounts) {
        this.diagnostics.performance.displayMessageCounts = displayMessageCounts;
      }
      const displayEventCounts =
        mapLikeToObject((performance as Record<string, unknown>).displayEventCounts) ??
        mapLikeToObject((performance as Record<string, unknown>).display_event_counts);
      if (displayEventCounts) {
        this.diagnostics.performance.displayEventCounts = displayEventCounts;
      }
      const displayErrorCounts =
        mapLikeToObject((performance as Record<string, unknown>).displayErrorCounts) ??
        mapLikeToObject((performance as Record<string, unknown>).display_error_counts);
      if (displayErrorCounts) {
        this.diagnostics.performance.displayErrorCounts = displayErrorCounts;
      }
    }
    const unsupported = nativeDiagnostics.unsupported;
    if (Array.isArray(unsupported)) {
      this.diagnostics.unsupported = unsupported
        .filter((entry): entry is string => typeof entry === 'string')
        .slice(-64);
    }
    const channelDiagnostics =
      arrayFromUnknown(nativeDiagnostics.channelDiagnostics) ??
      arrayFromUnknown(nativeDiagnostics.channel_diagnostics);
    if (channelDiagnostics) {
      this.diagnostics.debug.nativeChannels = nativeChannelDiagnosticsToRecord(channelDiagnostics);
    }
    const gpu = nativeDiagnostics.gpu;
    if (gpu && typeof gpu === 'object') {
      const gpuDiagnostics = gpu as Record<string, unknown>;
      this.diagnostics.backend = 'native-wasm/wgpu-rs';
      this.diagnostics.rendering.compositorBackend = 'native-wgpu-rs';
      this.diagnostics.rendering.primarySurfaceMode = 'gpu-authoritative';
      this.diagnostics.debug.presentsCompleted = numberValue(
        gpuDiagnostics.presentedFrames,
        this.diagnostics.debug.presentsCompleted,
      );
      this.diagnostics.debug.presentsRequested = numberValue(
        gpuDiagnostics.submittedBatches,
        this.diagnostics.debug.presentsRequested,
      );
      this.diagnostics.performance.gpuMathOps = numberValue(
        gpuDiagnostics.gpuMathOps,
        this.diagnostics.performance.gpuMathOps,
      );
      this.diagnostics.performance.gpuMathArea = numberValue(
        gpuDiagnostics.gpuMathArea,
        this.diagnostics.performance.gpuMathArea,
      );
      this.diagnostics.performance.gpuComputeOps = numberValue(
        gpuDiagnostics.gpuComputeOps,
        this.diagnostics.performance.gpuComputeOps,
      );
      this.diagnostics.performance.gpuComputeArea = numberValue(
        gpuDiagnostics.gpuComputeArea,
        this.diagnostics.performance.gpuComputeArea,
      );
      this.diagnostics.performance.gpuQueueSubmits = numberValue(
        gpuDiagnostics.queueSubmitCount,
        this.diagnostics.performance.gpuQueueSubmits,
      );
      this.diagnostics.performance.gpuEmptyQueueSubmits = numberValue(
        gpuDiagnostics.emptyQueueSubmitCount,
        this.diagnostics.performance.gpuEmptyQueueSubmits,
      );
      this.diagnostics.performance.gpuTextureWrites = numberValue(
        gpuDiagnostics.textureWriteCount,
        this.diagnostics.performance.gpuTextureWrites,
      );
      this.diagnostics.performance.gpuTextureUploadBytes = numberValue(
        gpuDiagnostics.textureUploadBytes,
        this.diagnostics.performance.gpuTextureUploadBytes,
      );
      this.diagnostics.performance.gpuExternalTextureCopies = numberValue(
        gpuDiagnostics.externalTextureCopyCount,
        this.diagnostics.performance.gpuExternalTextureCopies,
      );
      this.diagnostics.performance.gpuComputeDispatches = numberValue(
        gpuDiagnostics.computeDispatchCount,
        this.diagnostics.performance.gpuComputeDispatches,
      );
      this.diagnostics.performance.gpuBitmapComputeDispatches = numberValue(
        gpuDiagnostics.bitmapComputeDispatchCount,
        this.diagnostics.performance.gpuBitmapComputeDispatches,
      );
      this.diagnostics.performance.gpuRgbaComputeDispatches = numberValue(
        gpuDiagnostics.rgbaComputeDispatchCount,
        this.diagnostics.performance.gpuRgbaComputeDispatches,
      );
      this.diagnostics.performance.gpuRopComputeDispatches = numberValue(
        gpuDiagnostics.ropComputeDispatchCount,
        this.diagnostics.performance.gpuRopComputeDispatches,
      );
      this.diagnostics.performance.gpuRenderPasses = numberValue(
        gpuDiagnostics.renderPassCount,
        this.diagnostics.performance.gpuRenderPasses,
      );
      this.diagnostics.performance.gpuPresentRenderPasses = numberValue(
        gpuDiagnostics.presentRenderPassCount,
        this.diagnostics.performance.gpuPresentRenderPasses,
      );
      this.diagnostics.performance.gpuUploadArenaHits = numberValue(
        gpuDiagnostics.uploadTextureCacheHits,
        this.diagnostics.performance.gpuUploadArenaHits,
      );
      this.diagnostics.performance.gpuUploadArenaMisses = numberValue(
        gpuDiagnostics.uploadTextureCacheMisses,
        this.diagnostics.performance.gpuUploadArenaMisses,
      );
    }
    this.diagnostics.performance.gpuSurfaceCopyCount = numberValue(
      nativeDiagnostics.gpuSubmittedBatches,
      this.diagnostics.performance.gpuSurfaceCopyCount,
    );
    this.diagnostics.performance.gpuPixelEffectCount = numberValue(
      nativeDiagnostics.nativeDecodeUploads,
      this.diagnostics.performance.gpuPixelEffectCount,
    );
    this.diagnostics.performance.directPrimaryUploadCount = numberValue(
      nativeDiagnostics.nativeDirectBitmapUploads,
      this.diagnostics.performance.directPrimaryUploadCount,
    );
    this.diagnostics.performance.nativePendingBitmapUploads = numberValue(
      nativeDiagnostics.nativePendingBitmapUploads,
      this.diagnostics.performance.nativePendingBitmapUploads,
    );
    this.diagnostics.performance.nativePendingBitmapUploadBytes = numberValue(
      nativeDiagnostics.nativePendingBitmapUploadBytes,
      this.diagnostics.performance.nativePendingBitmapUploadBytes,
    );
    this.diagnostics.performance.nativeDeferredBitmapUploads = numberValue(
      nativeDiagnostics.nativeDeferredBitmapUploads,
      this.diagnostics.performance.nativeDeferredBitmapUploads,
    );
    this.diagnostics.performance.nativeDeferredBitmapCommits = numberValue(
      nativeDiagnostics.nativeDeferredBitmapCommits,
      this.diagnostics.performance.nativeDeferredBitmapCommits,
    );
    this.diagnostics.performance.nativeDeferredBitmapDrops = numberValue(
      nativeDiagnostics.nativeDeferredBitmapDrops,
      this.diagnostics.performance.nativeDeferredBitmapDrops,
    );
    this.diagnostics.performance.nativeDeferredBitmapPeakUploads = numberValue(
      nativeDiagnostics.nativeDeferredBitmapPeakUploads,
      this.diagnostics.performance.nativeDeferredBitmapPeakUploads,
    );
    this.diagnostics.performance.nativeDeferredBitmapPeakBytes = numberValue(
      nativeDiagnostics.nativeDeferredBitmapPeakBytes,
      this.diagnostics.performance.nativeDeferredBitmapPeakBytes,
    );
    this.diagnostics.performance.nativeDeferredBitmapFlushes = numberValue(
      nativeDiagnostics.nativeDeferredBitmapFlushes,
      this.diagnostics.performance.nativeDeferredBitmapFlushes,
    );
    this.diagnostics.performance.nativeDeferredBitmapFlushItems = numberValue(
      nativeDiagnostics.nativeDeferredBitmapFlushItems,
      this.diagnostics.performance.nativeDeferredBitmapFlushItems,
    );
    this.diagnostics.performance.nativeDeferredBitmapMaxFlushItems = numberValue(
      nativeDiagnostics.nativeDeferredBitmapMaxFlushItems,
      this.diagnostics.performance.nativeDeferredBitmapMaxFlushItems,
    );
    this.diagnostics.performance.obsoleteGpuSubmissionsAvoided = Math.max(
      this.diagnostics.performance.obsoleteGpuSubmissionsAvoided,
      this.diagnostics.performance.nativeDeferredBitmapDrops,
    );
  }

  private recordUnsupported(reason: string) {
    if (!this.diagnostics) {
      return;
    }
    this.diagnostics.unsupported.push(reason);
    this.diagnostics.unsupported = this.diagnostics.unsupported.slice(-64);
    this.diagnostics.performance.unsupportedCounts[reason] =
      (this.diagnostics.performance.unsupportedCounts[reason] ?? 0) + 1;
    this.publishDiagnostics();
  }

  private startDiagnosticsTimer() {
    if (this.diagnosticsTimer !== null) {
      return;
    }
    this.diagnosticsTimer = setInterval(() => {
      this.refreshRendererDiagnostics();
      this.publishDiagnostics();
    }, 250) as unknown as number;
  }

  private refreshRendererDiagnostics() {
    if (!this.diagnostics) {
      return;
    }
    this.diagnostics.debug.channelSockets = Object.fromEntries(
      Array.from(this.dataChannels.entries()).map(([key, channel]) => [key, channel.snapshot()]),
    );
    const channelSnapshots = Object.values(this.diagnostics.debug.channelSockets);
    this.diagnostics.performance.ingressBufferedBytes = channelSnapshots.reduce(
      (sum, channel) => sum + (channel.queuedBytes ?? 0),
      0,
    );
    this.diagnostics.performance.packetAsyncConcatCount = channelSnapshots.reduce(
      (sum, channel) => sum + (channel.ingressBatchFlushes ?? 0),
      0,
    );
    const nativeDiagnostics = this.nativeEngine?.diagnostics();
    if (nativeDiagnostics && typeof nativeDiagnostics === 'object') {
      this.mergeNativeDiagnostics(nativeDiagnostics as Record<string, unknown>);
    }
    if (this.nativeBrowserDecodeBridge) {
      const decode = this.nativeBrowserDecodeBridge.snapshot();
      this.diagnostics.performance.browserCodecSupport = decode.support;
      this.diagnostics.performance.webCodecsImageDecoderJobs = decode.imageDecoderJobs;
      this.diagnostics.performance.imageBitmapDecodeJobs = decode.imageBitmapJobs;
      this.diagnostics.performance.browserImageDecodeJobs =
        decode.imageDecoderJobs + decode.imageBitmapJobs;
      this.diagnostics.performance.browserDecodeFailures = decode.failures;
      this.diagnostics.performance.browserDecodeStaleDrops = decode.staleDrops;
      this.diagnostics.performance.browserDecodeClosedOutputs = decode.closedOutputs;
      this.diagnostics.performance.browserDecodeReadbackFallbacks = decode.readbackFallbacks;
      this.diagnostics.performance.queuedTasks = this.nativeBrowserDecodeQueue.length;
      this.diagnostics.performance.activeWorkers = this.nativeBrowserDecodeInFlight;
      this.diagnostics.performance.ingressQueueDepth = this.nativeBrowserDecodeQueue.length;
      this.diagnostics.performance.ingressQueuedBytes = this.nativeBrowserDecodeQueuedBytes;
    }
    if (this.nativeWasmDecodePool) {
      const decode = this.nativeWasmDecodePool.snapshot();
      this.diagnostics.performance.workerPoolSize = decode.size;
      this.diagnostics.performance.activeWorkers =
        this.nativeBrowserDecodeInFlight + decode.activeWorkers;
      this.diagnostics.performance.peakActiveWorkers = Math.max(
        this.diagnostics.performance.peakActiveWorkers,
        decode.peakActiveWorkers,
      );
      this.diagnostics.performance.queuedTasks =
        this.nativeBrowserDecodeQueue.length + decode.queuedTasks;
      this.diagnostics.performance.peakQueuedTasks = Math.max(
        this.diagnostics.performance.peakQueuedTasks,
        decode.peakQueuedTasks,
      );
      this.diagnostics.performance.ingressQueueDepth =
        this.nativeBrowserDecodeQueue.length + decode.queuedTasks;
      this.diagnostics.performance.ingressQueuedBytes =
        this.nativeBrowserDecodeQueuedBytes + decode.queuedBytes;
      this.diagnostics.performance.decodeWorkerRestarts = decode.workerRestartCount;
      this.diagnostics.performance.decodeQueueDepths = {
        ...this.diagnostics.performance.decodeQueueDepths,
        ...decode.laneDepths,
      };
      this.diagnostics.performance.peakDecodeQueueDepths = {
        ...this.diagnostics.performance.peakDecodeQueueDepths,
        ...decode.peakLaneDepths,
      };
      this.diagnostics.performance.decodeCodecStats = {
        ...this.diagnostics.performance.decodeCodecStats,
        ...decode.codecStats,
      };
      this.diagnostics.performance.avgQueueAgeMs = decode.avgQueueAgeMs;
      this.diagnostics.performance.canceledDecodeQueuedTasks = Math.max(
        this.diagnostics.performance.canceledDecodeQueuedTasks,
        decode.staleQueuedDrops,
      );
      this.diagnostics.performance.canceledDecodeInFlightTasks = Math.max(
        this.diagnostics.performance.canceledDecodeInFlightTasks,
        decode.staleResultDrops,
      );
    }
    if (this.nativeGpuUploadQueue) {
      const upload = this.nativeGpuUploadQueue.snapshot();
      this.diagnostics.performance.activeWorkers += upload.activeTasks;
      this.diagnostics.performance.peakActiveWorkers = Math.max(
        this.diagnostics.performance.peakActiveWorkers,
        upload.peakActiveTasks,
      );
      this.diagnostics.performance.queuedTasks += upload.queuedTasks;
      this.diagnostics.performance.peakQueuedTasks = Math.max(
        this.diagnostics.performance.peakQueuedTasks,
        upload.peakQueuedTasks,
      );
      this.diagnostics.performance.ingressQueueDepth += upload.queuedTasks;
      this.diagnostics.performance.ingressQueuedBytes += upload.queuedBytes;
      this.diagnostics.performance.laneDepths = {
        ...this.diagnostics.performance.laneDepths,
        ...upload.laneDepths,
      };
      this.diagnostics.performance.peakDecodeQueueDepths = {
        ...this.diagnostics.performance.peakDecodeQueueDepths,
        ...upload.peakLaneDepths,
      };
      this.diagnostics.performance.obsoleteGpuSubmissionsAvoided = Math.max(
        this.diagnostics.performance.obsoleteGpuSubmissionsAvoided,
        upload.staleQueuedDrops,
      );
      this.diagnostics.performance.lateGpuResultsRejected = Math.max(
        this.diagnostics.performance.lateGpuResultsRejected,
        upload.staleResultDrops,
      );
      if (this.diagnostics.performance.avgQueueAgeMs === null) {
        this.diagnostics.performance.avgQueueAgeMs = upload.avgQueueAgeMs;
      }
    }
    this.displayPipeline?.refreshDiagnostics();
  }

  private publishDiagnostics() {
    if (!this.diagnostics || this.disposed) {
      return;
    }
    this.refreshRendererDiagnostics();
    this.post({ type: 'diagnostics', payload: this.diagnostics });
  }
}

function nativeWasmDecodeJob(event: NativeDisplayEvent): NativeWasmDecodeJob | null {
  const bitmap = wasmBitmapDecodeJob(event);
  if (bitmap) {
    return { ...bitmap, kind: 'bitmap' };
  }
  const lzRgb = wasmLzRgbDecodeJob(event);
  if (lzRgb) {
    return { ...lzRgb, kind: 'lz-rgb' };
  }
  const binary = wasmBinaryImageDecodeJob(event);
  if (binary) {
    return { ...binary, kind: binary.codec };
  }
  return null;
}

function sharedMemoryDisabledReason(
  requested: boolean,
  capability: ReturnType<typeof detectSharedMemoryRuntimeCapability>,
) {
  if (!requested) {
    return null;
  }
  if (!capability.eligible) {
    return capability.disabledReason;
  }
  if (!NATIVE_SHARED_RING_TRANSPORT_ACTIVE) {
    return 'native shared-memory transport rings are not active yet';
  }
  return null;
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

function arrayBufferFromNativeBytes(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}

function mapLikeToObject(value: unknown): Record<string, number> | null {
  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries()).filter(
        (entry): entry is [string, number] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'number',
      ),
    );
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, number> = {};
    for (const [key, count] of Object.entries(value)) {
      if (typeof count === 'number') {
        out[key] = count;
      }
    }
    return out;
  }
  return null;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rectArea(rect: { left: number; top: number; right: number; bottom: number }) {
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

function bigintFromNativeValue(value: unknown) {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return null;
}

function arrayFromUnknown(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function nativeChannelDiagnosticsToRecord(items: unknown[]) {
  const out: SpiceWorkerDiagnostics['debug']['nativeChannels'] = {};
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const key = stringField(record, 'key');
    if (!key) {
      continue;
    }
    out[key] = {
      channelType: numberField(record, 'channelType', 'channel_type') ?? 0,
      channelId: numberField(record, 'channelId', 'channel_id') ?? 0,
      phase: stringField(record, 'phase') ?? 'unknown',
      bufferedBytes: numberField(record, 'bufferedBytes', 'buffered_bytes') ?? 0,
      parsedMiniMessages: numberField(record, 'parsedMiniMessages', 'parsed_mini_messages') ?? 0,
      lastMessageType: numberField(record, 'lastMessageType', 'last_message_type') ?? null,
      lastBodySize: numberField(record, 'lastBodySize', 'last_body_size') ?? null,
      pendingMessageType: numberField(record, 'pendingMessageType', 'pending_message_type') ?? null,
      pendingBodySize: numberField(record, 'pendingBodySize', 'pending_body_size') ?? null,
      ackWindow: numberField(record, 'ackWindow', 'ack_window') ?? 0,
      packetsSinceAck: numberField(record, 'packetsSinceAck', 'packets_since_ack') ?? 0,
    };
  }
  return out;
}

function numberField(record: Record<string, unknown>, camel: string, snake?: string) {
  const value = record[camel] ?? (snake ? record[snake] : undefined);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}
