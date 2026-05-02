/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import InstanceClass from '../../../_lib/instance';
import { useConsoleFullscreen } from './use-console-fullscreen';
import {
  createDisabledConsoleController,
  type ConsoleSessionController,
  type ConsoleShortcutId,
  type SpiceRuntimeDiagnostics,
} from '../_lib/shortcuts';
import { SpiceGraphicalSession } from '../_lib/spice-client/session';
import {
  createWebDavPortBackend,
  type WebDavDirectoryShare,
} from '../_lib/spice-client/webdav-fs-access';
import { parseBooleanFlag } from '../_lib/spice-client/runtime/shared-memory-policy';
import type { SessionMonitorsConfig } from '../_lib/spice-client/runtime/messages';
import {
  clientWebUsbAvailable,
  requestClientWebUsbDevice,
  type ClientWebUsbDevice,
} from '../_lib/spice-client/webusb-client';
import {
  getConsoleConnectionFailureMessage,
  getErrorMessage,
  isConsoleAlreadyInUseError,
} from '../_lib/console-errors';

interface UseSpiceSessionOptions {
  enabled: boolean;
  instanceClass: InstanceClass | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  forceTakeoverToken?: number;
  onConsoleInUse?: (message: string) => void;
  autoResize?: boolean;
  sharedMemoryFastPath?: boolean;
  webUsbRedirection?: boolean;
  webDavShare?: WebDavDirectoryShare | null;
  qxlFrameBands?: boolean;
  liveDiagnostics?: boolean;
}

type GraphicalStatus = 'idle' | 'connecting' | 'ready' | 'error';

const DIAGNOSTICS_PROBE_INTERVAL_MS = 500;
const MAIN_THREAD_PROBE_INTERVAL_MS = 500;
const MAIN_THREAD_RAF_BUDGET_MS = 1000 / 55;
const RESIZE_TARGET_MIN_PX = 64;

declare global {
  interface Window {
    __spiceMainThreadProbe?: {
      snapshot: () => MainThreadProbe;
    };
  }
}

interface MainThreadProbe {
  longTaskCount: number;
  totalLongTaskMs: number;
  maxLongTaskMs: number;
  eventTimingCount: number;
  totalEventDelayMs: number;
  maxEventDelayMs: number;
  rafFrameCount: number;
  rafMissedFrameCount: number;
  lastRafGapMs: number;
  maxRafGapMs: number;
  lastTimerDriftMs: number;
  maxTimerDriftMs: number;
  pointerEventCount: number;
  totalPointerToPaintMs: number;
  maxPointerToPaintMs: number;
  diagnosticsWriteCount: number;
  totalDiagnosticsWriteMs: number;
  maxDiagnosticsWriteMs: number;
  lastDiagnosticsBytes: number;
  maxDiagnosticsBytes: number;
  diagnosticsReceivedCount: number;
  startedAtMs: number;
}

interface MainThreadProbeHandle {
  snapshot: () => MainThreadProbe;
  recordDiagnosticsWrite: (durationMs: number, byteLength: number) => void;
  recordDiagnosticsReceived: () => void;
  dispose: () => void;
}

type PerformanceEventTimingEntry = PerformanceEntry & {
  processingStart?: number;
  interactionId?: number;
};

function cloneMainThreadProbe(probe: MainThreadProbe): MainThreadProbe {
  return { ...probe };
}

function eventTimeStampToNowRelative(timeStamp: number) {
  const now = performance.now();
  if (timeStamp > now + 60_000 && performance.timeOrigin > 0) {
    return timeStamp - performance.timeOrigin;
  }
  return timeStamp;
}

function createMainThreadProbe(canvas: HTMLCanvasElement): MainThreadProbeHandle {
  let disposed = false;
  let timerId: number | null = null;
  let rafId: number | null = null;
  let longTaskObserver: PerformanceObserver | null = null;
  let eventTimingObserver: PerformanceObserver | null = null;
  let lastTimerTickAt = performance.now();
  let lastRafAt = 0;
  const probe: MainThreadProbe = {
    longTaskCount: 0,
    totalLongTaskMs: 0,
    maxLongTaskMs: 0,
    eventTimingCount: 0,
    totalEventDelayMs: 0,
    maxEventDelayMs: 0,
    rafFrameCount: 0,
    rafMissedFrameCount: 0,
    lastRafGapMs: 0,
    maxRafGapMs: 0,
    lastTimerDriftMs: 0,
    maxTimerDriftMs: 0,
    pointerEventCount: 0,
    totalPointerToPaintMs: 0,
    maxPointerToPaintMs: 0,
    diagnosticsWriteCount: 0,
    totalDiagnosticsWriteMs: 0,
    maxDiagnosticsWriteMs: 0,
    lastDiagnosticsBytes: 0,
    maxDiagnosticsBytes: 0,
    diagnosticsReceivedCount: 0,
    startedAtMs: performance.now(),
  };

  timerId = window.setInterval(() => {
    const now = performance.now();
    const drift = Math.max(0, now - lastTimerTickAt - MAIN_THREAD_PROBE_INTERVAL_MS);
    lastTimerTickAt = now;
    probe.lastTimerDriftMs = drift;
    probe.maxTimerDriftMs = Math.max(probe.maxTimerDriftMs, drift);
  }, MAIN_THREAD_PROBE_INTERVAL_MS);

  const rafLoop = (atMs: number) => {
    if (disposed) {
      return;
    }
    if (lastRafAt > 0) {
      const gap = atMs - lastRafAt;
      probe.lastRafGapMs = gap;
      probe.maxRafGapMs = Math.max(probe.maxRafGapMs, gap);
      if (gap > MAIN_THREAD_RAF_BUDGET_MS * 2) {
        probe.rafMissedFrameCount += Math.max(
          1,
          Math.floor(gap / MAIN_THREAD_RAF_BUDGET_MS) - 1,
        );
      }
    }
    lastRafAt = atMs;
    probe.rafFrameCount += 1;
    rafId = window.requestAnimationFrame(rafLoop);
  };
  rafId = window.requestAnimationFrame(rafLoop);

  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('longtask')
  ) {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          probe.longTaskCount += 1;
          probe.totalLongTaskMs += entry.duration;
          probe.maxLongTaskMs = Math.max(probe.maxLongTaskMs, entry.duration);
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      longTaskObserver = null;
    }
  }

  if (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('event')
  ) {
    try {
      eventTimingObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEventTimingEntry[]) {
          if (typeof entry.processingStart !== 'number') {
            continue;
          }
          const delay = Math.max(0, entry.processingStart - entry.startTime);
          probe.eventTimingCount += 1;
          probe.totalEventDelayMs += delay;
          probe.maxEventDelayMs = Math.max(probe.maxEventDelayMs, delay);
        }
      });
      eventTimingObserver.observe({
        type: 'event',
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    } catch {
      eventTimingObserver = null;
    }
  }

  const recordPointerToPaint = (event: PointerEvent) => {
    const eventAt = eventTimeStampToNowRelative(event.timeStamp);
    probe.pointerEventCount += 1;
    window.requestAnimationFrame(() => {
      if (disposed) {
        return;
      }
      const latency = Math.max(0, performance.now() - eventAt);
      probe.totalPointerToPaintMs += latency;
      probe.maxPointerToPaintMs = Math.max(probe.maxPointerToPaintMs, latency);
    });
  };
  canvas.addEventListener('pointerdown', recordPointerToPaint, {
    capture: true,
    passive: true,
  });
  canvas.addEventListener('pointermove', recordPointerToPaint, {
    capture: true,
    passive: true,
  });

  return {
    snapshot: () => cloneMainThreadProbe(probe),
    recordDiagnosticsWrite: (durationMs, byteLength) => {
      probe.diagnosticsWriteCount += 1;
      probe.totalDiagnosticsWriteMs += Math.max(0, durationMs);
      probe.maxDiagnosticsWriteMs = Math.max(
        probe.maxDiagnosticsWriteMs,
        durationMs,
      );
      probe.lastDiagnosticsBytes = Math.max(0, byteLength);
      probe.maxDiagnosticsBytes = Math.max(probe.maxDiagnosticsBytes, byteLength);
    },
    recordDiagnosticsReceived: () => {
      probe.diagnosticsReceivedCount += 1;
    },
    dispose: () => {
      disposed = true;
      if (timerId !== null) {
        window.clearInterval(timerId);
      }
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      longTaskObserver?.disconnect();
      eventTimingObserver?.disconnect();
      canvas.removeEventListener('pointerdown', recordPointerToPaint, {
        capture: true,
      });
      canvas.removeEventListener('pointermove', recordPointerToPaint, {
        capture: true,
      });
    },
  };
}

function writeCanvasDiagnosticsProbe(
  canvas: HTMLCanvasElement,
  metrics: SpiceRuntimeDiagnostics,
  mainThreadProbe: MainThreadProbeHandle,
) {
  const startedAt = performance.now();
  const runtimePerformance = metrics.performance;
  const payload = JSON.stringify({
    backend: metrics.backend,
    graphicsPath: metrics.displayStack.graphicsPath,
    stage: metrics.session.stage,
    channels: metrics.session.channels,
    audio: {
      mode: metrics.audio.mode,
      channels: metrics.audio.channels,
      sampleRate: metrics.audio.sampleRate,
      chunkCount: metrics.audio.chunkCount,
      channelOpen: metrics.audio.channelOpen,
      unsupportedMode: metrics.audio.unsupportedMode,
      latencyMs: metrics.audio.latencyMs,
      muted: metrics.audio.muted,
    },
    firstFrameMs: runtimePerformance.firstFrameMs,
    p95PacketToPresentMs: runtimePerformance.p95PacketToPresentMs,
    avgQueueAgeMs: runtimePerformance.avgQueueAgeMs,
    workerPoolSize: runtimePerformance.workerPoolSize,
    activeWorkers: runtimePerformance.activeWorkers,
    queuedTasks: runtimePerformance.queuedTasks,
    decodeQueueDepths: runtimePerformance.decodeQueueDepths,
    applyBlockedOnDecode: runtimePerformance.applyBlockedOnDecode,
    pendingMessages: runtimePerformance.pendingMessages,
    ingressQueueDepth: runtimePerformance.ingressQueueDepth,
    ingressQueuedBytes: runtimePerformance.ingressQueuedBytes,
    ingressBufferedBytes: runtimePerformance.ingressBufferedBytes,
    ingressAckCount: runtimePerformance.ingressAckCount,
    avgIngressAckMs: runtimePerformance.avgIngressAckMs,
    plannedOps: runtimePerformance.plannedOps,
    runQueueDepth: runtimePerformance.runQueueDepth,
    cpuPixelMathArea: runtimePerformance.cpuPixelMathArea,
    presentDebt: runtimePerformance.presentDebt,
    regionTokenRejects: runtimePerformance.regionTokenRejects,
    regionOwnershipEntries: runtimePerformance.regionOwnershipEntries,
    regionOwnershipPrunedEntries:
      runtimePerformance.regionOwnershipPrunedEntries,
    pendingPresentSurfaces: runtimePerformance.pendingPresentSurfaces,
    frameAssemblerPendingOps: runtimePerformance.frameAssemblerPendingOps,
    frameAssemblerRolledOps: runtimePerformance.frameAssemblerRolledOps,
    droppedStaleOps: runtimePerformance.droppedStaleOps,
    dominanceCanceledOps: runtimePerformance.dominanceCanceledOps,
    wholeScreenBlockCount: runtimePerformance.wholeScreenBlockCount,
    oldWorkContinuedAfterNewOwner:
      runtimePerformance.oldWorkContinuedAfterNewOwner,
    qxlBandMode: runtimePerformance.qxlBandMode,
    qxlBandPendingItems: runtimePerformance.qxlBandPendingItems,
    qxlBandMaxSize: runtimePerformance.qxlBandMaxSize,
    qxlBandSentinelTrips: runtimePerformance.qxlBandSentinelTrips,
    nativeDeferredBitmapUploads: runtimePerformance.nativeDeferredBitmapUploads,
    nativeDeferredBitmapCommits: runtimePerformance.nativeDeferredBitmapCommits,
    nativeDeferredBitmapDrops: runtimePerformance.nativeDeferredBitmapDrops,
    nativeDeferredBitmapFlushes: runtimePerformance.nativeDeferredBitmapFlushes,
    nativeDeferredBitmapFlushItems:
      runtimePerformance.nativeDeferredBitmapFlushItems,
    nativeDeferredBitmapMaxFlushItems:
      runtimePerformance.nativeDeferredBitmapMaxFlushItems,
    packetZeroCopyBodies: runtimePerformance.packetZeroCopyBodies,
    packetCopiedBodyBytes: runtimePerformance.packetCopiedBodyBytes,
    packetAsyncConcatCount: runtimePerformance.packetAsyncConcatCount,
    presentCoalescedCount: runtimePerformance.presentCoalescedCount,
    presentUrgentCount: runtimePerformance.presentUrgentCount,
    nativePresentSkippedForPending:
      runtimePerformance.nativePresentSkippedForPending,
    presentPacingAvgDelayMs: runtimePerformance.presentPacingAvgDelayMs,
    gpuUploadArenaHits: runtimePerformance.gpuUploadArenaHits,
    gpuUploadArenaMisses: runtimePerformance.gpuUploadArenaMisses,
    gpuBindGroupReuseHits: runtimePerformance.gpuBindGroupReuseHits,
    gpuBindGroupReuseMisses: runtimePerformance.gpuBindGroupReuseMisses,
    sharedMemoryRequested: runtimePerformance.sharedMemoryRequested,
    sharedMemoryEligible: runtimePerformance.sharedMemoryEligible,
    sharedMemoryEnabled: runtimePerformance.sharedMemoryEnabled,
    sharedMemoryDisabledReason: runtimePerformance.sharedMemoryDisabledReason,
    sharedMemoryBodies: runtimePerformance.sharedMemoryBodies,
    sharedMemoryBodyBytes: runtimePerformance.sharedMemoryBodyBytes,
    sharedMemoryFallbackCopies: runtimePerformance.sharedMemoryFallbackCopies,
    gpuMathOps: runtimePerformance.gpuMathOps,
    gpuMathArea: runtimePerformance.gpuMathArea,
    gpuComputeOps: runtimePerformance.gpuComputeOps,
    gpuComputeArea: runtimePerformance.gpuComputeArea,
    presentsRequested: metrics.debug.presentsRequested,
    presentsCompleted: metrics.debug.presentsCompleted,
    nativeChannels: metrics.debug.nativeChannels,
    channelSockets: metrics.debug.channelSockets,
    displayPackets: metrics.debug.displayPackets,
    displayEventFilters: metrics.debug.displayEventFilters,
    displayMessageCounts: runtimePerformance.displayMessageCounts,
    displayEventCounts: runtimePerformance.displayEventCounts,
    displayErrorCounts: runtimePerformance.displayErrorCounts,
    drawCopyKinds: metrics.debug.drawCopyKinds,
    drawCopyRops: metrics.debug.drawCopyRops,
    recentDisplayOps: metrics.debug.recentDisplayOps,
    lastDecodedSample: metrics.debug.lastDecodedSample,
    unsupported: metrics.unsupported.slice(-16),
    unsupportedCounts: runtimePerformance.unsupportedCounts,
    mainThread: mainThreadProbe.snapshot(),
  });
  canvas.dataset.spiceDiagnostics = payload;
  canvas.dataset.spiceDiagnosticsMode = 'compact';
  canvas.dataset.spiceStage = metrics.session.stage;
  canvas.dataset.spiceBackend = metrics.backend;
  mainThreadProbe.recordDiagnosticsWrite(
    performance.now() - startedAt,
    payload.length,
  );
}

function clearCanvasDiagnosticsProbe(canvas: HTMLCanvasElement | null) {
  if (!canvas) {
    return;
  }

  delete canvas.dataset.spiceDiagnostics;
  delete canvas.dataset.spiceDiagnosticsMode;
  delete canvas.dataset.spiceStage;
  delete canvas.dataset.spiceBackend;
}

export function measureGraphicalResizeTarget(
  viewport: HTMLElement,
  canvas: HTMLCanvasElement | null,
) {
  const canvasRect = canvas?.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const width =
    canvasRect && canvasRect.width > 0
      ? canvasRect.width
      : viewport.clientWidth || viewportRect.width;
  const height =
    canvasRect && canvasRect.height > 0
      ? canvasRect.height
      : viewport.clientHeight || viewportRect.height;
  const rounded = {
    width: Math.round(width),
    height: Math.round(height),
  };

  if (
    rounded.width < RESIZE_TARGET_MIN_PX ||
    rounded.height < RESIZE_TARGET_MIN_PX
  ) {
    return null;
  }

  return rounded;
}

function cancelConsoleOperation(operation: string | undefined) {
  if (!operation) {
    return;
  }

  void fetch(operation, { method: 'DELETE', keepalive: true }).catch(() => {});
}

export function useSpiceSession({
  enabled,
  instanceClass,
  canvasRef,
  forceTakeoverToken = 0,
  onConsoleInUse,
  autoResize = true,
  sharedMemoryFastPath = false,
  webUsbRedirection = false,
  webDavShare = null,
  qxlFrameBands = false,
  liveDiagnostics = false,
}: UseSpiceSessionOptions) {
  const sessionRef = useRef<SpiceGraphicalSession | null>(null);
  const connectionPromiseRef = useRef<
    Promise<Awaited<ReturnType<InstanceClass['createConsoleConnection']>>> | null
  >(null);
  const latestDiagnosticsRef = useRef<SpiceRuntimeDiagnostics | null>(null);
  const [connectNonce, setConnectNonce] = useState(0);
  const [status, setStatus] = useState<GraphicalStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [backendPolicy, setBackendPolicy] = useState<{
    disableWebGpu?: boolean;
    disableWebGl2?: boolean;
  }>(() => {
    if (typeof window === 'undefined') {
      return {};
    }
    const search = new URLSearchParams(window.location.search);
    const disableWebGpu =
      parseBooleanFlag(
        search.get('spice_disableWebGpu') ?? search.get('disableWebGpu'),
      ) === true;
    return disableWebGpu ? { disableWebGpu: true } : {};
  });
  const [resolution, setResolution] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [monitorsConfig, setMonitorsConfig] =
    useState<SessionMonitorsConfig | null>(null);
  const [diagnostics, setDiagnostics] =
    useState<SpiceRuntimeDiagnostics | null>(null);
  const [webUsbRuntimeAvailable, setWebUsbRuntimeAvailable] = useState(false);
  const { isFullscreen, targetRef: viewportRef, toggleFullscreen } =
    useConsoleFullscreen();

  const reconnect = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    connectionPromiseRef.current = null;
    setStatus('idle');
    setError(null);
    setResolution(null);
    setMonitorsConfig(null);
    latestDiagnosticsRef.current = null;
    setDiagnostics(null);
    setWebUsbRuntimeAvailable(false);
    setConnectNonce((current) => current + 1);
  }, []);

  const sendShortcut = useCallback((shortcut: ConsoleShortcutId) => {
    sessionRef.current?.sendShortcut(shortcut);
  }, []);

  const attachUsbDevice = useCallback(async () => {
    if (
      !webUsbRedirection ||
      !webUsbRuntimeAvailable ||
      typeof navigator === 'undefined'
    ) {
      return;
    }
    const device = await requestClientWebUsbDevice(
      navigator as unknown as {
        usb?: {
          requestDevice(options: {
            filters: Array<Record<string, number>>;
          }): Promise<ClientWebUsbDevice>;
        };
      },
    );
    sessionRef.current?.attachWebUsbDevice(device);
  }, [webUsbRedirection, webUsbRuntimeAvailable]);

  useEffect(() => {
    if (!enabled || !instanceClass || !canvasRef.current) {
      if (!enabled) {
        sessionRef.current?.dispose();
        sessionRef.current = null;
        connectionPromiseRef.current = null;
        setMonitorsConfig(null);
        setWebUsbRuntimeAvailable(false);
      }
      return;
    }

    let cancelled = false;
    const preparedCanvas = SpiceGraphicalSession.prepareCanvas(canvasRef.current);
    canvasRef.current = preparedCanvas;
    const canvas = preparedCanvas;
    let pendingProbeMetrics: SpiceRuntimeDiagnostics | null = null;
    let probeTimer: number | null = null;
    let lastReactMetrics: SpiceRuntimeDiagnostics | null = null;
    let activeOperation: string | undefined;
    let activeOperationCanceled = false;
    let activeConnectionPromise: Promise<
      Awaited<ReturnType<InstanceClass['createConsoleConnection']>>
    > | null = null;
    const mainThreadProbe = createMainThreadProbe(canvas);
    window.__spiceMainThreadProbe = {
      snapshot: mainThreadProbe.snapshot,
    };

    const cancelActiveOperation = () => {
      if (activeOperationCanceled) {
        return;
      }
      activeOperationCanceled = true;
      cancelConsoleOperation(activeOperation);
      activeOperation = undefined;
    };

    const clearActiveConnectionPromise = () => {
      if (
        activeConnectionPromise &&
        connectionPromiseRef.current === activeConnectionPromise
      ) {
        connectionPromiseRef.current = null;
      }
      activeConnectionPromise = null;
    };

    const disposeActiveSessionAndOperation = () => {
      sessionRef.current?.dispose();
      sessionRef.current = null;
      clearActiveConnectionPromise();
      cancelActiveOperation();
    };

    const publishReactDiagnostics = (metrics: SpiceRuntimeDiagnostics) => {
      lastReactMetrics = metrics;
      startTransition(() => {
        setDiagnostics(metrics);
      });
    };

    const flushProbeDiagnostics = () => {
      probeTimer = null;
      const metrics = pendingProbeMetrics;
      pendingProbeMetrics = null;
      if (!metrics || cancelled) {
        return;
      }

      writeCanvasDiagnosticsProbe(canvas, metrics, mainThreadProbe);
    };

    const scheduleProbeDiagnostics = (metrics: SpiceRuntimeDiagnostics) => {
      pendingProbeMetrics = metrics;
      if (probeTimer !== null) {
        return;
      }

      probeTimer = window.setTimeout(
        flushProbeDiagnostics,
        DIAGNOSTICS_PROBE_INTERVAL_MS,
      );
    };

  const shouldPublishReactDiagnosticsNow = (
    metrics: SpiceRuntimeDiagnostics,
  ) => {
      if (liveDiagnostics) {
        return true;
      }
      if (!lastReactMetrics) {
        return true;
      }

      return (
        metrics.session.stage !== lastReactMetrics.session.stage ||
        metrics.backend !== lastReactMetrics.backend ||
        metrics.fallbackReason !== lastReactMetrics.fallbackReason
      );
    };

    const scheduleReactDiagnostics = (metrics: SpiceRuntimeDiagnostics) => {
      if (shouldPublishReactDiagnosticsNow(metrics)) {
        publishReactDiagnostics(metrics);
      }
    };

    const connect = async () => {
      setStatus('connecting');
      setError(null);

      try {
        if (!connectionPromiseRef.current) {
          const force = forceTakeoverToken > 0;
          connectionPromiseRef.current = instanceClass.createConsoleConnection(
            'vga',
            force ? { force: true } : undefined,
          );
        }

        activeConnectionPromise = connectionPromiseRef.current;
        const bootstrap = await activeConnectionPromise;
        activeOperation = bootstrap.operation;
        if (cancelled) {
          cancelActiveOperation();
          clearActiveConnectionPromise();
          return;
        }

        const session = new SpiceGraphicalSession({
          websockets: bootstrap.websockets,
          canvas,
          cacheScope: instanceClass.name,
          debugLiveLogging: readSpiceLiveLoggingSearchParam(),
          debugDiagnosticReadbacks:
            typeof window !== 'undefined' &&
            parseBooleanFlag(
              new URLSearchParams(window.location.search).get(
                'spice_diagnosticReadbacks',
              ) ??
                new URLSearchParams(window.location.search).get(
                  'diagnosticReadbacks',
                ),
            ) === true,
          backendPolicy,
          portBackends: webDavShare
            ? [createWebDavPortBackend(webDavShare)]
            : undefined,
          runtimeToggles: {
            qxlFrameBands,
            rawBitmapCoalesce: !qxlFrameBands,
            sharedMemoryBuffers: sharedMemoryFastPath,
          },
          webUsbRedirection: webUsbRedirection && clientWebUsbAvailable(),
          onError: ({ message, recoverableBackend, fallbackBackend }) => {
            if (!cancelled) {
              if (recoverableBackend === 'webgpu') {
                disposeActiveSessionAndOperation();
                setBackendPolicy((current) => {
                  if (current.disableWebGpu) {
                    return current;
                  }
                  return { ...current, disableWebGpu: true };
                });
                setStatus('idle');
                setError(
                  fallbackBackend
                    ? `Recovering from ${recoverableBackend} to ${fallbackBackend}…`
                    : `Recovering from ${recoverableBackend}…`,
                );
                setConnectNonce((current) => current + 1);
                return;
              }

              if (recoverableBackend === 'webgl2') {
                disposeActiveSessionAndOperation();
                setBackendPolicy((current) => {
                  if (current.disableWebGl2) {
                    return current;
                  }
                  return {
                    ...current,
                    disableWebGpu: true,
                    disableWebGl2: true,
                  };
                });
                setStatus('idle');
                setError(
                  fallbackBackend
                    ? `Recovering from ${recoverableBackend} to ${fallbackBackend}…`
                    : `Recovering from ${recoverableBackend}…`,
                );
                setConnectNonce((current) => current + 1);
                return;
              }

              disposeActiveSessionAndOperation();
              setStatus('error');
              setError(message);
            }
          },
          onReady: () => {
            if (!cancelled) {
              setStatus('ready');
            }
          },
          onResolution: (width, height) => {
            if (!cancelled) {
              setResolution({ width, height });
            }
          },
          onMonitorsConfig: (config) => {
            if (!cancelled) {
              setMonitorsConfig(config);
            }
          },
          onDiagnostics: (metrics) => {
            if (!cancelled) {
              mainThreadProbe.recordDiagnosticsReceived();
              latestDiagnosticsRef.current = metrics;
              scheduleProbeDiagnostics(metrics);
              scheduleReactDiagnostics(metrics);
            }
          },
          onWebUsbStatus: (webUsbStatus) => {
            if (!cancelled) {
              setWebUsbRuntimeAvailable(webUsbStatus.available);
            }
          },
        });

        sessionRef.current = session;
        await session.connect();
      } catch (err) {
        if (cancelled) {
          cancelActiveOperation();
          clearActiveConnectionPromise();
          return;
        }
        disposeActiveSessionAndOperation();
        if (!cancelled) {
          const message = getErrorMessage(err);
          setStatus('error');
          setError(getConsoleConnectionFailureMessage(err));
          connectionPromiseRef.current = null;
          if (isConsoleAlreadyInUseError(err)) {
            onConsoleInUse?.(message);
          }
        }
      }
    };

    const connectTimer = window.setTimeout(() => {
      void connect();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(connectTimer);
      if (probeTimer !== null) {
        window.clearTimeout(probeTimer);
      }
      if (window.__spiceMainThreadProbe?.snapshot === mainThreadProbe.snapshot) {
        delete window.__spiceMainThreadProbe;
      }
      mainThreadProbe.dispose();
      sessionRef.current?.dispose();
      sessionRef.current = null;
      clearActiveConnectionPromise();
      cancelActiveOperation();
      latestDiagnosticsRef.current = null;
      setMonitorsConfig(null);
      setWebUsbRuntimeAvailable(false);
      clearCanvasDiagnosticsProbe(canvas);
    };
  }, [
    backendPolicy,
    canvasRef,
    connectNonce,
    enabled,
    forceTakeoverToken,
    instanceClass,
    liveDiagnostics,
    onConsoleInUse,
    qxlFrameBands,
    sharedMemoryFastPath,
    webDavShare,
    webUsbRedirection,
  ]);

  useEffect(() => {
    if (!enabled || !autoResize || !viewportRef.current) {
      return;
    }

    const target = viewportRef.current;
    let timeoutId: number | null = null;

    const scheduleResize = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      timeoutId = window.setTimeout(() => {
        timeoutId = null;
        const resolution = measureGraphicalResizeTarget(
          target,
          canvasRef.current,
        );
        if (!resolution) {
          return;
        }

        sessionRef.current?.setResolution(resolution.width, resolution.height);
      }, 120);
    };

    scheduleResize();

    const observer = new ResizeObserver(() => {
      scheduleResize();
    });
    observer.observe(target);
    document.addEventListener('fullscreenchange', scheduleResize);

    return () => {
      observer.disconnect();
      document.removeEventListener('fullscreenchange', scheduleResize);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [autoResize, canvasRef, connectNonce, enabled, status, viewportRef]);

  const controller = useMemo<ConsoleSessionController>(() => {
    if (!enabled) {
      return createDisabledConsoleController();
    }

    return {
      canReconnect: true,
      canFullscreen: true,
      canSendShortcuts: status === 'ready',
      canAttachUsb:
        status === 'ready' &&
        webUsbRedirection &&
        webUsbRuntimeAvailable &&
        clientWebUsbAvailable(),
      isFullscreen,
      get diagnostics() {
        return latestDiagnosticsRef.current;
      },
      reconnect,
      toggleFullscreen,
      sendShortcut,
      attachUsbDevice,
    };
  }, [
    attachUsbDevice,
    enabled,
    isFullscreen,
    reconnect,
    sendShortcut,
    status,
    toggleFullscreen,
    webUsbRedirection,
    webUsbRuntimeAvailable,
  ]);

  return {
    controller,
    diagnostics: enabled ? diagnostics : null,
    monitorsConfig: enabled ? monitorsConfig : null,
    viewportRef,
    resolution: enabled ? resolution : null,
    status: enabled ? status : 'idle',
    error: enabled ? error : null,
  };
}

function readSpiceLiveLoggingSearchParam() {
  if (typeof window === 'undefined') {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('spice_diagnostics') ?? params.get('diag');
  if (raw === null) {
    return false;
  }
  if (raw === '') {
    return true;
  }
  return parseBooleanFlag(raw) !== false;
}
