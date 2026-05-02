/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

'use client';

import { useEffect, useRef } from 'react';
import { Spinner } from 'ui-web/components/spinner';
import { Alert, AlertDescription, AlertTitle } from 'ui-web/components/alert';
import { cn } from 'ui-web/lib/utils';
import InstanceClass from '../../../_lib/instance';
import { useSpiceSession } from '../_hooks/use-spice-session';
import type { WebDavDirectoryShare } from '../_lib/spice-client/webdav-fs-access';
import {
  createDisabledConsoleController,
  type ConsoleSessionController,
} from '../_lib/shortcuts';
import type { SpiceStreamingTuningStatus } from '../_lib/qxl-graphics';

interface GraphicalConsoleViewProps {
  enabled: boolean;
  instanceClass: InstanceClass | null;
  forceTakeoverToken: number;
  onConsoleInUse: (message: string) => void;
  onControllerChange: (controller: ConsoleSessionController) => void;
  variant?: 'embedded' | 'standalone';
  showStatusOverlay?: boolean;
  showDiagnosticsOverlay?: boolean;
  autoResize?: boolean;
  sharedMemoryFastPath?: boolean;
  webUsbRedirection?: boolean;
  webDavShare?: WebDavDirectoryShare | null;
  qxlFrameBands?: boolean;
  spiceStreamingTuning?: SpiceStreamingTuningStatus | null;
}

function formatBytesCompact(bytes: number | null | undefined) {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return '0b';
  }
  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(1)}g`;
  }
  if (value >= 1024 * 1024) {
    return `${Math.round(value / (1024 * 1024))}m`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)}k`;
  }
  return `${Math.round(value)}b`;
}

export default function GraphicalConsoleView({
  enabled,
  instanceClass,
  forceTakeoverToken,
  onConsoleInUse,
  onControllerChange,
  variant = 'embedded',
  showStatusOverlay = true,
  showDiagnosticsOverlay = false,
  autoResize = true,
  sharedMemoryFastPath = false,
  webUsbRedirection = false,
  webDavShare = null,
  qxlFrameBands = false,
  spiceStreamingTuning = null,
}: GraphicalConsoleViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { controller, diagnostics, error, status, viewportRef } =
    useSpiceSession({
      enabled,
      instanceClass,
      canvasRef,
      forceTakeoverToken,
      onConsoleInUse,
      autoResize,
      sharedMemoryFastPath,
      webUsbRedirection,
      webDavShare,
      qxlFrameBands,
      liveDiagnostics: showDiagnosticsOverlay,
    });

  useEffect(() => {
    onControllerChange(controller);
  }, [controller, onControllerChange]);

  useEffect(() => {
    return () => {
      onControllerChange(createDisabledConsoleController());
    };
  }, [onControllerChange]);

  const isStandalone = variant === 'standalone';
  const graphicsPath = diagnostics?.displayStack.graphicsPath ?? 'detecting';
  const graphicsPathLabel =
    graphicsPath === 'spice-surface'
      ? 'spice surface'
      : graphicsPath === 'legacy-mode'
        ? 'legacy'
        : graphicsPath === 'mixed'
          ? 'mixed'
          : 'detecting';
  const performance = diagnostics?.performance;
  const streamPacketCount =
    (performance?.displayMessageCounts?.['123'] ?? 0) +
    (performance?.displayMessageCounts?.['316'] ?? 0);
  const streamEventCount =
    (performance?.displayEventCounts?.streamData ?? 0) +
    (performance?.displayEventCounts?.streamDataSized ?? 0);
  const rawDrawCount = performance?.displayMessageCounts?.['304'] ?? 0;
  const copiedBodyBytes = performance?.packetCopiedBodyBytes ?? 0;
  const rawDrawFlood =
    rawDrawCount >= 60 && streamPacketCount === 0 && copiedBodyBytes >= 64 * 1024 * 1024;
  const streamMode = spiceStreamingTuning?.configuredMode ?? null;
  const streamStatusLabel = streamMode ?? 'unset';
  const streamWarning =
    showDiagnosticsOverlay &&
    spiceStreamingTuning?.hasQxlGraphics === true &&
    rawDrawFlood
      ? streamMode === null || streamMode === 'off'
        ? 'SPICE server stream not observed; QXL is sending raw draw-copy traffic.'
        : streamMode === 'filter'
          ? 'SPICE stream is configured as filter, but this workload has not promoted to a stream.'
          : 'SPICE streaming is configured, but this workload is still raw draw-copy traffic.'
      : null;
  const diagnosticsLabel = diagnostics
    ? [
        diagnostics.backend,
        diagnostics.session.stage,
        `gpu:${performance?.gpuMathOps ?? 0}`,
        `cmp:${performance?.gpuComputeOps ?? 0}`,
        `disp:${performance?.gpuComputeDispatches ?? 0}`,
        `bmp:${performance?.gpuBitmapComputeDispatches ?? 0}`,
        `sub:${performance?.gpuQueueSubmits ?? 0}`,
        `pass:${performance?.gpuRenderPasses ?? 0}`,
        `tex:${performance?.gpuTextureWrites ?? 0}`,
        `tx:${formatBytesCompact(performance?.gpuTextureUploadBytes)}`,
        `np:${performance?.nativePendingBitmapUploads ?? 0}`,
        `nq:${formatBytesCompact(performance?.nativePendingBitmapUploadBytes)}`,
        `nd:${performance?.nativeDeferredBitmapDrops ?? 0}`,
        `img:${performance?.browserImageDecodeJobs ?? 0}`,
        `pix:${performance?.gpuPixelEffectCount ?? 0}`,
        `stale:${performance?.browserDecodeStaleDrops ?? 0}`,
        `fail:${performance?.browserDecodeFailures ?? 0}`,
        `q:${performance?.queuedTasks ?? 0}/${performance?.activeWorkers ?? 0}`,
        `m123:${streamPacketCount}`,
        `m304:${rawDrawCount}`,
        `eStream:${streamEventCount}`,
        `eDraw:${performance?.displayEventCounts?.draw ?? 0}`,
        `ingress:${performance?.ingressBytesConsumed ?? 0}`,
        `copy:${formatBytesCompact(copiedBodyBytes)}`,
        `sv:${streamStatusLabel}`,
        `shared:${performance?.sharedMemoryEnabled ? 'on' : 'off'}`,
      ].join(' ')
    : graphicsPathLabel;

  return (
    <div
      className={cn(
        'flex w-full flex-col',
        isStandalone ? 'h-svh min-h-0' : undefined,
      )}
      style={isStandalone ? undefined : { height: '60vh', minHeight: '300px' }}
    >
      <div
        ref={viewportRef}
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden bg-black',
          isStandalone ? undefined : 'rounded-lg border shadow-sm',
        )}
      >
        <canvas 
          ref={canvasRef} 
          className="absolute inset-0 w-full h-full object-contain outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        />
        {showDiagnosticsOverlay && (
          <div
            className="pointer-events-none absolute left-2 top-2 rounded border border-white/15 bg-black/70 px-2 py-1 font-mono text-[10px] uppercase tracking-normal text-white/85 shadow-sm"
            title={
              diagnostics
                ? `${diagnostics.displayStack.label}: ${diagnostics.displayStack.evidence.join(' | ')}`
                : undefined
            }
          >
            {diagnosticsLabel}
          </div>
        )}
        {streamWarning && (
          <div
            className="pointer-events-none absolute bottom-2 left-2 max-w-[min(34rem,calc(100%-1rem))] rounded border border-amber-300/40 bg-amber-950/80 px-2 py-1 text-[11px] leading-snug text-amber-50 shadow-sm"
            title={
              spiceStreamingTuning?.configuredSource
                ? `Detected streaming-video=${streamMode} in ${spiceStreamingTuning.configuredSource}.`
                : 'Incus does not expose SPICE streaming as a first-class VM option; configure the VM explicitly if you want server-side stream promotion.'
            }
          >
            {streamWarning} Raw copied bodies: {formatBytesCompact(copiedBodyBytes)}.
          </div>
        )}
        
        {showStatusOverlay && status === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 text-white">
            <Spinner className="size-6" />
            <p className="text-sm">Connecting to clean-sheet console…</p>
          </div>
        )}
        {showStatusOverlay && status === 'error' && (
          <div className="absolute inset-4">
            <Alert variant="destructive">
              <AlertTitle>Graphical console unavailable</AlertTitle>
              <AlertDescription>
                {error ?? 'Unable to initialize the clean-sheet console.'}
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
    </div>
  );
}
