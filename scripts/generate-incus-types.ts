#!/usr/bin/env bun

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const outputPath = 'app/_incus/generated/api-types.ts';
const specUrl = 'http://localhost:3001/documentation/rest-api.yaml';

async function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function main() {
  const response = await fetch(specUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${specUrl}: ${response.status}`);
  }

  const workDir = join(tmpdir(), 'ararat-incus-types');
  await mkdir(workDir, { recursive: true });

  const swaggerPath = join(workDir, 'rest-api.yaml');
  const openApiPath = join(workDir, 'rest-api.openapi.json');
  await writeFile(swaggerPath, await response.text());

  // Incus currently serves this document as Swagger 2.0. `openapi-typescript`
  // only accepts OpenAPI 3.x, so generation has an explicit conversion step
  // instead of relying on a hidden/manual preprocessing command.
  await run('bunx', [
    'swagger2openapi',
    '--patch',
    '--warnOnly',
    '--outfile',
    openApiPath,
    swaggerPath,
  ]);

  // Keep generation scripted instead of hand-maintaining broad Incus types.
  // `types.ts` remains the place for small app-facing refinements when the
  // generated schema is simplified or loose.
  await run('bunx', ['openapi-typescript', openApiPath, '-o', outputPath]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
