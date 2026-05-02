/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { chromium, type Page } from 'playwright';

const instance = process.env.SPICE_SMOKE_INSTANCE ?? 'win11';
const seconds = Number(process.env.SPICE_SMOKE_SECONDS ?? '30');
const baseUrl =
  process.env.SPICE_SMOKE_URL ??
  `http://localhost:3001/ui/instance/console/window?name=${encodeURIComponent(instance)}&takeover=1`;
const headless = process.env.SPICE_SMOKE_HEADLESS === '1';
const maxP95Ms = Number(process.env.SPICE_SMOKE_MAX_P95_MS ?? '75');
const navTimeoutMs = Number(process.env.SPICE_SMOKE_NAV_TIMEOUT_MS ?? '30000');
const diagnosticsTimeoutMs = Number(
  process.env.SPICE_SMOKE_DIAGNOSTICS_TIMEOUT_MS ?? '30000',
);
const maxIngressQueueDepth = Number(
  process.env.SPICE_SMOKE_MAX_INGRESS_QUEUE_DEPTH ?? '512',
);
const drainGraceMs = Number(process.env.SPICE_SMOKE_DRAIN_GRACE_MS ?? '5000');
const maxIngressAckMs = Number(process.env.SPICE_SMOKE_MAX_ACK_MS ?? '25');
const maxLastIngressAckMs = Number(
  process.env.SPICE_SMOKE_MAX_LAST_ACK_MS ?? '50',
);
const maxQxlBandSentinelTrips = Number(
  process.env.SPICE_SMOKE_MAX_QXL_SENTINEL_TRIPS ?? '0',
);
const requireQxlCoverage =
  process.env.SPICE_SMOKE_REQUIRE_QXL_COVERAGE !== '0';
const maxCpuMirrorSyncs = Number(
  process.env.SPICE_SMOKE_MAX_CPU_MIRROR_SYNCS ?? '0',
);
const maxCpuCopyBitsFallbacks = Number(
  process.env.SPICE_SMOKE_MAX_CPU_COPY_BITS_FALLBACKS ?? '0',
);
const maxCpuPixelMathArea = Number(
  process.env.SPICE_SMOKE_MAX_CPU_PIXEL_MATH_AREA ?? '0',
);
const expectSharedMemory = process.env.SPICE_SMOKE_EXPECT_SHARED_MEMORY === '1';
const minSharedMemoryBodies = Number(
  process.env.SPICE_SMOKE_MIN_SHARED_MEMORY_BODIES ??
    (expectSharedMemory ? '1' : '0'),
);
const maxSharedMemoryFallbackCopies = Number(
  process.env.SPICE_SMOKE_MAX_SHARED_MEMORY_FALLBACK_COPIES ?? '0',
);
const visualCheck = process.env.SPICE_SMOKE_VISUAL_CHECK === '1';
const minVisualUniqueColors = Number(
  process.env.SPICE_SMOKE_MIN_VISUAL_UNIQUE_COLORS ?? '2',
);

type SmokeSample = {
  stage?: string;
  backend?: string;
  performance?: Record<string, unknown>;
  debug?: {
    lastPresentBackend?: {
      backend?: string;
      mode?: string;
      uploadCount?: number;
      uploadArea?: number;
    } | null;
  };
};

type BrowserSpiceDebug = {
  nextSnapshot: (timeoutMs?: number) => Promise<{
    session: { stage: string };
    backend: string;
    performance: Record<string, unknown>;
    debug?: SmokeSample['debug'];
  } | null>;
};

type CanvasVisualSummary = {
  width: number;
  height: number;
  sampledWidth?: number;
  sampledHeight?: number;
  uniqueColors: number;
  checksum: number;
} | null;

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function recentMinIngressDepth(samples: SmokeSample[]) {
  const recentSamples = samples.slice(-5);
  if (recentSamples.length === 0) {
    return Infinity;
  }
  return Math.min(
    ...recentSamples.map((sample) =>
      numberValue(sample.performance?.ingressQueueDepth),
    ),
  );
}

function assertSmoke(samples: SmokeSample[], consoleErrors: string[]) {
  if (samples.length === 0) {
    throw new Error('No SPICE diagnostics samples were captured.');
  }

  const last = samples[samples.length - 1]!;
  const perf = last.performance ?? {};
  const firstFrameMs = perf.firstFrameMs;
  if (typeof firstFrameMs !== 'number') {
    throw new Error(`No first frame by end of smoke. stage=${last.stage ?? 'unknown'}`);
  }

  const p95 = perf.p95PacketToPresentMs;
  if (typeof p95 === 'number' && p95 > maxP95Ms) {
    throw new Error(`p95 packet-to-present too high: ${p95}ms > ${maxP95Ms}ms`);
  }

  const minIngressDepth = recentMinIngressDepth(samples);
  if (minIngressDepth > maxIngressQueueDepth) {
    const ingressDepth = numberValue(perf.ingressQueueDepth);
    throw new Error(
      `Ingress queue did not drain recently: last=${ingressDepth}, recentMin=${minIngressDepth} > ${maxIngressQueueDepth}`,
    );
  }

  const ackCount =
    numberValue(perf.ingressAckCount) + numberValue(perf.ingressAckSyncCount);
  const avgAckMs = numberValue(perf.avgIngressAckMs);
  const lastAckMs = numberValue(perf.lastIngressAckMs);
  if (ackCount <= 0) {
    throw new Error('No display ACKs were observed during smoke.');
  }
  if (avgAckMs > maxIngressAckMs) {
    throw new Error(`Display ACK latency too high: ${avgAckMs}ms > ${maxIngressAckMs}ms`);
  }
  if (lastAckMs > maxLastIngressAckMs) {
    throw new Error(
      `Last display ACK latency too high: ${lastAckMs}ms > ${maxLastIngressAckMs}ms`,
    );
  }

  const firstPerf = samples[0]?.performance ?? {};
  const firstAckCount =
    numberValue(firstPerf.ingressAckCount) +
    numberValue(firstPerf.ingressAckSyncCount);
  const packetDelta =
    numberValue(perf.ingressPacketsConsumed) -
    numberValue(firstPerf.ingressPacketsConsumed);
  const ackDelta = ackCount - firstAckCount;
  if (packetDelta <= 0) {
    throw new Error('Display packet consumption did not advance during smoke.');
  }
  if (ackDelta <= 0) {
    throw new Error('Display ACK counters did not advance during smoke.');
  }

  const qxlBandSentinelTrips = numberValue(perf.qxlBandSentinelTrips);
  if (qxlBandSentinelTrips > maxQxlBandSentinelTrips) {
    throw new Error(
      `QXL frame-band sentinel tripped: ${qxlBandSentinelTrips} > ${maxQxlBandSentinelTrips}`,
    );
  }

  const wholeScreenBlocks = numberValue(perf.wholeScreenBlockCount);
  const oldWork = numberValue(perf.oldWorkContinuedAfterNewOwner);
  if (wholeScreenBlocks !== 0 || oldWork !== 0) {
    throw new Error(
      `Artifact guards tripped: wholeScreenBlockCount=${wholeScreenBlocks}, oldWorkContinuedAfterNewOwner=${oldWork}`,
    );
  }

  const cpuMirrorSyncs = numberValue(perf.cpuMirrorSyncCount);
  if (cpuMirrorSyncs > maxCpuMirrorSyncs) {
    throw new Error(
      `CPU mirror syncs observed during smoke: ${cpuMirrorSyncs} > ${maxCpuMirrorSyncs}`,
    );
  }
  const cpuCopyBitsFallbacks = numberValue(perf.cpuCopyBitsFallbackCount);
  if (cpuCopyBitsFallbacks > maxCpuCopyBitsFallbacks) {
    throw new Error(
      `CPU copy-bits fallbacks observed during smoke: ${cpuCopyBitsFallbacks} > ${maxCpuCopyBitsFallbacks}`,
    );
  }
  const cpuPixelMathArea = numberValue(perf.cpuPixelMathArea);
  if (cpuPixelMathArea > maxCpuPixelMathArea) {
    const reasons = JSON.stringify(perf.cpuPixelMathReasons ?? {});
    throw new Error(
      `CPU pixel math observed during smoke: ${cpuPixelMathArea} > ${maxCpuPixelMathArea}; reasons=${reasons}`,
    );
  }

  if (requireQxlCoverage) {
    const qxlStripSamples = numberValue(perf.qxlBandBitmapStripSamples);
    const batchedBitmapOps = numberValue(perf.batchedBitmapOps);
    const directPrimaryUploads = numberValue(perf.directPrimaryUploadCount);
    const gpuUploadReuse =
      numberValue(perf.gpuUploadArenaHits) + numberValue(perf.gpuUploadArenaMisses);
    const zeroCopyBodies = numberValue(perf.packetZeroCopyBodies);
    if (qxlStripSamples <= 0 && batchedBitmapOps <= 0 && directPrimaryUploads <= 0) {
      throw new Error(
        'Smoke did not exercise QXL bitmap/direct primary upload traffic.',
      );
    }
    if (batchedBitmapOps <= 0 && directPrimaryUploads <= 0) {
      throw new Error('Smoke did not exercise bitmap batching or direct primary upload.');
    }
    if (gpuUploadReuse <= 0) {
      throw new Error('Smoke did not exercise GPU upload arena paths.');
    }
    if (zeroCopyBodies <= 0) {
      throw new Error('Smoke did not exercise zero-copy ingress bodies.');
    }
  }

  if (expectSharedMemory) {
    if (perf.sharedMemoryRequested !== true) {
      throw new Error('Shared-memory smoke expected an enabled request flag.');
    }
    if (perf.sharedMemoryEligible !== true) {
      throw new Error(
        `Shared-memory smoke was not browser-eligible: ${perf.sharedMemoryDisabledReason ?? 'unknown'}`,
      );
    }
    if (perf.sharedMemoryEnabled !== true) {
      throw new Error(
        `Shared-memory smoke did not enable the fast path: ${perf.sharedMemoryDisabledReason ?? 'unknown'}`,
      );
    }
    const sharedMemoryBodies = numberValue(perf.sharedMemoryBodies);
    if (sharedMemoryBodies < minSharedMemoryBodies) {
      throw new Error(
        `Shared-memory bodies too low: ${sharedMemoryBodies} < ${minSharedMemoryBodies}`,
      );
    }
    const fallbackCopies = numberValue(perf.sharedMemoryFallbackCopies);
    if (fallbackCopies > maxSharedMemoryFallbackCopies) {
      throw new Error(
        `Shared-memory fallback copies observed: ${fallbackCopies} > ${maxSharedMemoryFallbackCopies}`,
      );
    }
  }

  const workerErrors = consoleErrors.filter(
    (line) =>
      /spice/i.test(line) &&
      !/404|route-map|disable_dev_indicator/i.test(line),
  );
  if (workerErrors.length > 0) {
    throw new Error(`Console reported SPICE errors:\n${workerErrors.join('\n')}`);
  }
}

function assertVisualSummary(summary: CanvasVisualSummary) {
  if (!visualCheck) {
    return;
  }
  if (!summary || summary.width <= 0 || summary.height <= 0) {
    throw new Error('Canvas visual check failed: no rendered canvas pixels.');
  }
  if (summary.uniqueColors < minVisualUniqueColors) {
    throw new Error(
      `Canvas visual check failed: uniqueColors=${summary.uniqueColors} < ${minVisualUniqueColors}, checksum=${summary.checksum}`,
    );
  }
}

async function captureCanvasVisualSummary(page: Page): Promise<CanvasVisualSummary> {
  if (!visualCheck) {
    return null;
  }

  const canvas = page.locator('canvas').first();
  const png = await canvas.screenshot({ timeout: diagnosticsTimeoutMs });
  return page.evaluate(async (base64) => {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(new Error('Unable to decode canvas screenshot.'));
    });
    image.src = `data:image/png;base64,${base64}`;
    await loaded;

    const width = Math.max(1, Math.min(160, image.naturalWidth));
    const height = Math.max(1, Math.min(100, image.naturalHeight));
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return { width: 0, height: 0, uniqueColors: 0, checksum: 0 };
    }
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const colors = new Set<number>();
    let checksum = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      const alpha = pixels[index + 3] ?? 0;
      const color =
        ((red >> 3) << 15) |
        ((green >> 3) << 10) |
        ((blue >> 3) << 5) |
        (alpha >> 3);
      colors.add(color);
      checksum ^= color;
      checksum = Math.imul(checksum, 16777619) >>> 0;
      if (colors.size >= 4096) {
        break;
      }
    }
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
      sampledWidth: width,
      sampledHeight: height,
      uniqueColors: colors.size,
      checksum,
    };
  }, png.toString('base64'));
}

async function main() {
  console.log(`Opening ${baseUrl}`);
  const launchArgs = ['--enable-webgl', '--ignore-gpu-blocklist'];
  if (headless) {
    launchArgs.push('--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  }
  const browser = await chromium.launch({
    headless,
    args: launchArgs,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(diagnosticsTimeoutMs);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
    console.log('Page loaded; waiting for SPICE debug bridge.');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as unknown as { __spiceDebug?: BrowserSpiceDebug })
            .__spiceDebug?.nextSnapshot,
        ),
      null,
      { timeout: diagnosticsTimeoutMs },
    );
    console.log(`Sampling diagnostics for ${seconds}s.`);

    const samples = await page.evaluate(async (durationSeconds) => {
      const output: SmokeSample[] = [];
      const deadline = performance.now() + durationSeconds * 1000;
      while (performance.now() < deadline) {
        const debug = (window as unknown as { __spiceDebug?: BrowserSpiceDebug })
          .__spiceDebug;
        const snapshot = await Promise.race([
          debug!.nextSnapshot(1000),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
        ]);
        if (snapshot) {
          output.push({
            stage: snapshot.session.stage,
            backend: snapshot.backend,
            performance: snapshot.performance,
            debug: {
              lastPresentBackend: snapshot.debug?.lastPresentBackend ?? null,
            },
          });
        }
      }
      return output;
    }, seconds);

    if (recentMinIngressDepth(samples) > maxIngressQueueDepth && drainGraceMs > 0) {
      const drainSamples = await page.evaluate(
        async ({ graceMs, maxDepth }) => {
          const output: SmokeSample[] = [];
          const deadline = performance.now() + graceMs;
          while (performance.now() < deadline) {
            const debug = (window as unknown as { __spiceDebug?: BrowserSpiceDebug })
              .__spiceDebug;
            const snapshot = await Promise.race([
              debug!.nextSnapshot(500),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 750)),
            ]);
            if (snapshot) {
              output.push({
                stage: snapshot.session.stage,
                backend: snapshot.backend,
                performance: snapshot.performance,
                debug: {
                  lastPresentBackend: snapshot.debug?.lastPresentBackend ?? null,
                },
              });
              const depth = snapshot.performance?.ingressQueueDepth;
              if (typeof depth === 'number' && depth <= maxDepth) {
                break;
              }
            }
          }
          return output;
        },
        { graceMs: drainGraceMs, maxDepth: maxIngressQueueDepth },
      );
      samples.push(...drainSamples);
    }

    assertSmoke(samples, consoleErrors);
    const visual = await captureCanvasVisualSummary(page);
    assertVisualSummary(visual);
    const last = samples[samples.length - 1]!;
    console.log(
      JSON.stringify(
        {
          ok: true,
          url: baseUrl,
          samples: samples.length,
          stage: last.stage,
          backend: last.backend,
          presentMode: last.debug?.lastPresentBackend?.mode ?? null,
          presentUploadCount:
            last.debug?.lastPresentBackend?.uploadCount ?? null,
          presentUploadArea:
            last.debug?.lastPresentBackend?.uploadArea ?? null,
          p95PacketToPresentMs: last.performance?.p95PacketToPresentMs ?? null,
          ingressQueueDepth: last.performance?.ingressQueueDepth ?? null,
          qxlBandMode: last.performance?.qxlBandMode ?? null,
          qxlBandSentinelTrips:
            last.performance?.qxlBandSentinelTrips ?? null,
          ingressAckCount: last.performance?.ingressAckCount ?? null,
          avgIngressAckMs: last.performance?.avgIngressAckMs ?? null,
          ingressAckSyncCount: last.performance?.ingressAckSyncCount ?? null,
          lastIngressAckMs: last.performance?.lastIngressAckMs ?? null,
          ingressPacketsConsumed:
            last.performance?.ingressPacketsConsumed ?? null,
          oldWorkContinuedAfterNewOwner:
            last.performance?.oldWorkContinuedAfterNewOwner ?? null,
          wholeScreenBlockCount:
            last.performance?.wholeScreenBlockCount ?? null,
          cpuMirrorSyncCount: last.performance?.cpuMirrorSyncCount ?? null,
          cpuCopyBitsFallbackCount:
            last.performance?.cpuCopyBitsFallbackCount ?? null,
          cpuPixelMathArea: last.performance?.cpuPixelMathArea ?? null,
          qxlBandBitmapStripSamples:
            last.performance?.qxlBandBitmapStripSamples ?? null,
          batchedBitmapOps: last.performance?.batchedBitmapOps ?? null,
          directPrimaryUploadCount:
            last.performance?.directPrimaryUploadCount ?? null,
          gpuUploadArenaHits: last.performance?.gpuUploadArenaHits ?? null,
          gpuUploadArenaMisses: last.performance?.gpuUploadArenaMisses ?? null,
          packetZeroCopyBodies: last.performance?.packetZeroCopyBodies ?? null,
          packetCopiedBodyBytes:
            last.performance?.packetCopiedBodyBytes ?? null,
          packetAsyncConcatCount:
            last.performance?.packetAsyncConcatCount ?? null,
          sharedMemoryRequested:
            last.performance?.sharedMemoryRequested ?? null,
          sharedMemoryEligible:
            last.performance?.sharedMemoryEligible ?? null,
          sharedMemoryEnabled:
            last.performance?.sharedMemoryEnabled ?? null,
          sharedMemoryDisabledReason:
            last.performance?.sharedMemoryDisabledReason ?? null,
          sharedMemoryBodies: last.performance?.sharedMemoryBodies ?? null,
          sharedMemoryBodyBytes:
            last.performance?.sharedMemoryBodyBytes ?? null,
          sharedMemoryFallbackCopies:
            last.performance?.sharedMemoryFallbackCopies ?? null,
          visual,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
