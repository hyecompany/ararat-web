/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

const spiceClientDir = path.join(
  process.cwd(),
  'app/(main)/instance/console/_lib/spice-client',
);

async function collectTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTestFiles(entryPath);
      }
      return entry.name.endsWith('.test.ts') ? [entryPath] : [];
    }),
  );

  return files.flat();
}

const testFiles = await collectTestFiles(spiceClientDir);
const child = Bun.spawn(['bun', 'test', ...testFiles], {
  stdio: ['inherit', 'inherit', 'inherit'],
});

process.exit(await child.exited);
