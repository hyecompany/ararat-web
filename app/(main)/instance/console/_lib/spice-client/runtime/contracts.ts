/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export type ConsoleShortcutId =
  | 'ctrl-alt-delete'
  | 'alt-tab'
  | 'alt-f4'
  | 'ctrl-alt-1'
  | 'ctrl-alt-f2'
  | 'ctrl-alt-f3'
  | 'ctrl-alt-f4';

export type SpiceGraphicsPath =
  | 'detecting'
  | 'spice-surface'
  | 'legacy-mode'
  | 'mixed';

export type SpiceDisplayMode =
  | 'none'
  | 'spice-stream'
  | 'qxl-bitmap-video'
  | 'mixed';

export interface SpiceRuntimeDiagnostics {
  capabilities: {
    webgpu: boolean;
    webgl2: boolean;
    bitmapRenderer: boolean;
    offscreen2d: boolean;
    imageBitmap: boolean;
    imageDecoder: boolean;
    scheduler: boolean;
    webCodecs: boolean;
    webUsb: boolean;
    webDav: boolean;
    sharedMemory: boolean;
  };
  backend: string;
  preferredBackend: string;
  fallbackReason: string | null;
  rendering: {
    usesOffscreenCanvas: boolean;
    canvasOwner: 'worker';
    canvasKind: 'offscreen';
    compositorBackend: string;
    primarySurfaceMode:
      | 'gpu-authoritative'
      | 'cpu-staged'
      | 'offscreen-2d-fallback';
    badge: string;
    details: string;
  };
  displayStack: {
    graphicsPath: SpiceGraphicsPath;
    label: string;
    evidence: string[];
  };
  performance: SpiceRuntimePerformanceDiagnostics;
  audio: SpiceRuntimeAudioDiagnostics;
  debug: SpiceRuntimeDebugDiagnostics;
  session: SpiceRuntimeSessionDiagnostics;
  unsupported: string[];
  trace: string[];
}

export interface SpiceRuntimePerformanceDiagnostics {
  firstFrameMs: number | null;
  avgFrameMs: number | null;
  lastFrameMs: number | null;
  avgPacketToPresentMs: number | null;
  p95PacketToPresentMs: number | null;
  avgQueueAgeMs: number | null;
  workerPoolSize: number;
  activeWorkers: number;
  peakActiveWorkers: number;
  queuedTasks: number;
  peakQueuedTasks: number;
  decodeQueueDepths: Record<string, number>;
  peakDecodeQueueDepths: Record<string, number>;
  decodeWorkerRestarts: number;
  canceledDecodeQueuedTasks: number;
  canceledDecodeInFlightTasks: number;
  decodeCodecStats: Record<string, { count: number; avgMs: number; maxMs: number }>;
  applyBlockedOnDecode: number;
  plannerTargetDecodeWorkers: number | null;
  plannerDecisions: number;
  pendingMessages: number;
  pendingChannelBytes: Record<string, number>;
  ingressQueueDepth: number;
  ingressQueuedBytes: number;
  ingressBufferedBytes: number;
  ingressPacketsConsumed: number;
  ingressBytesConsumed: number;
  ingressAckCount: number;
  ingressAckSyncCount: number;
  avgIngressAckMs: number | null;
  lastIngressAckMs: number | null;
  plannedOps: number;
  canceledQueuedOps: number;
  canceledInFlightOps: number;
  droppedLateResults: number;
  runQueueDepth: number;
  peakRunQueueDepth: number;
  laneDepths: Record<string, number>;
  schedulerConcurrency: number;
  pendingPresentSurfaces: number;
  lastPresentRectCount: number;
  lastPresentUploadCount: number;
  lastPresentUploadArea: number;
  mergedPresentCount: number;
  stripedDecodeJobs: number;
  stripedDecodeTiles: number;
  directPrimaryUploadCount: number;
  directPrimaryUploadArea: number;
  nativePendingBitmapUploads: number;
  nativePendingBitmapUploadBytes: number;
  nativeDeferredBitmapUploads: number;
  nativeDeferredBitmapCommits: number;
  nativeDeferredBitmapDrops: number;
  nativeDeferredBitmapPeakUploads: number;
  nativeDeferredBitmapPeakBytes: number;
  nativeDeferredBitmapFlushes: number;
  nativeDeferredBitmapFlushItems: number;
  nativeDeferredBitmapMaxFlushItems: number;
  droppedStaleOps: number;
  dominanceCanceledOps: number;
  dominanceCanceledArea: number;
  regionPreemptions: number;
  oldRegionJobsKilled: number;
  obsoleteGpuSubmissionsAvoided: number;
  lateGpuResultsRejected: number;
  unrelatedRegionsPresentedWhileBlocked: number;
  wholeScreenBlockCount: number;
  oldWorkContinuedAfterNewOwner: number;
  qxlBandMode: SpiceDisplayMode;
  qxlBandActive: boolean;
  qxlBandPendingItems: number;
  qxlBandsStarted: number;
  qxlBandsFlushed: number;
  qxlBandItems: number;
  qxlBandAvgSize: number;
  qxlBandMaxSize: number;
  qxlBandFlushReasons: Record<string, number>;
  qxlBandSentinelTrips: number;
  qxlBandSentinelUntilMs: number | null;
  qxlBandStreamSamples: number;
  qxlBandBitmapStripSamples: number;
  qxlBandBypassItems: number;
  packetZeroCopyBodies: number;
  packetCopiedBodyBytes: number;
  packetAsyncConcatCount: number;
  presentCoalescedCount: number;
  presentUrgentCount: number;
  nativePresentSkippedForPending: number;
  presentPacingAvgDelayMs: number;
  gpuUploadArenaHits: number;
  gpuUploadArenaMisses: number;
  gpuBindGroupReuseHits: number;
  gpuBindGroupReuseMisses: number;
  batchedBitmapOps: number;
  batchedBitmapRects: number;
  presentDebt: number;
  peakPresentDebt: number;
  surfaceGenerationSkips: number;
  regionTokenRejects: number;
  regionOwnershipEntries: number;
  regionOwnershipTileBuckets: number;
  regionOwnershipTileRefs: number;
  regionOwnershipPrunedEntries: number;
  regionOwnershipRetainedPlanTokens: number;
  mutationTicketCommits: number;
  mutationTicketRejects: number;
  protocolSideEffectJobs: number;
  protocolSideEffectJobFailures: number;
  inputKeyDownSends: number;
  inputKeyUpSends: number;
  inputMouseButtonSends: number;
  avgBatchSize: number;
  largestBatchSize: number;
  avgCommitBatchSize: number;
  largestCommitBatchSize: number;
  avgMergedDirtyRects: number;
  decodeCacheHits: number;
  decodeCacheMisses: number;
  gpuCacheHits: number;
  gpuCacheMisses: number;
  cacheInvalidations: Record<string, number>;
  persistentDecodeCacheHits: number;
  persistentDecodeCacheMisses: number;
  persistentDecodeCacheWrites: number;
  persistentDecodeCacheFailures: number;
  persistentDecodeCacheStaleDiscards: number;
  uploadPrepCacheHits: number;
  uploadPrepCacheMisses: number;
  cacheEvictionsRam: number;
  cacheEvictionsVram: number;
  decodeCacheBytes: number;
  gpuCacheBytes: number;
  frameAssemblerPendingOps: number;
  frameAssemblerCommittedOps: number;
  frameAssemblerRolledOps: number;
  noOpApplyRejects: number;
  cacheMissNoCommit: number;
  streamOrderedApplies: number;
  streamFrameDecodeSources: Record<string, number>;
  streamFrameApplySources: Record<string, number>;
  gpuCopyBitsCount: number;
  cpuCopyBitsFallbackCount: number;
  gpuSurfaceCopyCount: number;
  gpuPixelEffectCount: number;
  presentCanvasSnapshotCount: number;
  gpuMathOps: number;
  gpuMathArea: number;
  gpuComputeOps: number;
  gpuComputeArea: number;
  gpuQueueSubmits: number;
  gpuEmptyQueueSubmits: number;
  gpuTextureWrites: number;
  gpuTextureUploadBytes: number;
  gpuExternalTextureCopies: number;
  gpuComputeDispatches: number;
  gpuBitmapComputeDispatches: number;
  gpuRgbaComputeDispatches: number;
  gpuRopComputeDispatches: number;
  gpuRenderPasses: number;
  gpuPresentRenderPasses: number;
  cpuPixelMathArea: number;
  cpuPixelMathReasons: Record<string, number>;
  decodeWaitersCanceled: number;
  nativeDecodeReady: boolean;
  nativeDecodeCapabilities: Record<string, boolean>;
  browserImageDecodeJobs: number;
  browserVideoDecodeJobs: number;
  browserDecodeFailures: number;
  browserDecodeStaleDrops: number;
  browserDecodeClosedOutputs: number;
  browserDecodeReadbackFallbacks: number;
  browserCodecSupport: Record<string, boolean>;
  webCodecsImageDecoderJobs: number;
  webCodecsVideoDecoderJobs: number;
  imageBitmapDecodeJobs: number;
  displayInitGlzEnabled: boolean;
  glzDictionaryBytes: number;
  glzDictionaryEntries: number;
  glzDictionaryWindowBytes: number;
  orderingBarriers: number;
  paletteCacheHits: number;
  paletteCacheMisses: number;
  paletteCacheEvictions: number;
  lzPltDecodeCount: number;
  gpuPrimaryWriteArea: number;
  cpuMirrorSyncCount: number;
  orderedCommandStallMs: number;
  unsupportedCounts: Record<string, number>;
  displayMessageCounts: Record<string, number>;
  displayEventCounts: Record<string, number>;
  displayErrorCounts: Record<string, number>;
  noCommitReasons: Record<string, number>;
  sharedMemoryRequested: boolean;
  sharedMemoryEligible: boolean;
  sharedMemoryEnabled: boolean;
  sharedMemoryDisabledReason: string | null;
  sharedMemoryBodies: number;
  sharedMemoryBodyBytes: number;
  sharedMemoryFallbackCopies: number;
  sharedDecodeBufferRequests: number;
  sharedDecodeBufferBytes: number;
  transferredDecodeBufferBytes: number;
}

export interface SpiceRuntimeAudioDiagnostics {
  mode: number;
  channels: number;
  sampleRate: number;
  multimediaTime: number | null;
  chunkCount: number;
  bufferedMs: number;
  underruns: number;
  lateChunks: number;
  volume: number[] | null;
  muted: boolean | null;
  latencyMs: number | null;
  sink: string;
  channelAttempted: boolean;
  channelOpen: boolean;
  socketSource: string | null;
  unsupportedMode: string | null;
  contextState: string;
}

export interface SpiceRuntimeDebugDiagnostics {
  nativeChannels: Record<
    string,
    {
      channelType: number;
      channelId: number;
      phase: string;
      bufferedBytes: number;
      parsedMiniMessages: number;
      lastMessageType: number | null;
      lastBodySize: number | null;
      pendingMessageType: number | null;
      pendingBodySize: number | null;
      ackWindow: number;
      packetsSinceAck: number;
    }
  >;
  channelSockets: Record<
    string,
    {
      open: boolean;
      readyState: number;
      queuedBytes: number;
      sentMessages: number;
      sentBytes: number;
      receivedMessages: number;
      receivedBytes: number;
      ingressBatchFlushes?: number;
      ingressBatchedMessages?: number;
      ingressBatchedBytes?: number;
      ingressBatchConcatBytes?: number;
    }
  >;
  displayPackets: Record<string, number>;
  displayEventFilters: Record<string, number>;
  drawCopyKinds: Record<string, number>;
  drawCopyRops: Record<string, number>;
  recentDisplayOps: Array<{
    atMs: number;
    type: number;
    kind: string | null;
    ropDescriptor: number | null;
    imageDescriptorType: number | null;
    bitmapFormat: number | null;
    bitmapFlags: number | null;
    imageWidth: number | null;
    imageHeight: number | null;
    imageStride: number | null;
    lzType: number | null;
    imageDataLength: number | null;
    box: { left: number; top: number; right: number; bottom: number } | null;
  }>;
  lastDecodedSample: {
    codec: string;
    width: number;
    height: number;
    byteLength: number;
    firstBytesChecksum: number;
    firstBytesNonZero: number;
  } | null;
  presentsRequested: number;
  presentsCompleted: number;
  lastPresentBackend: {
    backend: string;
    mode?: string;
    uploadCount: number;
    uploadArea: number;
  } | null;
  lastPrimarySample: {
    surfaceId: number;
    checksum: number;
    width: number;
    height: number;
  } | null;
  lastPresentationSample: {
    checksum: number;
    width: number;
    height: number;
  } | null;
  lastDrawCopy: {
    kind: string;
    surfaceId: number;
    box: { left: number; top: number; right: number; bottom: number };
    sourceRect: { left: number; top: number; right: number; bottom: number };
    imageDescriptorType: number;
    imageDescriptorId: string;
    sourceSurfaceId: number | null;
  } | null;
}

export interface SpiceRuntimeSessionDiagnostics {
  stage: string;
  channels: {
    control: boolean;
    main: boolean;
    display: boolean;
    cursor: boolean;
    inputs: boolean;
    playback: boolean;
    record: boolean;
    port: boolean;
    webdav: boolean;
  };
  sessionId: number | null;
  currentMouseMode: number | null;
  multimediaTime: number | null;
  lastNotify: string | null;
  waitCount: number;
}
