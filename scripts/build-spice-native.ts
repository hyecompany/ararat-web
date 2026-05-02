/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const nativeDir = path.join(rootDir, 'spice-native');
const pkgDir = path.join(rootDir, 'public/spice-client/pkg');
const runtimePkgDir = path.join(
  rootDir,
  'app/(main)/instance/console/_lib/spice-client/runtime/pkg',
);
const manifestPath = path.join(pkgDir, 'spice_native.manifest.json');
const nativeWasmFeatures = ['webgpu-wgpu', 'parallel-decode'];
const nativeRustFlags = '-C target-feature=+simd128';
const requiredAssets = [
  path.join(pkgDir, 'spice_native.js'),
  path.join(pkgDir, 'spice_native_bg.wasm'),
];
const allowStaleArtifacts = process.env.SPICE_ALLOW_STALE_WASM === '1';

async function hasExistingArtifacts() {
  try {
    await Promise.all(requiredAssets.map((file) => access(file)));
    return true;
  } catch {
    return false;
  }
}

async function hashFile(file: string) {
  const bytes = await readFile(file);
  return createHash('sha256').update(bytes).digest('hex');
}

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target') {
          return [];
        }
        return listSourceFiles(fullPath);
      }
      if (
        entry.name === 'Cargo.toml' ||
        entry.name === 'Cargo.lock' ||
        entry.name.endsWith('.rs')
      ) {
        return [fullPath];
      }
      return [];
    }),
  );
  return files.flat().sort();
}

async function sourceHash() {
  const hash = createHash('sha256');
  const files = await listSourceFiles(nativeDir);
  for (const file of files) {
    const relative = path.relative(nativeDir, file).replaceAll(path.sep, '/');
    hash.update(relative);
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function artifactManifestIsCurrent(expectedSourceHash: string) {
  if (!(await hasExistingArtifacts())) {
    return false;
  }
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      sourceHash?: string;
      assets?: Record<string, string>;
    };
    if (manifest.sourceHash !== expectedSourceHash || !manifest.assets) {
      return false;
    }
    for (const asset of requiredAssets) {
      const name = path.basename(asset);
      if (manifest.assets[name] !== (await hashFile(asset))) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function writeArtifactManifest(currentSourceHash: string, wasmPackVersion: string) {
  const assets: Record<string, string> = {};
  for (const asset of requiredAssets) {
    assets[path.basename(asset)] = await hashFile(asset);
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        version: 1,
        sourceHash: currentSourceHash,
        features: nativeWasmFeatures,
        rustflags: nativeRustFlags,
        wasmPackVersion,
        assets,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

async function mirrorRuntimeTypes() {
  await mkdir(runtimePkgDir, { recursive: true });
  await writeFile(
    path.join(runtimePkgDir, 'spice_native.d.ts'),
    await readFile(path.join(pkgDir, 'spice_native.d.ts')),
  );
}

async function reuseStaleArtifactsOrThrow(reason: string, currentSourceHash: string) {
  if (
    allowStaleArtifacts &&
    (await artifactManifestIsCurrent(currentSourceHash))
  ) {
    console.warn(
      `${reason}; SPICE_ALLOW_STALE_WASM=1 and public/spice-client/pkg matches the current spice-native source hash, so existing artifacts will be reused.`,
    );
    return;
  }

  throw new Error(
    `${reason}. Install wasm-pack or rebuild successfully; stale WASM artifacts are accepted only when public/spice-client/pkg/spice_native.manifest.json matches the current spice-native source hash.`,
  );
}

async function main() {
  const currentSourceHash = await sourceHash();
  let probe: ReturnType<typeof Bun.spawnSync> | null = null;
  try {
    probe = Bun.spawnSync({
      cmd: ['wasm-pack', '--version'],
      cwd: nativeDir,
      stdout: 'pipe',
      stderr: 'ignore',
    });
  } catch {
    probe = null;
  }

  if (probe?.success) {
    const wasmPackVersion = new TextDecoder().decode(probe.stdout).trim();
    const build = Bun.spawn({
      cmd: [
        'wasm-pack',
        'build',
        '--target',
        'web',
        '--out-dir',
        '../public/spice-client/pkg',
        '--',
        '--locked',
        '--features',
        nativeWasmFeatures.join(','),
      ],
      cwd: nativeDir,
      env: {
        ...Bun.env,
        RUSTFLAGS: [Bun.env.RUSTFLAGS, nativeRustFlags].filter(Boolean).join(' '),
      },
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const exitCode = await build.exited;
    if (exitCode !== 0) {
      await reuseStaleArtifactsOrThrow(
        `wasm-pack build failed with exit code ${exitCode}`,
        currentSourceHash,
      );
      return;
    }
    await mirrorRuntimeTypes();
    await writeArtifactManifest(currentSourceHash, wasmPackVersion);
    return;
  }

  await reuseStaleArtifactsOrThrow(
    'wasm-pack is not installed',
    currentSourceHash,
  );
}

await main();
