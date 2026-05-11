'use client';

import { mapWithConcurrency } from '../../concurrency';
import { debugIncusData } from '../../debug';
import { chunkFilterNames, nameEqualsFilter } from '../../filters';
import { splitStorageVolumeKey, storageVolumeKey } from '../../keys';
import { resourceKeys } from '../../resources';
import { applyProjectSelection, collectionStatusKey } from '../../scope';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { shouldFetchStoredStatus } from '../../status';
import { requestJson } from '../../transport';
import type {
  ResourcesStoragePool,
  StoragePool,
  StorageVolume,
} from '../../types';

export type VisibleRange = {
  start: number;
  count: number;
  overscan?: number;
};

export type StoragePoolInclude = {
  metadata?: boolean;
  resources?: boolean;
};

export type UseStoragePoolsRequest = {
  visibleRange?: VisibleRange;
  include?: StoragePoolInclude;
};

function poolNameFromPath(path: string) {
  return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? path);
}

function visibleNames(names: string[], range?: VisibleRange) {
  if (!range) return names;
  const overscan = range.overscan ?? 0;
  const start = Math.max(0, range.start - overscan);
  const end = Math.min(names.length, range.start + range.count + overscan);
  return names.slice(start, end);
}

// This module is the storage-pools resource planner. The top-level Incus client
// owns shared concerns like persistence, the event socket, and request dedupe;
// this file owns storage-pool-specific endpoint choices and parallel fetches.
export async function ensureStoragePools(
  store: IncusStore,
  requests: RequestRegistry,
  request: UseStoragePoolsRequest = {},
) {
  debugIncusData('storagePools.ensure:start', {
    request,
    events: store.getSnapshot().state.events.status,
    collection: store.getSnapshot().state.storagePools.collection.status,
  });

  await ensureStoragePoolNames(store, requests);

  const snapshot = store.getSnapshot().state.storagePools;
  const names = visibleNames(
    Object.keys(snapshot.items).sort((a, b) => a.localeCompare(b)),
    request.visibleRange,
  );
  const include = request.include ?? { metadata: true };

  const tasks: Promise<unknown>[] = [];
  if (include.metadata !== false) {
    tasks.push(ensureStoragePoolMetadata(store, requests, names));
  }
  if (include.resources) {
    tasks.push(ensureStoragePoolResources(store, requests, names));
  }

  debugIncusData('storagePools.ensure:planned', {
    visibleNames: names,
    include,
    branches: {
      metadata: include.metadata !== false,
      resources: Boolean(include.resources),
    },
  });

  await Promise.all(tasks);

  debugIncusData('storagePools.ensure:done', {
    collection: store.getSnapshot().state.storagePools.collection.status,
    visible: names.map((name) => {
      const item = store.getSnapshot().state.storagePools.items[name];
      return {
        name,
        metadata: item?.metadata.status,
        resources: item?.resources.status,
      };
    }),
  });
}

export async function ensureStoragePoolVolumes(
  store: IncusStore,
  requests: RequestRegistry,
  poolName: string,
  project: string = 'default',
) {
  const collectionKey = collectionStatusKey(project);
  const pool = store.ensureStoragePool(poolName);
  const collection =
    pool.volumes.collection.byProject[collectionKey] ??
    pool.volumes.collection.all;
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(
    `storage-pools:${poolName}:volumes:${collectionKey}:custom`,
    [resourceKeys.storagePoolVolumesCollection(poolName, collectionKey)],
    async () => {
      try {
        const params = new URLSearchParams({ recursion: '1' });
        applyProjectSelection(params, project);
        const response = await requestJson<StorageVolume[]>(
          `/1.0/storage-pools/${encodeURIComponent(poolName)}/volumes/custom`,
          { params: Object.fromEntries(params.entries()) },
        );

        store.update((state) => {
          const nextPool = state.storagePools.items[poolName] ??
            store.ensureStoragePool(poolName);
          nextPool.volumes.collection.byProject[collectionKey] = { status: 'ready' };
          const returnedKeys = new Set(
            response.metadata.map((volume) =>
              storageVolumeKey(
                volume.project ?? collectionKey,
                volume.type ?? 'custom',
                volume.name,
              ),
            ),
          );
          for (const key of Object.keys(nextPool.volumes.items)) {
            const identity = splitStorageVolumeKey(key);
            const matchesCollection =
              collectionKey === 'all' || identity.project === collectionKey;
            if (
              matchesCollection &&
              identity.type === 'custom' &&
              !returnedKeys.has(key)
            ) {
              delete nextPool.volumes.items[key];
            }
          }
          for (const volume of response.metadata) {
            const key = storageVolumeKey(
              volume.project ?? collectionKey,
              volume.type ?? 'custom',
              volume.name,
            );
            const item = nextPool.volumes.items[key] ??
              store.ensureStorageVolume(poolName, key);
            item.metadata = { status: 'ready', data: volume };
          }
        }, [
          resourceKeys.storagePoolVolumesCollection(poolName, collectionKey),
          ...response.metadata.map((volume) =>
            resourceKeys.storageVolumeMetadata(
              poolName,
              storageVolumeKey(
                volume.project ?? collectionKey,
                volume.type ?? 'custom',
                volume.name,
              ),
            ),
          ),
        ]);
      } catch (error) {
        store.update((state) => {
          const nextPool = state.storagePools.items[poolName] ??
            store.ensureStoragePool(poolName);
          nextPool.volumes.collection.byProject[collectionKey] = {
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load storage volumes.',
          };
        }, [resourceKeys.storagePoolVolumesCollection(poolName, collectionKey)]);
      }
    },
  );
}

async function ensureStoragePoolNames(
  store: IncusStore,
  requests: RequestRegistry,
) {
  const status = store.getSnapshot().state.storagePools.collection.status;
  if (!shouldFetchStoredStatus(status)) {
    debugIncusData('storagePools.names:skip', { status });
    return;
  }

  debugIncusData('storagePools.names:fetch', {
    from: status,
  });

  await requests.run('storage-pools:names', [resourceKeys.storagePoolsCollection], async () => {
    try {
      const response = await requestJson<string[]>('/1.0/storage-pools');
      store.update((state) => {
        state.storagePools.collection = { status: 'ready' };
        for (const path of response.metadata) {
          const name = poolNameFromPath(path);
          if (!state.storagePools.items[name]) {
            state.storagePools.items[name] = {
              metadata: { status: 'missing' },
              resources: { status: 'missing' },
              volumes: {
                collection: { all: { status: 'missing' }, byProject: {} },
                items: {},
              },
              buckets: {
                collection: { all: { status: 'missing' }, byProject: {} },
                items: {},
              },
            };
          }
        }
      }, [resourceKeys.storagePoolsCollection]);
      debugIncusData('storagePools.names:ready', {
        count: response.metadata.length,
      });
    } catch (error) {
      store.markStoragePoolsStatus(
        'error',
        error instanceof Error ? error.message : 'Unable to load storage pools.',
      );
      debugIncusData('storagePools.names:error', error);
    }
  });
}

async function ensureStoragePoolMetadata(
  store: IncusStore,
  requests: RequestRegistry,
  names: string[],
) {
  const missing = names.filter((name) => {
    const item = store.getSnapshot().state.storagePools.items[name];
    return item && shouldFetchStoredStatus(item.metadata.status);
  });
  if (!missing.length) {
    debugIncusData('storagePools.metadata:skip', {
      names,
      statuses: names.map((name) => ({
        name,
        status: store.getSnapshot().state.storagePools.items[name]?.metadata.status,
      })),
    });
    return;
  }

  const basePath = '/1.0/storage-pools?recursion=1';
  const chunks = chunkFilterNames(missing, basePath);
  debugIncusData('storagePools.metadata:fetch', { missing, chunks });

  await Promise.all(
    chunks.map((chunk) =>
      requests.run(
        `storage-pools:metadata:${chunk.join('|')}`,
        chunk.map(resourceKeys.storagePoolMetadata),
        async () => {
          try {
            const response = await requestJson<StoragePool[]>('/1.0/storage-pools', {
              params: {
                recursion: 1,
                filter: nameEqualsFilter(chunk),
              },
            });
            store.update((state) => {
              for (const pool of response.metadata) {
                const item = state.storagePools.items[pool.name];
                if (!item) continue;
                item.metadata = { status: 'ready', data: pool };
              }
            }, chunk.map(resourceKeys.storagePoolMetadata));
            debugIncusData('storagePools.metadata:ready', { chunk });
          } catch (error) {
            store.update((state) => {
              for (const name of chunk) {
                const item = state.storagePools.items[name];
                if (!item) continue;
                item.metadata = {
                  ...item.metadata,
                  status: 'error',
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Unable to load storage pool metadata.',
                };
              }
            }, chunk.map(resourceKeys.storagePoolMetadata));
            debugIncusData('storagePools.metadata:error', { chunk, error });
          }
        },
      ),
    ),
  );
}

async function ensureStoragePoolResources(
  store: IncusStore,
  requests: RequestRegistry,
  names: string[],
) {
  const missing = names.filter((name) => {
    const item = store.getSnapshot().state.storagePools.items[name];
    return item && shouldFetchStoredStatus(item.resources.status);
  });
  if (!missing.length) {
    debugIncusData('storagePools.resources:skip', {
      names,
      statuses: names.map((name) => ({
        name,
        status: store.getSnapshot().state.storagePools.items[name]?.resources.status,
      })),
    });
    return;
  }

  debugIncusData('storagePools.resources:fetch', {
    missing,
    concurrency: 4,
  });

  await mapWithConcurrency(missing, 4, async (name) =>
    requests.run(`storage-pools:resources:${name}`, [resourceKeys.storagePoolResources(name)], async () => {
      try {
        const response = await requestJson<ResourcesStoragePool>(
          `/1.0/storage-pools/${encodeURIComponent(name)}/resources`,
        );
        store.update((state) => {
          const item = state.storagePools.items[name];
          if (!item) return;
          item.resources = { status: 'ready', data: response.metadata };
        }, [resourceKeys.storagePoolResources(name)]);
        debugIncusData('storagePools.resources:ready', { name });
      } catch (error) {
        store.update((state) => {
          const item = state.storagePools.items[name];
          if (!item) return;
          item.resources = {
            ...item.resources,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load storage pool resources.',
          };
        }, [resourceKeys.storagePoolResources(name)]);
        debugIncusData('storagePools.resources:error', { name, error });
      }
    }),
  );
}
