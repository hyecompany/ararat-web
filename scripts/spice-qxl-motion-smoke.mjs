/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { spawnSync } from 'node:child_process';

const instance = process.env.SPICE_QXL_MOTION_INSTANCE ?? 'ararat-spice-e2e-qxl-debug';
const scenarios = (
  process.env.SPICE_QXL_MOTION_SCENARIOS ??
  process.env.SPICE_QXL_MOTION_SCENARIO ??
  'large-area-video'
)
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const seconds = process.env.SPICE_SMOKE_SECONDS ?? '30';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
}

for (const scenario of scenarios) {
  console.log(`Starting SPICE generated QXL scene "${scenario}" on ${instance}.`);
  run('incus', [
    'exec',
    instance,
    '--',
    '/opt/ararat-spice-e2e/run-scene.sh',
    scenario,
  ]);

  console.log(`Running browser smoke against ${instance} for ${seconds}s.`);
  run(process.execPath, ['./scripts/spice-live-smoke.mjs'], {
    env: {
      ...process.env,
      SPICE_SMOKE_INSTANCE: instance,
      SPICE_SMOKE_SECONDS: seconds,
      SPICE_SMOKE_REQUIRE_QXL_COVERAGE:
        process.env.SPICE_SMOKE_REQUIRE_QXL_COVERAGE ?? '1',
      SPICE_SMOKE_VISUAL_CHECK: process.env.SPICE_SMOKE_VISUAL_CHECK ?? '1',
      SPICE_SMOKE_MAX_CPU_MIRROR_SYNCS:
        process.env.SPICE_SMOKE_MAX_CPU_MIRROR_SYNCS ?? '0',
      SPICE_SMOKE_MAX_CPU_PIXEL_MATH_AREA:
        process.env.SPICE_SMOKE_MAX_CPU_PIXEL_MATH_AREA ?? '0',
    },
  });
}
