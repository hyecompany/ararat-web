/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  evaluateQxlHostGuestProof,
  evaluateQxlRendererProof,
  mergeQxlProofResults,
  type QxlHostGuestProofInput,
  type QxlRuntimeProofInput,
} from '../app/(main)/instance/console/_lib/spice-client/runtime/qxl-proof.js';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonIfPresent(filePath: string): Promise<JsonObject | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isObject(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function stringField(input: JsonObject, key: string) {
  const value = input[key];
  return typeof value === 'string' ? value : null;
}

function booleanField(input: JsonObject, key: string) {
  const value = input[key];
  return typeof value === 'boolean' ? value : null;
}

function hostGuestProofInput(input: JsonObject | null): QxlHostGuestProofInput {
  const source = input ?? {};
  return {
    incusConfigExpanded: stringField(source, 'incusConfigExpanded'),
    lspciQxl: stringField(source, 'lspciQxl'),
    lsmodQxl: stringField(source, 'lsmodQxl'),
    xorgLog: stringField(source, 'xorgLog'),
    qxlDevicePresent: booleanField(source, 'qxlDevicePresent'),
    qxlKernelModuleLoaded: booleanField(source, 'qxlKernelModuleLoaded'),
    qxlDdxLoaded: booleanField(source, 'qxlDdxLoaded'),
    qxlSurfacesEnabled: booleanField(source, 'qxlSurfacesEnabled'),
    qxlImageCacheEnabled: booleanField(source, 'qxlImageCacheEnabled'),
    qxlFallbackCacheEnabled: booleanField(source, 'qxlFallbackCacheEnabled'),
    qxlDeferredFramesDisabled: booleanField(source, 'qxlDeferredFramesDisabled'),
  };
}

function runtimeProofInput(input: JsonObject | null): QxlRuntimeProofInput {
  return isObject(input) ? (input as QxlRuntimeProofInput) : {};
}

function usage() {
  console.error(
    'Usage: bun run ./scripts/assert-spice-qxl-proof.ts <artifact-dir> [--require-surface-image] [--require-gpu-surface-math]',
  );
}

const artifactDir = Bun.argv[2];
if (!artifactDir || artifactDir.startsWith('--')) {
  usage();
  process.exit(2);
}

const flags = new Set(Bun.argv.slice(3));
const displayStack =
  (await readJsonIfPresent(path.join(artifactDir, 'display-stack.json'))) ??
  (await readJsonIfPresent(path.join(artifactDir, 'setup.json'))) ??
  (await readJsonIfPresent(path.join(artifactDir, 'events.json')));
const diagnostics = await readJsonIfPresent(path.join(artifactDir, 'diagnostics.json'));

const host = evaluateQxlHostGuestProof(hostGuestProofInput(displayStack));
const renderer = evaluateQxlRendererProof(runtimeProofInput(diagnostics), {
  requireSurfaceImage: flags.has('--require-surface-image'),
  requireGpuSurfaceMath: flags.has('--require-gpu-surface-math'),
});
const proof = mergeQxlProofResults(host, renderer);

console.log(
  JSON.stringify(
    {
      artifactDir,
      ok: proof.ok,
      missing: proof.missing,
      checks: proof.checks,
    },
    null,
    2,
  ),
);

process.exit(proof.ok ? 0 : 1);
