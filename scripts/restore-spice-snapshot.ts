/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SNAPSHOT = 'spice-client-youtube-stable-2026-04-30';

type RestoreOptions = {
  list: boolean;
  dryRun: boolean;
  force: boolean;
  includeBuildArtifacts: boolean;
  snapshotName: string;
};

function parseArgs(argv: string[]): RestoreOptions {
  const options: RestoreOptions = {
    list: false,
    dryRun: true,
    force: false,
    includeBuildArtifacts: false,
    snapshotName: DEFAULT_SNAPSHOT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--list') {
      options.list = true;
    } else if (arg === '--restore') {
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--include-build-artifacts') {
      options.includeBuildArtifacts = true;
    } else if (arg === '--from') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--from requires a snapshot folder name.');
      }
      options.snapshotName = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function toPosix(value: string) {
  return value.split(path.sep).join('/');
}

function isBuildArtifactPath(file: string) {
  return file.startsWith('spice-native/target/');
}

async function collectFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(root, entryPath);
      }
      if (!entry.isFile()) {
        return [];
      }
      return [toPosix(path.relative(root, entryPath))];
    }),
  );
  return nested.flat().sort();
}

async function gitDirtyPaths(cwd: string) {
  const proc = Bun.spawn(['git', 'status', '--porcelain'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git status failed: ${stderr.trim()}`);
  }

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const rawPath = line.slice(3).replace(/^"|"$/g, '');
      const renameSeparator = rawPath.indexOf(' -> ');
      return renameSeparator >= 0
        ? [rawPath.slice(0, renameSeparator), rawPath.slice(renameSeparator + 4)]
        : [rawPath];
    })
    .map((entry) => entry.replace(/\\/g, '/'));
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  const repoRoot = process.cwd();
  const snapshotRoot = path.join(repoRoot, 'snapshots', options.snapshotName);
  const snapshotStat = await stat(snapshotRoot).catch(() => null);
  if (!snapshotStat?.isDirectory()) {
    throw new Error(`Snapshot not found: ${snapshotRoot}`);
  }

  const files = await collectFiles(snapshotRoot);
  if (options.list) {
    for (const file of files) {
      console.log(file);
    }
    return;
  }

  const restoreFiles = files.filter(
    (file) =>
      file !== 'SNAPSHOT.md' &&
      (options.includeBuildArtifacts || !isBuildArtifactPath(file)),
  );
  const dirty = new Set(await gitDirtyPaths(repoRoot));
  const dirtyTargets = restoreFiles.filter((file) => dirty.has(file));
  if (dirtyTargets.length > 0 && !options.force && !options.dryRun) {
    console.error('Refusing to overwrite dirty target files without --force:');
    for (const file of dirtyTargets.slice(0, 50)) {
      console.error(`  ${file}`);
    }
    if (dirtyTargets.length > 50) {
      console.error(`  ... ${dirtyTargets.length - 50} more`);
    }
    process.exit(1);
  }

  const label = options.dryRun ? 'Would restore' : 'Restoring';
  console.log(`${label} ${restoreFiles.length} file(s) from ${options.snapshotName}`);
  if (options.dryRun && dirtyTargets.length > 0) {
    console.log(
      `Dry-run note: ${dirtyTargets.length} dirty target file(s) would require --force for restore.`,
    );
  }
  for (const relative of restoreFiles) {
    const source = path.join(snapshotRoot, ...relative.split('/'));
    const target = path.join(repoRoot, ...relative.split('/'));
    if (options.dryRun) {
      console.log(relative);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
