/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.join(
  process.cwd(),
  'app/(main)/instance/console/_lib/spice-client/runtime',
);
const targetDir = path.join(process.cwd(), 'public/spice-client');
const checkOnly = process.argv.includes('--check');

async function collectRuntimeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectRuntimeFiles(entryPath);
      }

      if (
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        return [entryPath];
      }

      return [];
    }),
  );

  return files.flat();
}

async function cleanGeneratedRuntime(directory: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name === 'pkg') {
          return;
        }

        await rm(path.join(directory, entry.name), {
          force: true,
          recursive: true,
        });
      }),
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

async function collectGeneratedFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(async (entry) => {
        if (entry.name === 'pkg') {
          return [];
        }

        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          return collectGeneratedFiles(entryPath);
        }

        if (entry.name.endsWith('.js')) {
          return [entryPath];
        }

        return [];
      }),
    );

    return files.flat();
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
}

function outputPathForRuntimeFile(file: string) {
  const relativePath = path.relative(sourceDir, file).replace(/\.ts$/, '.js');
  return {
    relativePath,
    destination: path.join(targetDir, relativePath),
  };
}

async function assertGeneratedRuntimeIsFresh(
  runtimeFiles: string[],
  transpiler: Bun.Transpiler,
) {
  const staleFiles: string[] = [];
  const expected = new Set<string>();

  for (const file of runtimeFiles) {
    const { relativePath, destination } = outputPathForRuntimeFile(file);
    expected.add(relativePath);
    const source = await Bun.file(file).text();
    const output = transpiler.transformSync(source);
    let current = '';
    try {
      current = await readFile(destination, 'utf8');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        staleFiles.push(`${relativePath} (missing)`);
        continue;
      }
      throw error;
    }

    if (current !== output) {
      staleFiles.push(relativePath);
    }
  }

  for (const file of await collectGeneratedFiles(targetDir)) {
    const relativePath = path.relative(targetDir, file);
    if (!expected.has(relativePath)) {
      staleFiles.push(`${relativePath} (extra)`);
    }
  }

  if (staleFiles.length > 0) {
    throw new Error(
      `SPICE runtime public bundle is stale:\n${staleFiles
        .map((file) => ` - ${file}`)
        .join('\n')}\nRun bun run spice:runtime:build.`,
    );
  }

  console.log(`SPICE runtime public bundle is fresh (${runtimeFiles.length} module(s)).`);
}

async function main() {
  const runtimeFiles = await collectRuntimeFiles(sourceDir);
  const transpiler = new Bun.Transpiler({
    loader: 'ts',
    target: 'browser',
  });

  if (checkOnly) {
    await assertGeneratedRuntimeIsFresh(runtimeFiles, transpiler);
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await cleanGeneratedRuntime(targetDir);

  for (const file of runtimeFiles) {
    const { destination } = outputPathForRuntimeFile(file);
    await mkdir(path.dirname(destination), { recursive: true });
    const source = await Bun.file(file).text();
    const output = transpiler.transformSync(source);
    await writeFile(destination, output);
  }

  console.log(`Built ${runtimeFiles.length} SPICE runtime module(s) into ${targetDir}`);
}

await main();
