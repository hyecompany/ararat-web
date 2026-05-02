/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

import type { ConsoleShortcutId, SpiceRuntimeDiagnostics } from './runtime/contracts';
import { SpicePortEvent } from './runtime/constants';
import type {
  RuntimeFastPathToggles,
  SessionControlMessage,
  SessionMigrationDestination,
  SessionMigrationDestinationInfo,
  SessionMonitorsConfig,
  SessionPortChannelName,
  SessionPortDataPayload,
  SessionPortEndpoint,
  SessionPortEventPayload,
  SessionPortInitPayload,
  SessionWebUsbStatus,
  SessionWorkerInbound,
  SessionWorkerOutbound,
  SpiceWorkerDiagnostics,
} from './runtime/messages';
import { detectSharedMemoryRuntimeCapability } from './runtime/shared-memory-policy';
import type { ClientWebUsbDevice } from './webusb-client';
import { BrowserSpiceAudioSink } from './browser-audio-sink';
import { BrowserSpiceCursorAdapter } from './browser-cursor-adapter';
import { BrowserSpiceInputAdapter } from './browser-input-adapter';
import { BrowserSpiceRecordSource } from './browser-record-source';

type BrowserCodecWindow = Window & {
  ImageDecoder?: unknown;
  VideoDecoder?: unknown;
  AudioDecoder?: unknown;
  AudioEncoder?: unknown;
};

type NavigatorWithGpu = Navigator & { gpu?: unknown };

export interface SpicePortBackendContext extends SessionPortEndpoint {
  send: (data: ArrayBuffer | ArrayBufferView | Uint8Array) => void;
  setOpen: (open: boolean) => void;
  close: () => void;
}

export interface SpicePortBackend {
  channel: SessionPortChannelName;
  portName?: string | RegExp | ((name: string) => boolean);
  autoOpen?: boolean;
  onInit?: (
    payload: SessionPortInitPayload,
    context: SpicePortBackendContext,
  ) => void | boolean | Promise<void | boolean>;
  onData?: (
    payload: SessionPortDataPayload,
    context: SpicePortBackendContext,
  ) => void | Promise<void>;
  onEvent?: (
    payload: SessionPortEventPayload,
    context: SpicePortBackendContext,
  ) => void | Promise<void>;
}

export interface SpiceSessionOptions {
  websockets: Record<string, string>;
  canvas: HTMLCanvasElement;
  cacheScope?: string;
  debugLiveLogging?: boolean;
  debugDiagnosticReadbacks?: boolean;
  portBackends?: SpicePortBackend[];
  resolveMigrationDestination?: (
    dstInfo: SessionMigrationDestinationInfo,
  ) => SessionMigrationDestination | null | Promise<SessionMigrationDestination | null>;
  onFileTransfer?: (
    payload: Extract<SessionWorkerOutbound, { type: 'file_transfer' }>['payload'],
  ) => void | Promise<void>;
  onError: (payload: {
    message: string;
    recoverableBackend?: 'webgpu' | 'webgl2' | 'offscreen-2d' | null;
    fallbackBackend?: 'webgl2' | 'offscreen-2d' | null;
  }) => void;
  onReady: () => void;
  onResolution: (width: number, height: number) => void;
  onMonitorsConfig?: (config: SessionMonitorsConfig) => void;
  onDiagnostics: (metrics: SpiceRuntimeDiagnostics) => void;
  onWebUsbStatus?: (status: SessionWebUsbStatus) => void;
  backendPolicy?: {
    disableWebGpu?: boolean;
    disableWebGl2?: boolean;
    decodeWorkers?: number;
    schedulerConcurrency?: number;
  };
  runtimeToggles?: Partial<RuntimeFastPathToggles>;
  webUsbRedirection?: boolean;
}

declare global {
  interface Window {
    __spiceDebug?: {
      snapshot: () => SpiceRuntimeDiagnostics | null;
      reset: () => void;
      rightClick: () => void;
      pressEscape: () => void;
      nextSnapshot: (timeoutMs?: number) => Promise<SpiceRuntimeDiagnostics | null>;
      stress: () => Record<string, unknown> | null;
      setFastPath: (name: keyof RuntimeFastPathToggles, enabled: boolean) => void;
      enableLiveLog: () => void;
      disableLiveLog: () => void;
    };
    __spiceLiveLog?: SessionWorkerOutbound[];
  }
}

function transferablesForControl(message: SessionControlMessage): Transferable[] {
  if (message.type === 'port_data') {
    return [message.payload.data];
  }
  if (message.type === 'record_chunk') {
    return [message.payload.pcm];
  }
  return [];
}

function isArrayBufferView(
  value: ArrayBuffer | ArrayBufferView | Uint8Array,
): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function arrayBufferForPortSend(data: ArrayBuffer | ArrayBufferView | Uint8Array) {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (isArrayBufferView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return copy.buffer;
  }
  return data;
}

export class SpiceGraphicalSession {
  private worker: Worker | null = null;
  private controlPort: MessagePort | null = null;
  private disposed = false;
  private readonly activePortContexts = new Map<string, SpicePortBackendContext>();
  private lastDiagnostics: SpiceWorkerDiagnostics | null = null;
  private nextSnapshotResolvers: Array<(value: SpiceRuntimeDiagnostics | null) => void> = [];
  private liveLogging = false;
  private lastLiveDiagnosticsLogAt = 0;
  private readonly audioSink: BrowserSpiceAudioSink;
  private readonly recordSource: BrowserSpiceRecordSource;
  private readonly cursorAdapter: BrowserSpiceCursorAdapter;
  private readonly inputAdapter: BrowserSpiceInputAdapter;

  private static transferredCanvases = new WeakSet<HTMLCanvasElement>();

  constructor(private readonly options: SpiceSessionOptions) {
    this.audioSink = new BrowserSpiceAudioSink();
    this.recordSource = new BrowserSpiceRecordSource({
      postControl: (message, transfer) => this.postControl(message, transfer),
    });
    this.cursorAdapter = new BrowserSpiceCursorAdapter(options.canvas);
    this.inputAdapter = new BrowserSpiceInputAdapter({
      canvas: options.canvas,
      postControl: (message, transfer) => this.postControl(message, transfer),
      sendFiles: (files) => this.sendFiles(files),
    });
  }

  async connect() {
    if (this.disposed) {
      throw new Error('Session disposed');
    }

    this.liveLogging = Boolean(this.options.debugLiveLogging);
    const workerUrl = new URL('/ui/spice-client/session.worker.js', window.location.origin);
    workerUrl.searchParams.set('v', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const worker = new Worker(workerUrl, {
      type: 'module',
      name: 'spice-session-worker',
    });
    this.worker = worker;

    const controlChannel = new MessageChannel();
    this.controlPort = controlChannel.port1;
    this.controlPort.start();
    this.installDebugBridge();
    this.inputAdapter.attach();

    worker.onmessage = (event: MessageEvent<SessionWorkerOutbound>) => {
      this.handleWorkerMessage(event.data);
    };
    worker.onerror = (event) => {
      this.options.onError({ message: event.message || 'SPICE worker failed.' });
    };

    const offscreen = this.options.canvas.transferControlToOffscreen();
    SpiceGraphicalSession.transferredCanvases.add(this.options.canvas);
    const sharedMemory = detectSharedMemoryRuntimeCapability();
    const init: SessionWorkerInbound = {
      type: 'init',
      payload: {
        websockets: this.options.websockets,
        canvas: offscreen,
        controlPort: controlChannel.port2,
        cacheScope: this.options.cacheScope,
        runtimeToggles: {
          artifactSentinel: true,
          presentPacing: true,
          zeroCopyIngress: true,
          gpuUploadReuse: true,
          qxlFrameBands: true,
          ...this.options.runtimeToggles,
        },
        capabilityProbe: {
          imageBitmap: typeof createImageBitmap === 'function',
          imageDecoder: typeof (window as BrowserCodecWindow).ImageDecoder !== 'undefined',
          videoDecoder: typeof (window as BrowserCodecWindow).VideoDecoder !== 'undefined',
          audioDecoder: typeof (window as BrowserCodecWindow).AudioDecoder !== 'undefined',
          audioEncoder: typeof (window as BrowserCodecWindow).AudioEncoder !== 'undefined',
          webgpu: Boolean((navigator as NavigatorWithGpu).gpu),
          webusb: this.options.webUsbRedirection === true,
          webdav: Boolean(
            this.options.portBackends?.some((backend) => backend.channel === 'webdav'),
          ),
          sharedMemory: sharedMemory.eligible,
        },
        backendPolicy: this.options.backendPolicy,
        portBridge: {
          port: Boolean(this.options.portBackends?.some((backend) => backend.channel === 'port')),
          webdav: Boolean(
            this.options.portBackends?.some((backend) => backend.channel === 'webdav'),
          ),
        },
        webUsbRedirection: this.options.webUsbRedirection === true,
      },
    };

    worker.postMessage(init, [offscreen, controlChannel.port2]);
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.inputAdapter.dispose();
    this.controlPort?.postMessage({ type: 'mouse_leave' } satisfies SessionControlMessage);
    this.controlPort?.close();
    this.controlPort = null;
    this.worker?.postMessage({ type: 'dispose' } satisfies SessionWorkerInbound);
    this.worker?.terminate();
    this.worker = null;
    this.audioSink.dispose();
    void this.recordSource.stop();
    this.cursorAdapter.dispose();
    this.activePortContexts.clear();
    for (const resolve of this.nextSnapshotResolvers.splice(0)) {
      resolve(this.lastDiagnostics);
    }
    if (window.__spiceDebug?.snapshot() === this.lastDiagnostics) {
      delete window.__spiceDebug;
    }
  }

  sendShortcut(shortcut: ConsoleShortcutId) {
    this.postControl({ type: 'shortcut', payload: { shortcut } });
  }

  setResolution(width: number, height: number) {
    this.postControl({ type: 'resize', payload: { width, height } });
  }

  attachWebUsbDevice(device: ClientWebUsbDevice) {
    this.postControl({ type: 'webusb_attach', payload: device });
  }

  sendFiles(files: File[]) {
    this.postControl({
      type: 'file_transfer_upload',
      payload: {
        files: files.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
          blob: file,
        })),
      },
    });
  }

  static prepareCanvas(canvas: HTMLCanvasElement) {
    if (!this.transferredCanvases.has(canvas)) {
      return canvas;
    }

    const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
    replacement.className = canvas.className;
    replacement.style.cssText = canvas.style.cssText;
    replacement.width = canvas.width;
    replacement.height = canvas.height;
    for (const attribute of canvas.getAttributeNames()) {
      const value = canvas.getAttribute(attribute);
      if (value !== null) {
        replacement.setAttribute(attribute, value);
      }
    }
    canvas.replaceWith(replacement);
    return replacement;
  }

  private handleWorkerMessage(message: SessionWorkerOutbound) {
    if (this.liveLogging) {
      window.__spiceLiveLog = [...(window.__spiceLiveLog ?? []), message].slice(-500);
    }

    switch (message.type) {
      case 'ready':
        this.options.onReady();
        break;
      case 'disposed':
        break;
      case 'error':
        this.options.onError(message.payload);
        break;
      case 'resolution':
        this.syncCanvasDisplaySize(message.payload.width, message.payload.height);
        this.options.onResolution(message.payload.width, message.payload.height);
        break;
      case 'monitors_config':
        this.options.onMonitorsConfig?.(message.payload);
        break;
      case 'diagnostics':
        this.lastDiagnostics = message.payload;
        this.logLiveDiagnostics(message.payload);
        this.options.onDiagnostics(message.payload);
        for (const resolve of this.nextSnapshotResolvers.splice(0)) {
          resolve(message.payload);
        }
        break;
      case 'file_transfer':
        void this.options.onFileTransfer?.(message.payload);
        break;
      case 'file_transfer_download':
        this.handleFileDownload(message.payload);
        break;
      case 'port_init':
        void this.handlePortInit(message.payload);
        break;
      case 'port_data':
        void this.handlePortData(message.payload);
        break;
      case 'port_event':
        void this.handlePortEvent(message.payload);
        break;
      case 'migration_resolve_request':
        void this.handleMigrationResolve(message.payload.requestId, message.payload.dstInfo);
        break;
      case 'webusb_status':
        this.options.onWebUsbStatus?.(message.payload);
        break;
      case 'audio':
        void this.audioSink.handleAudio(message.payload);
        break;
      case 'audio_control':
        this.audioSink.handleControl(message.payload);
        break;
      case 'audio_stop':
        this.audioSink.stop();
        break;
      case 'record_start':
        void this.recordSource.start(message.payload);
        break;
      case 'record_control':
        this.recordSource.applyControl(message.payload);
        break;
      case 'record_stop':
        void this.recordSource.stop();
        break;
      case 'debug_event':
        break;
      case 'cursor':
        this.cursorAdapter.apply(message.payload);
        break;
    }
  }

  private handleFileDownload(
    payload: Extract<SessionWorkerOutbound, { type: 'file_transfer_download' }>['payload'],
  ) {
    if (payload.status !== 'complete' || !payload.data) {
      return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([payload.data]));
    link.download = payload.name || 'spice-download';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  private async handleMigrationResolve(
    requestId: number,
    dstInfo: SessionMigrationDestinationInfo,
  ) {
    const destination = this.options.resolveMigrationDestination
      ? await this.options.resolveMigrationDestination(dstInfo)
      : null;
    this.worker?.postMessage({
      type: 'migration_resolve_result',
      payload: { requestId, destination },
    } satisfies SessionWorkerInbound);
  }

  private async handlePortInit(payload: SessionPortInitPayload) {
    const backend = this.findPortBackend(payload);
    if (!backend) {
      return;
    }
    const context = this.createPortContext(payload);
    const result = await backend.onInit?.(payload, context);
    if (result === false) {
      return;
    }
    this.activePortContexts.set(this.portContextKey(payload), context);
    if (backend.autoOpen && !payload.opened) {
      context.setOpen(true);
    }
  }

  private async handlePortData(payload: SessionPortDataPayload) {
    const context = this.activePortContexts.get(this.portContextKey(payload));
    const backend = this.findPortBackend(payload);
    if (context && backend?.onData) {
      await backend.onData(payload, context);
    }
  }

  private async handlePortEvent(payload: SessionPortEventPayload) {
    const key = this.portContextKey(payload);
    const context = this.activePortContexts.get(key);
    const backend = this.findPortBackend(payload);
    if (context && backend?.onEvent) {
      await backend.onEvent(payload, context);
    }
    if (payload.event === SpicePortEvent.CLOSED) {
      this.activePortContexts.delete(key);
    }
  }

  private createPortContext(endpoint: SessionPortEndpoint): SpicePortBackendContext {
    return {
      ...endpoint,
      send: (data) => {
        const buffer = arrayBufferForPortSend(data);
        this.postControl(
          {
            type: 'port_data',
            payload: {
              channelType: endpoint.channelType,
              channelId: endpoint.channelId,
              data: buffer,
            },
          },
          [buffer],
        );
      },
      setOpen: (open) => {
        this.postControl({
          type: 'port_event',
          payload: {
            channelType: endpoint.channelType,
            channelId: endpoint.channelId,
            event: open ? SpicePortEvent.OPENED : SpicePortEvent.CLOSED,
          },
        });
      },
      close: () => {
        this.postControl({
          type: 'port_event',
          payload: {
            channelType: endpoint.channelType,
            channelId: endpoint.channelId,
            event: SpicePortEvent.CLOSED,
          },
        });
      },
    };
  }

  private findPortBackend(endpoint: SessionPortEndpoint) {
    return this.options.portBackends?.find((backend) => {
      if (backend.channel !== endpoint.channelName) {
        return false;
      }
      if (!backend.portName) {
        return true;
      }
      if (typeof backend.portName === 'string') {
        return backend.portName === endpoint.portName;
      }
      if (backend.portName instanceof RegExp) {
        return backend.portName.test(endpoint.portName);
      }
      return backend.portName(endpoint.portName);
    });
  }

  private portContextKey(endpoint: Pick<SessionPortEndpoint, 'channelType' | 'channelId'>) {
    return `${endpoint.channelType}:${endpoint.channelId}`;
  }

  private installDebugBridge() {
    window.__spiceDebug = {
      snapshot: () => this.lastDiagnostics,
      reset: () => {
        this.lastDiagnostics = null;
      },
      rightClick: () => this.inputAdapter.rightClick(),
      pressEscape: () => this.inputAdapter.pressEscape(),
      nextSnapshot: (timeoutMs = 1000) =>
        new Promise<SpiceRuntimeDiagnostics | null>((resolve) => {
          const timeoutId = window.setTimeout(() => {
            this.nextSnapshotResolvers = this.nextSnapshotResolvers.filter(
              (entry) => entry !== resolver,
            );
            resolve(this.lastDiagnostics);
          }, timeoutMs);
          const resolver = (value: SpiceRuntimeDiagnostics | null) => {
            window.clearTimeout(timeoutId);
            resolve(value);
          };
          this.nextSnapshotResolvers.push(resolver);
        }),
      stress: () => {
        const snapshot = this.lastDiagnostics;
        if (!snapshot) {
          return null;
        }
        const performance = snapshot.performance;
        const rect = this.options.canvas.getBoundingClientRect();
        return {
          stage: snapshot.session.stage,
          backend: snapshot.backend,
          graphicsPath: snapshot.displayStack.graphicsPath,
          canvasCssWidth: rect.width,
          canvasCssHeight: rect.height,
          canvasBackingWidth: this.options.canvas.width,
          canvasBackingHeight: this.options.canvas.height,
          devicePixelRatio: window.devicePixelRatio,
          p95PacketToPresentMs: performance.p95PacketToPresentMs,
          ingressQueueDepth: performance.ingressQueueDepth,
          ingressQueuedBytes: performance.ingressQueuedBytes,
          ingressAckCount: performance.ingressAckCount,
          oldWorkContinuedAfterNewOwner: performance.oldWorkContinuedAfterNewOwner,
          wholeScreenBlockCount: performance.wholeScreenBlockCount,
          gpuMathOps: performance.gpuMathOps,
          gpuComputeOps: performance.gpuComputeOps,
          gpuComputeDispatches: performance.gpuComputeDispatches,
          gpuBitmapComputeDispatches: performance.gpuBitmapComputeDispatches,
          gpuQueueSubmits: performance.gpuQueueSubmits,
          gpuRenderPasses: performance.gpuRenderPasses,
          gpuPresentRenderPasses: performance.gpuPresentRenderPasses,
          gpuTextureWrites: performance.gpuTextureWrites,
          gpuTextureUploadBytes: performance.gpuTextureUploadBytes,
          directPrimaryUploadCount: performance.directPrimaryUploadCount,
          directPrimaryUploadArea: performance.directPrimaryUploadArea,
          nativePendingBitmapUploads: performance.nativePendingBitmapUploads,
          nativePendingBitmapUploadBytes: performance.nativePendingBitmapUploadBytes,
          nativeDeferredBitmapUploads: performance.nativeDeferredBitmapUploads,
          nativeDeferredBitmapCommits: performance.nativeDeferredBitmapCommits,
          nativeDeferredBitmapDrops: performance.nativeDeferredBitmapDrops,
          nativeDeferredBitmapFlushes: performance.nativeDeferredBitmapFlushes,
          nativeDeferredBitmapFlushItems: performance.nativeDeferredBitmapFlushItems,
          nativeDeferredBitmapMaxFlushItems: performance.nativeDeferredBitmapMaxFlushItems,
          packetCopiedBodyBytes: performance.packetCopiedBodyBytes,
          droppedStaleOps: performance.droppedStaleOps,
          cpuPixelMathArea: performance.cpuPixelMathArea,
          sharedMemoryEnabled: performance.sharedMemoryEnabled,
        };
      },
      setFastPath: (name, enabled) => {
        this.postControl({ type: 'runtime_toggles', payload: { [name]: enabled } });
      },
      enableLiveLog: () => {
        this.liveLogging = true;
        this.postControl({
          type: 'debug_config',
          payload: {
            liveLogging: true,
            diagnosticReadbacks: this.options.debugDiagnosticReadbacks,
          },
        });
      },
      disableLiveLog: () => {
        this.liveLogging = false;
        this.postControl({
          type: 'debug_config',
          payload: {
            liveLogging: false,
            diagnosticReadbacks: this.options.debugDiagnosticReadbacks,
          },
        });
      },
    };
  }

  private logLiveDiagnostics(metrics: SpiceRuntimeDiagnostics) {
    if (!this.liveLogging) {
      return;
    }
    const now = performance.now();
    if (now - this.lastLiveDiagnosticsLogAt < 1000) {
      return;
    }
    this.lastLiveDiagnosticsLogAt = now;
    const perf = metrics.performance;
    console.debug(
      '[spice-live]',
      JSON.stringify({
        stage: metrics.session.stage,
        backend: metrics.backend,
        graphicsPath: metrics.displayStack.graphicsPath,
        gpuMathOps: perf.gpuMathOps,
        gpuComputeOps: perf.gpuComputeOps,
        gpuPixelEffectCount: perf.gpuPixelEffectCount,
        gpuUploadArenaHits: perf.gpuUploadArenaHits,
        gpuUploadArenaMisses: perf.gpuUploadArenaMisses,
        queuedTasks: perf.queuedTasks,
        activeWorkers: perf.activeWorkers,
        avgQueueAgeMs: perf.avgQueueAgeMs,
        p95PacketToPresentMs: perf.p95PacketToPresentMs,
        presentCoalescedCount: perf.presentCoalescedCount,
        presentUrgentCount: perf.presentUrgentCount,
        nativePresentSkippedForPending: perf.nativePresentSkippedForPending,
        presentPacingAvgDelayMs: perf.presentPacingAvgDelayMs,
        ingressQueueDepth: perf.ingressQueueDepth,
        ingressQueuedBytes: perf.ingressQueuedBytes,
        displayMessageCounts: perf.displayMessageCounts,
        displayEventCounts: perf.displayEventCounts,
        streamOrderedApplies: perf.streamOrderedApplies,
        streamFrameDecodeSources: perf.streamFrameDecodeSources,
        streamFrameApplySources: perf.streamFrameApplySources,
        sharedMemoryEnabled: perf.sharedMemoryEnabled,
        sharedMemoryDisabledReason: perf.sharedMemoryDisabledReason,
        qxlBandMode: perf.qxlBandMode,
        qxlBandPendingItems: perf.qxlBandPendingItems,
        nativeDeferredBitmapFlushes: perf.nativeDeferredBitmapFlushes,
        nativeDeferredBitmapMaxFlushItems: perf.nativeDeferredBitmapMaxFlushItems,
        staleDrops: perf.browserDecodeStaleDrops,
        droppedStaleOps: perf.droppedStaleOps,
      }),
    );
  }

  private postControl(
    message: SessionControlMessage,
    transfer: Transferable[] = transferablesForControl(message),
  ) {
    if (!this.controlPort || this.disposed) {
      return;
    }
    this.controlPort.postMessage(message, transfer);
  }

  private syncCanvasDisplaySize(width: number, height: number) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    this.inputAdapter.setDisplaySize(safeWidth, safeHeight);
    try {
      if (this.options.canvas.width !== safeWidth || this.options.canvas.height !== safeHeight) {
        this.options.canvas.width = safeWidth;
        this.options.canvas.height = safeHeight;
      }
    } catch {
      // The transferred canvas bitmap is owned by the worker; the adapter keeps
      // a logical display size for input projection if DOM attributes are locked.
    }
  }
}
