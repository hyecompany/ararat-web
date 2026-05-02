/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

import type { Instance } from '../../../instances/_lib/instances.d';

const QXL_GRAPHICS_PATTERN =
  /\bqxl-vga\b|\bqxl\b.*\bvga\b|\b-device\s+qxl\b|driver\s*=\s*"?qxl-vga"?/i;
const SPICE_STREAMING_VIDEO_PATTERN =
  /streaming-video\s*=\s*(off|all|filter)\b/i;

export type SpiceStreamingVideoMode = 'off' | 'all' | 'filter';

export interface SpiceStreamingTuningStatus {
  hasQxlGraphics: boolean;
  configuredMode: SpiceStreamingVideoMode | null;
  configuredSource: string | null;
  directInstanceConfig: boolean;
}

function instanceGraphicsConfigEntries(instance: Instance | null | undefined) {
  const directConfig = instance?.config ?? {};
  const expandedConfig = instance?.expanded_config ?? {};
  const keys = [
    'raw.qemu',
    'raw.qemu.conf',
    'raw.qemu.conf.d',
    'raw.qemu.scriptlet',
  ];
  return keys.flatMap((key) => {
    const directValue = directConfig[key];
    const expandedValue = expandedConfig[key];
    return [
      ...(directValue ? [{ key, value: directValue, direct: true }] : []),
      ...(expandedValue && expandedValue !== directValue
        ? [{ key, value: expandedValue, direct: false }]
        : []),
    ];
  });
}

export function instanceHasQxlGraphics(instance: Instance | null | undefined) {
  const rawQemuText = instanceGraphicsConfigEntries(instance)
    .map((entry) => entry.value)
    .join('\n');

  return QXL_GRAPHICS_PATTERN.test(rawQemuText);
}

export function getSpiceStreamingTuningStatus(
  instance: Instance | null | undefined,
): SpiceStreamingTuningStatus {
  const entries = instanceGraphicsConfigEntries(instance);
  const qxlText = entries.map((entry) => entry.value).join('\n');
  const hasQxlGraphics = QXL_GRAPHICS_PATTERN.test(qxlText);
  for (const entry of entries) {
    const match = SPICE_STREAMING_VIDEO_PATTERN.exec(entry.value);
    if (!match) {
      continue;
    }
    return {
      hasQxlGraphics,
      configuredMode: match[1].toLowerCase() as SpiceStreamingVideoMode,
      configuredSource: entry.key,
      directInstanceConfig: entry.direct,
    };
  }

  return {
    hasQxlGraphics,
    configuredMode: null,
    configuredSource: null,
    directInstanceConfig: false,
  };
}
