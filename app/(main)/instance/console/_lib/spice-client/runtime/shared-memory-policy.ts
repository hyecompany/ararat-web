/*
 * Copyright (C) 2026 Hye Hosting LLC & Hye Ararat contributors.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */

export const SHARED_MEMORY_FAST_PATH_QUERY = 'spice_sharedMemoryBuffers';
export const SHARED_MEMORY_FAST_PATH_ALIAS_QUERY = 'sharedMemoryBuffers';
export const SHARED_MEMORY_FAST_PATH_COOKIE = 'ararat_spice_shared_memory';
export const SHARED_MEMORY_FAST_PATH_STORAGE_KEY =
  'ararat:spice-shared-memory';
export const INCUS_SPICE_WEB_TRANSPORT_HEADER = 'X-Incus-SPICE-Web-Transport';
export const INCUS_SPICE_WEB_TRANSPORT_SHARED_MEMORY =
  'shared-memory-buffers-v1';

export interface SharedMemoryRuntimeCapability {
  eligible: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  atomics: boolean;
  disabledReason: string | null;
}

export function parseBooleanFlag(value: string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
    return false;
  }
  return null;
}

export function sharedMemoryFastPathFromSearchParams(params: URLSearchParams) {
  return parseBooleanFlag(
    params.get(SHARED_MEMORY_FAST_PATH_QUERY) ??
      params.get(SHARED_MEMORY_FAST_PATH_ALIAS_QUERY),
  );
}

export function sharedMemoryFastPathCookieValue(enabled: boolean) {
  const maxAge = 60 * 60 * 24 * 365;
  return `${SHARED_MEMORY_FAST_PATH_COOKIE}=${enabled ? '1' : '0'}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function detectSharedMemoryRuntimeCapability(
  scope: Pick<
    typeof globalThis,
    'Atomics' | 'SharedArrayBuffer' | 'crossOriginIsolated'
  > =
    globalThis,
): SharedMemoryRuntimeCapability {
  const crossOriginIsolated = scope.crossOriginIsolated === true;
  const sharedArrayBuffer = typeof scope.SharedArrayBuffer === 'function';
  const atomics = typeof scope.Atomics === 'object' && scope.Atomics !== null;
  const eligible = crossOriginIsolated && sharedArrayBuffer && atomics;

  return {
    eligible,
    crossOriginIsolated,
    sharedArrayBuffer,
    atomics,
    disabledReason: eligible
      ? null
      : !crossOriginIsolated
        ? 'cross-origin isolation headers are not active'
        : !sharedArrayBuffer
          ? 'SharedArrayBuffer is unavailable'
          : 'Atomics are unavailable',
  };
}
