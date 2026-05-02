/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { spawnSync } from 'node:child_process';

const instance =
  process.env.SPICE_SHARED_MEMORY_SMOKE_INSTANCE ??
  process.env.SPICE_QXL_MOTION_INSTANCE ??
  'ubuntu-qxl-desktop';
const scenario =
  process.env.SPICE_SHARED_MEMORY_SMOKE_SCENARIO ?? 'large-area-video';
const seconds = process.env.SPICE_SMOKE_SECONDS ?? '12';
const maxRegressionRatio = Number(
  process.env.SPICE_SHARED_MEMORY_MAX_REGRESSION_RATIO ?? '1.5',
);
const maxRegressionSlackMs = Number(
  process.env.SPICE_SHARED_MEMORY_MAX_REGRESSION_SLACK_MS ?? '5',
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with ${result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
  return result;
}

function runScene() {
  if (process.env.SPICE_SHARED_MEMORY_SMOKE_SKIP_SCENE === '1') {
    return;
  }
  console.log(`Starting SPICE generated scene "${scenario}" on ${instance}.`);
  run('incus', [
    'exec',
    instance,
    '--',
    '/opt/ararat-spice-e2e/run-scene.sh',
    scenario,
  ], {
    stdio: 'inherit',
  });
}

function consoleUrl(enabled) {
  const value =
    process.env.SPICE_SHARED_MEMORY_SMOKE_URL ??
    `http://localhost:3001/ui/instance/console/window?name=${encodeURIComponent(instance)}&takeover=1`;
  const url = new URL(value);
  url.searchParams.set('spice_sharedMemoryBuffers', enabled ? '1' : '0');
  return url.toString();
}

function parseSmokeJson(stdout) {
  const marker = '{\n  "ok": true';
  const start = stdout.lastIndexOf(marker);
  if (start < 0) {
    throw new Error(`Unable to find smoke JSON in output:\n${stdout}`);
  }
  return JSON.parse(stdout.slice(start));
}

function runSmoke(enabled) {
  runScene();
  const url = consoleUrl(enabled);
  console.log(
    `Running ${enabled ? 'shared-memory' : 'baseline'} smoke for ${seconds}s: ${url}`,
  );
  const result = run(process.execPath, ['./scripts/spice-live-smoke.mjs'], {
    env: {
      ...process.env,
      SPICE_SMOKE_URL: url,
      SPICE_SMOKE_INSTANCE: instance,
      SPICE_SMOKE_SECONDS: seconds,
      SPICE_SMOKE_EXPECT_SHARED_MEMORY: enabled ? '1' : '0',
      SPICE_SMOKE_REQUIRE_QXL_COVERAGE:
        process.env.SPICE_SMOKE_REQUIRE_QXL_COVERAGE ?? '1',
      SPICE_SMOKE_VISUAL_CHECK: process.env.SPICE_SMOKE_VISUAL_CHECK ?? '1',
      SPICE_SMOKE_MAX_CPU_MIRROR_SYNCS:
        process.env.SPICE_SMOKE_MAX_CPU_MIRROR_SYNCS ?? '0',
      SPICE_SMOKE_MAX_CPU_PIXEL_MATH_AREA:
        process.env.SPICE_SMOKE_MAX_CPU_PIXEL_MATH_AREA ?? '0',
    },
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return parseSmokeJson(result.stdout ?? '');
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const baseline = runSmoke(false);
const shared = runSmoke(true);
const baselineP95 = numberValue(baseline.p95PacketToPresentMs);
const sharedP95 = numberValue(shared.p95PacketToPresentMs);

if (baselineP95 > 0 && sharedP95 > 0) {
  const allowed = baselineP95 * maxRegressionRatio + maxRegressionSlackMs;
  if (sharedP95 > allowed) {
    throw new Error(
      `Shared-memory p95 regression too high: ${sharedP95}ms > ${allowed.toFixed(
        2,
      )}ms baseline=${baselineP95}ms`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      instance,
      scenario,
      baseline: {
        p95PacketToPresentMs: baselineP95,
        packetCopiedBodyBytes: baseline.packetCopiedBodyBytes,
        sharedMemoryEnabled: baseline.sharedMemoryEnabled,
      },
      sharedMemory: {
        p95PacketToPresentMs: sharedP95,
        packetCopiedBodyBytes: shared.packetCopiedBodyBytes,
        sharedMemoryBodies: shared.sharedMemoryBodies,
        sharedMemoryBodyBytes: shared.sharedMemoryBodyBytes,
        sharedMemoryFallbackCopies: shared.sharedMemoryFallbackCopies,
      },
    },
    null,
    2,
  ),
);
