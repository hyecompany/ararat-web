'use client';

import { mapWithConcurrency } from '../../concurrency';
import { debugIncusData } from '../../debug';
import { chunkFilterNames, nameEqualsFilter } from '../../filters';
import { instanceKey } from '../../keys';
import { resourceKeys } from '../../resources';
import { applyProjectSelection, collectionStatusKey } from '../../scope';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type {
  CacheStatus,
  Instance,
  InstanceBackup,
  InstanceSnapshot,
  InstanceState,
} from '../../types';

export type VisibleRange = {
  start: number;
  count: number;
  overscan?: number;
};

export type InstanceInclude = {
  metadata?: boolean;
  state?: boolean;
  access?: boolean;
  snapshots?: boolean;
  backups?: boolean;
};

export type EnsureInstancesRequest = {
  include?: InstanceInclude;
  visibleKeys?: string[];
  visibleRange?: VisibleRange;
  collection?: boolean;
};

type InstancePayload = Instance & {
  backups?: InstanceBackup[];
  snapshots?: InstanceSnapshot[];
  state?: InstanceState;
};

type InstancesDraft = Parameters<Parameters<IncusStore['update']>[0]>[0];

const INSTANCE_METADATA_DIRECT_CONCURRENCY = 6;

function collectionRecursionForInclude(include: InstanceInclude): 1 | 2 {
  return include.state || include.snapshots || include.backups ? 2 : 1;
}

function instanceIdentityFromPath(path: string, fallbackProject: string) {
  const parsed = new URL(path, window.location.origin);
  const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  return {
    name: parts[2] ?? path,
    project: parsed.searchParams.get('project') ?? fallbackProject,
  };
}

function paramsForProject(project: string, extra?: Record<string, string | number>) {
  const params = new URLSearchParams();
  applyProjectSelection(params, project);
  for (const [key, value] of Object.entries(extra ?? {})) {
    params.set(key, String(value));
  }
  return Object.fromEntries(params.entries());
}

export function splitInstanceKey(key: string) {
  const [project = 'default', name = ''] = key.split('/').map(decodeURIComponent);
  return { project, name };
}

function statePathForKey(key: string) {
  const { project, name } = splitInstanceKey(key);
  return {
    path: `/1.0/instances/${encodeURIComponent(name)}/state`,
    params: { project },
  };
}

function accessPathForKey(key: string) {
  const { project, name } = splitInstanceKey(key);
  return {
    path: `/1.0/instances/${encodeURIComponent(name)}/access`,
    params: { project },
  };
}

function metadataPathForKey(key: string) {
  const { project, name } = splitInstanceKey(key);
  return {
    path: `/1.0/instances/${encodeURIComponent(name)}`,
    params: { project },
  };
}

function collectionPayloadKey(project: string, instance: Instance) {
  return instanceKey(
    instance.project ?? (project === 'all' ? 'default' : project),
    instance.name,
  );
}

export function shellInstanceFromKey(key: string, item: { metadata: { data?: Instance; status: CacheStatus }; state: { data?: InstanceState } }): Instance {
  const { project, name } = splitInstanceKey(key);
  const metadata = item.metadata.data;
  return {
    ...(metadata ?? {}),
    name: metadata?.name ?? name,
    project: metadata?.project ?? project,
    description: metadata?.description ?? '',
    status: metadata?.status ?? item.metadata.status,
    status_code: metadata?.status_code ?? 0,
    type: metadata?.type ?? '',
    architecture: metadata?.architecture ?? '',
    config: metadata?.config ?? {},
    devices: metadata?.devices ?? {},
    profiles: metadata?.profiles ?? [],
    state: item.state.data,
  } as Instance;
}

function visibleSlice<T>(items: T[], range?: VisibleRange) {
  if (!range) return items;
  const overscan = range.overscan ?? 0;
  const start = Math.max(0, range.start - overscan);
  const end = Math.min(items.length, range.start + range.count + overscan);
  return items.slice(start, end);
}

export function instanceKeysForProject(
  store: IncusStore,
  project: string,
) {
  const collectionKey = collectionStatusKey(project);
  const prefix =
    project === 'all' ? null : `${encodeURIComponent(collectionKey)}/`;

  return Object.entries(store.getSnapshot().state.instances.items)
    .filter(([key]) => !prefix || key.startsWith(prefix))
    .filter(([key, item]) => {
      const { project: itemProject } = splitInstanceKey(key);
      return itemProject !== 'all' &&
        (item.metadata.status !== 'error' || item.metadata.data !== undefined);
    })
    .sort(([aKey, aItem], [bKey, bItem]) => {
      const a = shellInstanceFromKey(aKey, aItem);
      const b = shellInstanceFromKey(bKey, bItem);
      const projectCompare = (a.project ?? '').localeCompare(b.project ?? '');
      return projectCompare || a.name.localeCompare(b.name);
    })
    .map(([key]) => key);
}

export function visibleInstanceKeys(
  store: IncusStore,
  project: string,
  range?: VisibleRange,
) {
  return visibleSlice(instanceKeysForProject(store, project), range);
}

function shortNestedName(name: string) {
  return name.split('/').filter(Boolean).pop() ?? name;
}

function splitInstancePayload(payload: InstancePayload) {
  const {
    backups,
    snapshots,
    state,
    ...metadata
  } = payload;
  return {
    metadata: metadata as Instance,
    state,
    snapshots,
    backups,
  };
}

function upsertInstancePayload(
  draft: InstancesDraft,
  store: IncusStore,
  key: string,
  payload: InstancePayload,
) {
  const item = draft.instances.items[key] ?? store.ensureInstance(key);
  const normalized = splitInstancePayload(payload);
  item.metadata = { status: 'ready', data: normalized.metadata };

  if (normalized.state) {
    item.state = { status: 'ready', data: normalized.state };
  }

  if (normalized.snapshots) {
    item.snapshots.collection = { status: 'ready' };
    item.snapshots.items = {};
    for (const snapshot of normalized.snapshots) {
      const name = shortNestedName(snapshot.name);
      item.snapshots.items[name] = {
        metadata: { status: 'ready', data: { ...snapshot, name } },
      };
    }
  }

  if (normalized.backups) {
    item.backups.collection = { status: 'ready' };
    item.backups.items = {};
    for (const backup of normalized.backups) {
      const name = shortNestedName(backup.name);
      item.backups.items[name] = {
        metadata: { status: 'ready', data: { ...backup, name } },
      };
    }
  }
}

function keysForInstancePayload(key: string, payload: InstancePayload) {
  return [
    resourceKeys.instanceMetadata(key),
    ...(payload.state ? [resourceKeys.instanceState(key)] : []),
    ...(payload.snapshots
      ? [
          resourceKeys.instanceSnapshotsCollection(key),
          ...payload.snapshots.map((snapshot) =>
            resourceKeys.instanceSnapshotMetadata(
              key,
              shortNestedName(snapshot.name),
            ),
          ),
        ]
      : []),
    ...(payload.backups
      ? [
          resourceKeys.instanceBackupsCollection(key),
          ...payload.backups.map((backup) =>
            resourceKeys.instanceBackupMetadata(key, shortNestedName(backup.name)),
          ),
        ]
      : []),
  ];
}

function payloadHasNestedData(payload: Instance | undefined): payload is InstancePayload {
  if (!payload) return false;
  const maybeFull = payload as InstancePayload;
  return Boolean(maybeFull.state || maybeFull.snapshots || maybeFull.backups);
}

function canonicalizeStoredInstancePayloads(
  store: IncusStore,
  visibleKeys: string[],
) {
  const dirtyKeys = visibleKeys.filter((key) =>
    payloadHasNestedData(store.getSnapshot().state.instances.items[key]?.metadata.data),
  );
  if (!dirtyKeys.length) return;

  store.update((state) => {
    for (const key of dirtyKeys) {
      const payload = state.instances.items[key]?.metadata.data;
      if (!payloadHasNestedData(payload)) continue;
      upsertInstancePayload(state, store, key, payload);
    }
  }, dirtyKeys.flatMap((key) => {
    const payload = store.getSnapshot().state.instances.items[key]?.metadata.data;
    return payloadHasNestedData(payload)
      ? keysForInstancePayload(key, payload)
      : [resourceKeys.instanceMetadata(key)];
  }));
}

async function ensureSingleInstanceMetadata(
  store: IncusStore,
  requests: RequestRegistry,
  key: string,
) {
  const { project: itemProject, name } = splitInstanceKey(key);
  return requests.run(
    `instances:metadata:${key}`,
    [resourceKeys.instanceMetadata(key)],
    async () => {
      const { path, params } = metadataPathForKey(key);
      try {
        const response = await requestJson<Instance>(path, { params });
        store.update((state) => {
          upsertInstancePayload(state, store, key, response.metadata);
        }, [resourceKeys.instanceMetadata(key)]);
        debugIncusData('instances.metadata:ready', {
          project: itemProject,
          names: [name],
          strategy: 'direct',
        });
      } catch (error) {
        store.update((state) => {
          const item = state.instances.items[key] ?? store.ensureInstance(key);
          item.metadata = {
            ...item.metadata,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load instance metadata.',
          };
        }, [resourceKeys.instanceMetadata(key)]);
        debugIncusData('instances.metadata:error', {
          project: itemProject,
          names: [name],
          strategy: 'direct',
          error,
        });
      }
    },
  );
}

async function ensureInstanceNames(
  store: IncusStore,
  requests: RequestRegistry,
  project: string,
) {
  const collectionKey = collectionStatusKey(project);
  const collection =
    store.getSnapshot().state.instances.collection.byProject[collectionKey] ??
    store.getSnapshot().state.instances.collection.all;
  const status = collection.status;
  if (!shouldFetchStoredStatus(status)) return;

  debugIncusData('instances.names:fetch', {
    project,
    from: status,
  });

  await requests.run(
    `instances:names:${collectionKey}`,
    [resourceKeys.instancesCollection(collectionKey)],
    async () => {
    try {
      const response = await requestJson<string[]>('/1.0/instances', {
        params: paramsForProject(project),
      });

      store.update((state) => {
        state.instances.collection.byProject[collectionKey] = { status: 'ready' };
        for (const path of response.metadata) {
          const identity = instanceIdentityFromPath(path, project === 'all' ? 'default' : project);
          const key = instanceKey(identity.project, identity.name);
          store.ensureInstance(key);
        }
      }, [
        resourceKeys.instancesCollection(collectionKey),
      ]);

      debugIncusData('instances.names:ready', {
        project,
        count: response.metadata.length,
      });
    } catch (error) {
      store.update((state) => {
        state.instances.collection.byProject[collectionKey] = {
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Unable to load instances.',
        };
      }, [resourceKeys.instancesCollection(collectionKey)]);
      debugIncusData('instances.names:error', error);
    }
    },
  );
}

async function ensureInstanceMetadata(
  store: IncusStore,
  requests: RequestRegistry,
  project: string,
  visibleKeys: string[],
) {
  const missing = visibleKeys.filter((key) => {
    const item = store.getSnapshot().state.instances.items[key];
    return item && shouldFetchStoredStatus(item.metadata.status);
  });
  if (!missing.length) {
    debugIncusData('instances.metadata:skip', {
      project,
      reason: 'visible metadata is already usable',
      visibleCount: visibleKeys.length,
    });
    return;
  }

  debugIncusData('instances.metadata:fetch', {
    project,
    strategy: 'direct-concurrent',
    missing,
    concurrency: INSTANCE_METADATA_DIRECT_CONCURRENCY,
  });

  await mapWithConcurrency(
    missing,
    INSTANCE_METADATA_DIRECT_CONCURRENCY,
    (key) => ensureSingleInstanceMetadata(store, requests, key),
  );
}

async function ensureInstanceCollectionPayloads(
  store: IncusStore,
  requests: RequestRegistry,
  project: string,
  visibleKeys: string[],
  recursion: 1 | 2,
) {
  // List screens are different from detail screens: once the collection has told
  // us which visible names exist, Incus can hydrate those rows much more cheaply
  // with one filtered recursive collection request than with N individual
  // instance GETs. `include` still describes the data shape; this planner chooses
  // whether recursion=1 or recursion=2 is worth using for the visible range.
  const targets = visibleKeys.filter((key) => {
    const item = store.getSnapshot().state.instances.items[key];
    if (!item) return false;
    return shouldFetchStoredStatus(item.metadata.status) ||
      (recursion >= 2 && shouldFetchStoredStatus(item.state.status));
  });
  if (!targets.length) {
    debugIncusData('instances.collectionPayloads:skip', {
      project,
      recursion,
      visibleCount: visibleKeys.length,
    });
    return;
  }

  const names = Array.from(
    new Set(targets.map((key) => splitInstanceKey(key).name)),
  );
  const basePath = '/1.0/instances';
  const chunks = chunkFilterNames(names, basePath);

  debugIncusData('instances.collectionPayloads:fetch', {
    project,
    recursion,
    targets,
    chunks,
    strategy: 'filtered-recursive-collection',
  });

  await Promise.all(
    chunks.map((chunk) => {
      const affectedTargetKeys = targets.filter((key) =>
        chunk.includes(splitInstanceKey(key).name),
      );
      const affectedKeys = affectedTargetKeys.flatMap((key) => [
        resourceKeys.instanceMetadata(key),
        ...(recursion >= 2 ? [resourceKeys.instanceState(key)] : []),
      ]);

      return requests.run(
        `instances:collection:${project}:r${recursion}:${chunk.join('|')}`,
        affectedKeys,
        async () => {
          try {
            const response = await requestJson<Instance[]>('/1.0/instances', {
              params: paramsForProject(project, {
                recursion,
                filter: nameEqualsFilter(chunk),
              }),
            });
            const returnedKeys = response.metadata.map((instance) =>
              collectionPayloadKey(project, instance),
            );

            store.update((state) => {
              for (const instance of response.metadata) {
                upsertInstancePayload(
                  state,
                  store,
                  collectionPayloadKey(project, instance),
                  instance,
                );
              }
            }, [
              ...affectedKeys,
              ...returnedKeys.flatMap((key) => [
                resourceKeys.instanceMetadata(key),
                ...(recursion >= 2 ? [resourceKeys.instanceState(key)] : []),
              ]),
            ]);
            debugIncusData('instances.collectionPayloads:ready', {
              project,
              recursion,
              chunk,
              returnedKeys,
            });
          } catch (error) {
            store.update((state) => {
              for (const key of affectedTargetKeys) {
                const item = state.instances.items[key] ?? store.ensureInstance(key);
                if (shouldFetchStoredStatus(item.metadata.status)) {
                  item.metadata = {
                    ...item.metadata,
                    status: 'error',
                    error:
                      error instanceof Error
                        ? error.message
                        : 'Unable to load instance metadata.',
                  };
                }
                if (recursion >= 2 && shouldFetchStoredStatus(item.state.status)) {
                  item.state = {
                    ...item.state,
                    status: 'error',
                    error:
                      error instanceof Error
                        ? error.message
                        : 'Unable to load instance state.',
                  };
                }
              }
            }, affectedKeys);
            debugIncusData('instances.collectionPayloads:error', {
              project,
              recursion,
              chunk,
              error,
            });
          }
        },
      );
    }),
  );
}

async function ensureInstanceState(
  store: IncusStore,
  requests: RequestRegistry,
  visibleKeys: string[],
) {
  const missing = visibleKeys.filter((key) => {
    const item = store.getSnapshot().state.instances.items[key];
    return item && shouldFetchStoredStatus(item.state.status);
  });
  if (!missing.length) {
    debugIncusData('instances.state:skip', {
      reason: 'visible state is already usable',
      visibleCount: visibleKeys.length,
    });
    return;
  }

  await mapWithConcurrency(missing, 4, async (key) =>
    requests.run(`instances:state:${key}`, [resourceKeys.instanceState(key)], async () => {
      const { path, params } = statePathForKey(key);
      try {
        const response = await requestJson<InstanceState>(path, { params });
        store.update((state) => {
          const item = state.instances.items[key];
          if (!item) return;
          item.state = { status: 'ready', data: response.metadata };
        }, [resourceKeys.instanceState(key)]);
        debugIncusData('instances.state:ready', { key });
      } catch (error) {
        store.update((state) => {
          const item = state.instances.items[key];
          if (!item) return;
          item.state = {
            ...item.state,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load instance state.',
          };
        }, [resourceKeys.instanceState(key)]);
        debugIncusData('instances.state:error', { key, error });
      }
    }),
  );
}

async function ensureInstanceAccess(
  store: IncusStore,
  requests: RequestRegistry,
  visibleKeys: string[],
) {
  const missing = visibleKeys.filter((key) => {
    const item = store.getSnapshot().state.instances.items[key];
    return item && shouldFetchStoredStatus(item.access.status);
  });
  if (!missing.length) {
    debugIncusData('instances.access:skip', {
      reason: 'visible access is already usable',
      visibleCount: visibleKeys.length,
    });
    return;
  }

  await mapWithConcurrency(missing, 4, async (key) =>
    requests.run(`instances:access:${key}`, [resourceKeys.instanceAccess(key)], async () => {
      const { path, params } = accessPathForKey(key);
      try {
        const response = await requestJson<string[]>(path, { params });
        store.update((state) => {
          const item = state.instances.items[key];
          if (!item) return;
          item.access = { status: 'ready', data: response.metadata };
        }, [resourceKeys.instanceAccess(key)]);
        debugIncusData('instances.access:ready', { key });
      } catch (error) {
        store.update((state) => {
          const item = state.instances.items[key];
          if (!item) return;
          item.access = {
            ...item.access,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load instance access.',
          };
        }, [resourceKeys.instanceAccess(key)]);
        debugIncusData('instances.access:error', { key, error });
      }
    }),
  );
}

export async function ensureInstances(
  store: IncusStore,
  requests: RequestRegistry,
  project: string,
  request: EnsureInstancesRequest = {},
) {
  debugIncusData('instances.ensure:start', {
    project,
    include: request.include ?? { metadata: true, state: true },
    visibleCount: request.visibleKeys?.length ?? 0,
  });

  const include = request.include ?? { metadata: true, state: true };
  const hasExplicitVisibleKeys = request.visibleKeys !== undefined;
  let visibleKeys = request.visibleKeys ?? [];
  const needsCollection = request.collection ?? !hasExplicitVisibleKeys;
  const collectionPayloadRecursion: 1 | 2 =
    collectionRecursionForInclude(include);
  const collectionKey = collectionStatusKey(project);
  if (
    needsCollection &&
    requests.has(resourceKeys.instancesCollection(collectionKey))
  ) {
    debugIncusData('instances.ensure:deferCollectionInFlight', {
      project,
      include,
    });
    return;
  }

  if (needsCollection) {
    await ensureInstanceNames(store, requests, project);
  }

  if (!hasExplicitVisibleKeys) {
    visibleKeys = visibleInstanceKeys(store, project, request.visibleRange);
  }

  if (visibleKeys.length) {
    store.update((state) => {
      for (const key of visibleKeys) {
        state.instances.items[key] ?? store.ensureInstance(key);
      }
    }, visibleKeys.map(resourceKeys.instanceMetadata));
    canonicalizeStoredInstancePayloads(store, visibleKeys);
  }

  const shouldUseFilteredCollectionPayloads =
    include.metadata !== false &&
    (needsCollection || visibleKeys.length > 1);
  const accessTask = include.access
    ? ensureInstanceAccess(store, requests, visibleKeys)
    : Promise.resolve();

  if (shouldUseFilteredCollectionPayloads) {
    await Promise.all([
      ensureInstanceCollectionPayloads(
        store,
        requests,
        project,
        visibleKeys,
        collectionPayloadRecursion,
      ),
      include.state && collectionPayloadRecursion < 2
        ? ensureInstanceState(store, requests, visibleKeys)
        : Promise.resolve(),
      accessTask,
    ]);
  } else {
    await Promise.all([
      include.metadata === false
        ? Promise.resolve()
        : ensureInstanceMetadata(store, requests, project, visibleKeys),
      include.state === false
        ? Promise.resolve()
        : ensureInstanceState(store, requests, visibleKeys),
      accessTask,
    ]);
  }

  debugIncusData('instances.ensure:done', {
    project,
    visibleCount: visibleKeys.length,
  });
}

export function createInstancesResource(
  store: IncusStore,
  requests: RequestRegistry,
  getProject: () => string,
) {
  return {
    ensure: (request?: EnsureInstancesRequest) =>
      ensureInstances(store, requests, getProject(), request),
    markStale: (key: string, include: InstanceInclude = { metadata: true }) => {
      store.update((state) => {
        const item = state.instances.items[key] ?? store.ensureInstance(key);
        if (include.metadata !== false) {
          item.metadata = {
            ...item.metadata,
            status: item.metadata.data ? 'stale' : 'missing',
            error: undefined,
          };
        }
        if (include.state) {
          item.state = {
            ...item.state,
            status: item.state.data ? 'stale' : 'missing',
            error: undefined,
          };
        }
        if (include.access) {
          item.access = {
            ...item.access,
            status: item.access.data ? 'stale' : 'missing',
            error: undefined,
          };
        }
      }, [
        ...(include.metadata !== false ? [resourceKeys.instanceMetadata(key)] : []),
        ...(include.state ? [resourceKeys.instanceState(key)] : []),
        ...(include.access ? [resourceKeys.instanceAccess(key)] : []),
      ]);
    },
  };
}
