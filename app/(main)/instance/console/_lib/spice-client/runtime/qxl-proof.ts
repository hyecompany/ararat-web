/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export interface QxlHostGuestProofInput {
  incusConfigExpanded?: string | null;
  lspciQxl?: string | null;
  lsmodQxl?: string | null;
  xorgLog?: string | null;
  qxlDevicePresent?: boolean | null;
  qxlKernelModuleLoaded?: boolean | null;
  qxlDdxLoaded?: boolean | null;
  qxlSurfacesEnabled?: boolean | null;
  qxlImageCacheEnabled?: boolean | null;
  qxlFallbackCacheEnabled?: boolean | null;
  qxlDeferredFramesDisabled?: boolean | null;
}

export interface QxlRuntimeProofInput {
  displayStack?: {
    graphicsPath?: string;
    evidence?: string[];
  };
  performance?: {
    gpuSurfaceCopyCount?: number;
    gpuPixelEffectCount?: number;
    gpuMathOps?: number;
    gpuMathArea?: number;
    cpuPixelMathArea?: number;
    directPrimaryUploadCount?: number;
    qxlBandMode?: string;
    qxlBandBitmapStripSamples?: number;
    oldWorkContinuedAfterNewOwner?: number;
    wholeScreenBlockCount?: number;
  };
  debug?: {
    drawCopyKinds?: Record<string, number>;
    lastDrawCopy?: unknown;
  };
}

export interface QxlProofResult {
  ok: boolean;
  missing: string[];
  checks: Record<string, boolean>;
}

export function evaluateQxlHostGuestProof(
  input: QxlHostGuestProofInput,
): QxlProofResult {
  const incusMentionsQxl =
    input.incusConfigExpanded?.toLowerCase().includes('qxl') ?? false;
  const lspciMentionsQxl = input.lspciQxl?.toLowerCase().includes('qxl') ?? false;
  const lsmodMentionsQxl = input.lsmodQxl?.toLowerCase().includes('qxl') ?? false;
  const xorgMentionsQxl = input.xorgLog?.toLowerCase().includes('qxl') ?? false;
  const checks = {
    qxlDevicePresent:
      input.qxlDevicePresent ?? (incusMentionsQxl || lspciMentionsQxl),
    qxlKernelModuleLoaded: input.qxlKernelModuleLoaded ?? lsmodMentionsQxl,
    qxlDdxLoaded: input.qxlDdxLoaded ?? xorgMentionsQxl,
    qxlSurfacesEnabled: input.qxlSurfacesEnabled ?? true,
    qxlImageCacheEnabled: input.qxlImageCacheEnabled ?? true,
    qxlFallbackCacheEnabled: input.qxlFallbackCacheEnabled ?? true,
    qxlDeferredFramesDisabled: input.qxlDeferredFramesDisabled ?? true,
  };
  return proofFromChecks(checks);
}

export function evaluateQxlRendererProof(
  input: QxlRuntimeProofInput,
  options: {
    requireSurfaceImage?: boolean;
    requireGpuSurfaceMath?: boolean;
  } = {},
): QxlProofResult {
  const performance = input.performance ?? {};
  const drawCopyKinds = input.debug?.drawCopyKinds ?? {};
  const hasSurfaceImage =
    Object.keys(drawCopyKinds).some((key) => key.toLowerCase().includes('surface')) ||
    Boolean(input.debug?.lastDrawCopy) ||
    (performance.directPrimaryUploadCount ?? 0) > 0;
  const hasGpuSurfaceMath =
    (performance.gpuSurfaceCopyCount ?? 0) > 0 ||
    (performance.gpuPixelEffectCount ?? 0) > 0 ||
    (performance.gpuMathOps ?? 0) > 0 ||
    (performance.gpuMathArea ?? 0) > 0;
  const checks = {
    spiceSurfacePath:
      input.displayStack?.graphicsPath === 'spice-surface' ||
      input.displayStack?.graphicsPath === 'mixed',
    surfaceImageObserved: options.requireSurfaceImage ? hasSurfaceImage : true,
    gpuSurfaceMathObserved: options.requireGpuSurfaceMath ? hasGpuSurfaceMath : true,
    noOldWorkArtifacts: (performance.oldWorkContinuedAfterNewOwner ?? 0) === 0,
    noWholeScreenBlocks: (performance.wholeScreenBlockCount ?? 0) === 0,
    cpuPixelMathFallbackOnly: (performance.cpuPixelMathArea ?? 0) === 0,
  };
  return proofFromChecks(checks);
}

export function mergeQxlProofResults(
  ...results: QxlProofResult[]
): QxlProofResult {
  const checks: Record<string, boolean> = {};
  for (const result of results) {
    Object.assign(checks, result.checks);
  }
  return proofFromChecks(checks);
}

function proofFromChecks(checks: Record<string, boolean>): QxlProofResult {
  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  return {
    ok: missing.length === 0,
    missing,
    checks,
  };
}
