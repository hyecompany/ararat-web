'use client';

import { storageBucketKey, storageVolumeKey } from './keys';
import {
  keysForResource,
  parseIncusResourcePath,
  parentResourcePath,
  resourceKeys,
  type IncusResourceRef,
  type IncusStoreKey,
} from './resources';
import { type IncusStore } from './store';
import type {
  CacheStatus,
  IncusOperation,
  IncusStoreState,
  InstanceFileMetadata,
} from './types';
import type { IncusEvent } from '@/app/_context/events';

type LifecycleMetadata = {
  action?: unknown;
  source?: unknown;
  context?: Record<string, unknown>;
};

type OperationMetadata = {
  id?: unknown;
  class?: unknown;
  description?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  err?: unknown;
  location?: unknown;
  may_cancel?: unknown;
  metadata?: unknown;
  resources?: unknown;
  status?: unknown;
  status_code?: unknown;
};

function markCachedStatusStale<T extends { status: CacheStatus }>(cached: T) {
  if (cached.status === 'ready') {
    cached.status = 'stale';
  }
}

function markResourceStale(state: IncusStoreState, resource: IncusResourceRef) {
  switch (resource.kind) {
    case 'projectsCollection':
      markCachedStatusStale(state.projects.collection);
      return;
    case 'project': {
      const item = state.projects.items[resource.name];
      if (item) markCachedStatusStale(item.metadata);
      markCachedStatusStale(state.projects.collection);
      return;
    }
    case 'profilesCollection': {
      const collection = state.profiles.collection.byProject[resource.project];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'profile': {
      const item = state.profiles.items[resource.key];
      if (item) markCachedStatusStale(item.metadata);
      const collection = state.profiles.collection.byProject[resource.project];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'operationsCollection':
      markCachedStatusStale(state.operations.collection);
      return;
    case 'operation': {
      const item = state.operations.items[resource.id];
      if (item) markCachedStatusStale(item.metadata);
      markCachedStatusStale(state.operations.collection);
      return;
    }
    case 'certificate': {
      const item = state.certificates.items[resource.fingerprint];
      if (item) markCachedStatusStale(item.metadata);
      return;
    }
    case 'imagesCollection': {
      const collection = state.images.collection.byProject[resource.project];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'image': {
      const item = state.images.items[resource.key];
      if (item) markCachedStatusStale(item.metadata);
      const collection = state.images.collection.byProject[resource.project];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'networksCollection': {
      const collection = state.networks.collection.byProject[resource.project];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'network': {
      const item = state.networks.items[resource.key];
      if (item) markCachedStatusStale(item.metadata);
      const collection = state.networks.collection.byProject[resource.project];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'networkZonesCollection':
      markCachedStatusStale(state.networkZones.collection);
      return;
    case 'networkZone': {
      const item = state.networkZones.items[resource.name];
      if (item) markCachedStatusStale(item.metadata);
      markCachedStatusStale(state.networkZones.collection);
      return;
    }
    case 'networkIntegrationsCollection':
      markCachedStatusStale(state.networkIntegrations.collection);
      return;
    case 'networkIntegration': {
      const item = state.networkIntegrations.items[resource.name];
      if (item) markCachedStatusStale(item.metadata);
      markCachedStatusStale(state.networkIntegrations.collection);
      return;
    }
    case 'clusterGroupsCollection':
      markCachedStatusStale(state.clusterGroups.collection);
      return;
    case 'clusterGroup': {
      const item = state.clusterGroups.items[resource.name];
      if (item) markCachedStatusStale(item.metadata);
      markCachedStatusStale(state.clusterGroups.collection);
      return;
    }
    case 'storagePoolsCollection':
      markCachedStatusStale(state.storagePools.collection);
      return;
    case 'storagePool': {
      const item = state.storagePools.items[resource.pool];
      if (!item) return;
      markCachedStatusStale(item.metadata);
      markCachedStatusStale(item.resources);
      return;
    }
    case 'storagePoolResources': {
      const item = state.storagePools.items[resource.pool];
      if (item) markCachedStatusStale(item.resources);
      return;
    }
    case 'storageVolumesCollection': {
      const collection =
        state.storagePools.items[resource.pool]?.volumes.collection.byProject[
          resource.project
        ];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'storageVolume': {
      const key = storageVolumeKey(
        resource.project,
        resource.volumeType,
        resource.name,
      );
      const item = state.storagePools.items[resource.pool]?.volumes.items[key];
      if (!item) return;
      markCachedStatusStale(item.metadata);
      markCachedStatusStale(item.state);
      return;
    }
    case 'storageBucketsCollection': {
      const collection =
        state.storagePools.items[resource.pool]?.buckets.collection.byProject[
          resource.project
        ];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'storageBucket': {
      const key = storageBucketKey(resource.project, resource.name);
      const item = state.storagePools.items[resource.pool]?.buckets.items[key];
      if (item) markCachedStatusStale(item.metadata);
      return;
    }
    case 'instancesCollection': {
      const collection = state.instances.collection.byProject[resource.project];
      if (collection) markCachedStatusStale(collection);
      return;
    }
    case 'instance': {
      const item = state.instances.items[resource.key];
      if (!item) return;
      markCachedStatusStale(item.metadata);
      markCachedStatusStale(item.state);
      markCachedStatusStale(item.access);
      return;
    }
    case 'instanceState': {
      const item = state.instances.items[resource.key];
      if (item) markCachedStatusStale(item.state);
      return;
    }
    case 'instanceFile': {
      const item = state.instances.items[resource.key];
      if (!item) return;

      const parent = item.files.items[parentResourcePath(resource.path)];
      if (parent?.children) markCachedStatusStale(parent.children);

      const file = item.files.items[resource.path];
      if (!file) return;
      markCachedStatusStale(file.metadata);
      if (file.children) markCachedStatusStale(file.children);
      if (file.content) markCachedStatusStale(file.content);
      return;
    }
    case 'instanceBackupsCollection': {
      const item = state.instances.items[resource.key];
      if (item) markCachedStatusStale(item.backups.collection);
      return;
    }
    case 'instanceBackup': {
      const item = state.instances.items[resource.key];
      if (!item) return;
      markCachedStatusStale(item.backups.collection);
      const backup = item.backups.items[resource.backup];
      if (backup) markCachedStatusStale(backup.metadata);
      return;
    }
    case 'instanceSnapshotsCollection': {
      const item = state.instances.items[resource.key];
      if (item) markCachedStatusStale(item.snapshots.collection);
      return;
    }
    case 'instanceSnapshot': {
      const item = state.instances.items[resource.key];
      if (!item) return;
      markCachedStatusStale(item.snapshots.collection);
      const snapshot = item.snapshots.items[resource.snapshot];
      if (snapshot) markCachedStatusStale(snapshot.metadata);
      return;
    }
  }
}

function addShellForCreatedResource(state: IncusStoreState, resource: IncusResourceRef) {
  if (resource.kind === 'project') {
    if (state.projects.collection.status !== 'missing') {
      state.projects.items[resource.name] ??= {
        metadata: { status: 'missing' },
      };
      state.projects.collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'profile') {
    const collection = state.profiles.collection.byProject[resource.project];
    if (collection && collection.status !== 'missing') {
      state.profiles.items[resource.key] ??= {
        metadata: { status: 'missing' },
      };
      collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'operation') {
    if (state.operations.collection.status !== 'missing') {
      state.operations.items[resource.id] ??= {
        metadata: { status: 'missing' },
      };
      state.operations.collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'image') {
    const collection = state.images.collection.byProject[resource.project];
    if (collection && collection.status !== 'missing') {
      state.images.items[resource.key] ??= {
        metadata: { status: 'missing' },
      };
      collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'network') {
    const collection = state.networks.collection.byProject[resource.project];
    if (collection && collection.status !== 'missing') {
      state.networks.items[resource.key] ??= {
        metadata: { status: 'missing' },
      };
      collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'networkZone') {
    if (state.networkZones.collection.status !== 'missing') {
      state.networkZones.items[resource.name] ??= {
        metadata: { status: 'missing' },
      };
      state.networkZones.collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'networkIntegration') {
    if (state.networkIntegrations.collection.status !== 'missing') {
      state.networkIntegrations.items[resource.name] ??= {
        metadata: { status: 'missing' },
      };
      state.networkIntegrations.collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'clusterGroup') {
    if (state.clusterGroups.collection.status !== 'missing') {
      state.clusterGroups.items[resource.name] ??= {
        metadata: { status: 'missing' },
      };
      state.clusterGroups.collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'storagePool') {
    if (state.storagePools.collection.status !== 'missing') {
      state.storagePools.items[resource.pool] ??= {
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
      state.storagePools.collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'instance') {
    const collection = state.instances.collection.byProject[resource.project];
    if (collection && collection.status !== 'missing') {
      state.instances.items[resource.key] ??= {
        metadata: { status: 'missing' },
        state: { status: 'missing' },
        access: { status: 'missing' },
        snapshots: { collection: { status: 'missing' }, items: {} },
        backups: { collection: { status: 'missing' }, items: {} },
        logs: { collection: { status: 'missing' }, items: {} },
        files: { items: {} },
      };
      collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'instanceBackup') {
    const item = state.instances.items[resource.key];
    if (item && item.backups.collection.status !== 'missing') {
      item.backups.items[resource.backup] ??= {
        metadata: { status: 'missing' },
      };
      item.backups.collection.status = 'stale';
    }
    return;
  }

  if (resource.kind === 'instanceSnapshot') {
    const item = state.instances.items[resource.key];
    if (item && item.snapshots.collection.status !== 'missing') {
      item.snapshots.items[resource.snapshot] ??= {
        metadata: { status: 'missing' },
      };
      item.snapshots.collection.status = 'stale';
    }
  }
}

function removeDeletedResource(store: IncusStore, resource: IncusResourceRef) {
  if (resource.kind === 'project') {
    store.update((state) => {
      delete state.projects.items[resource.name];
      if (state.projects.collection.status === 'ready') {
        state.projects.collection.status = 'stale';
      }
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'profile') {
    store.update((state) => {
      delete state.profiles.items[resource.key];
      const collection = state.profiles.collection.byProject[resource.project];
      if (collection?.status === 'ready') {
        collection.status = 'stale';
      }
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'operation') {
    store.removeOperation(resource.id);
    return true;
  }

  if (resource.kind === 'image') {
    store.update((state) => {
      delete state.images.items[resource.key];
      const collection = state.images.collection.byProject[resource.project];
      if (collection?.status === 'ready') collection.status = 'stale';
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'network') {
    store.update((state) => {
      delete state.networks.items[resource.key];
      const collection = state.networks.collection.byProject[resource.project];
      if (collection?.status === 'ready') collection.status = 'stale';
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'networkZone') {
    store.update((state) => {
      delete state.networkZones.items[resource.name];
      if (state.networkZones.collection.status === 'ready') {
        state.networkZones.collection.status = 'stale';
      }
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'networkIntegration') {
    store.update((state) => {
      delete state.networkIntegrations.items[resource.name];
      if (state.networkIntegrations.collection.status === 'ready') {
        state.networkIntegrations.collection.status = 'stale';
      }
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'clusterGroup') {
    store.update((state) => {
      delete state.clusterGroups.items[resource.name];
      if (state.clusterGroups.collection.status === 'ready') {
        state.clusterGroups.collection.status = 'stale';
      }
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'storagePool') {
    store.removeStoragePool(resource.pool);
    return true;
  }

  if (resource.kind === 'instance') {
    store.removeInstance(resource.key);
    return true;
  }

  if (resource.kind === 'instanceFile') {
    store.update((state) => {
      const instance = state.instances.items[resource.key];
      if (!instance) return;

      delete instance.files.items[resource.path];
      const parent = instance.files.items[parentResourcePath(resource.path)];
      if (parent?.children) {
        const childName = childNameFromPath(resource.path);
        const names = childName
          ? parent.children.names.filter((name) => name !== childName)
          : parent.children.names;
        parent.children = {
          status: 'ready',
          names,
        };
      }
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'instanceBackup') {
    store.update((state) => {
      const item = state.instances.items[resource.key];
      if (!item) return;

      delete item.backups.items[resource.backup];
      if (item.backups.collection.status === 'ready') {
        item.backups.collection.status = 'stale';
      }
    }, keysForResource(resource));
    return true;
  }

  if (resource.kind === 'instanceSnapshot') {
    store.update((state) => {
      const item = state.instances.items[resource.key];
      if (!item) return;

      delete item.snapshots.items[resource.snapshot];
      if (item.snapshots.collection.status === 'ready') {
        item.snapshots.collection.status = 'stale';
      }
    }, keysForResource(resource));
    return true;
  }

  return false;
}

function isDeleteAction(action: string) {
  return action.includes('deleted') || action.includes('removed');
}

function isCreateAction(action: string) {
  return action.includes('created') || action.includes('added');
}

function isFileWriteAction(action: string) {
  return isCreateAction(action) || action.includes('pushed');
}

function contextFilePath(context: Record<string, unknown> | undefined) {
  // File push events include both a local `file-source` and an in-instance
  // `file-destination`; cache identity must always follow the instance path.
  const path =
    typeof context?.path === 'string'
      ? context.path
      : typeof context?.file === 'string'
        ? context.file
        : typeof context?.['file-destination'] === 'string'
          ? context['file-destination']
          : typeof context?.['file-source'] === 'string'
            ? context['file-source']
            : null;

  return typeof path === 'string' && path.trim() ? path : null;
}

function recordFromJson(value: unknown) {
  if (typeof value !== 'string') return recordFrom(value);

  try {
    return recordFrom(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function stringFrom(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberFrom(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metadataFromContextInfo(
  path: string,
  context: Record<string, unknown> | undefined,
): InstanceFileMetadata | null {
  const info = recordFromJson(context?.info);
  if (!info) return null;

  const metadata: InstanceFileMetadata = {
    path,
    type: stringFrom(info.type),
    size: numberFrom(info.size),
    mode: stringFrom(info.mode),
    uid: stringFrom(info.uid),
    gid: stringFrom(info.gid),
  };

  return [metadata.type, metadata.size, metadata.mode, metadata.uid, metadata.gid].some(
    (value) => value !== undefined,
  )
    ? metadata
    : null;
}

function childNameFromPath(path: string) {
  const trimmed = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf('/');
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function applyInstanceFileWriteEvent(
  store: IncusStore,
  resource: IncusResourceRef,
  context: Record<string, unknown> | undefined,
) {
  if (resource.kind !== 'instanceFile') return false;

  const parentPath = parentResourcePath(resource.path);
  const childName = childNameFromPath(resource.path);
  const metadata = metadataFromContextInfo(resource.path, context);
  const keys = keysForResource(resource);

  store.update((state) => {
    const instance = state.instances.items[resource.key];
    if (!instance) return;

    // Incus file write lifecycle events carry the destination path plus file
    // info, so a known parent listing can be patched authoritatively instead of
    // staying in stale mode until a follow-up directory fetch completes.
    const parent = instance.files.items[parentPath];
    if (parent?.children && childName) {
      const names = parent.children.names.includes(childName)
        ? parent.children.names
        : [...parent.children.names, childName].sort((a, b) =>
            a.localeCompare(b),
          );
      parent.children = {
        status: parent.children.status === 'error' ? 'stale' : 'ready',
        names,
      };
    }

    const file = instance.files.items[resource.path] ?? {
      metadata: { status: 'missing' as const },
    };
    if (metadata) {
      file.metadata = { status: 'ready', data: metadata };
    } else {
      markCachedStatusStale(file.metadata);
    }
    if (file.content) {
      markCachedStatusStale(file.content);
    }

    if (metadata?.type === 'directory' && !file.children) {
      file.children = { status: 'ready', names: [] };
    }

    instance.files.items[resource.path] = file;
  }, keys);

  return true;
}

function recordFrom(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function instanceFilesPathFromSource(source: string, filePath: string) {
  const [rawPath = '', rawSearch = ''] = source.split('?');
  const path = rawPath.endsWith('/files')
    ? rawPath
    : `${rawPath.replace(/\/$/, '')}/files`;
  const params = new URLSearchParams(rawSearch);
  params.set('path', filePath);
  return `${path}?${params.toString()}`;
}

function fileResourceFromLifecycle(
  metadata: LifecycleMetadata,
  eventProject?: string,
) {
  if (typeof metadata.action !== 'string') return null;
  if (!metadata.action.startsWith('instance-file-')) return null;

  const filePath = contextFilePath(metadata.context);
  if (!filePath || typeof metadata.source !== 'string') return null;

  return parseIncusResourcePath(
    instanceFilesPathFromSource(metadata.source, filePath),
    eventProject,
  );
}

function fileResourceFromOperation(
  metadata: OperationMetadata,
  eventProject?: string,
) {
  const operationContext = recordFrom(metadata.metadata);
  const nestedContext = recordFrom(operationContext?.context);
  const filePath =
    contextFilePath(operationContext) ?? contextFilePath(nestedContext);
  if (!filePath) return null;

  const instanceResource = operationResourcePaths(metadata)
    .map((path) => parseIncusResourcePath(path, eventProject))
    .find((resource): resource is Extract<IncusResourceRef, { kind: 'instance' }> =>
      resource?.kind === 'instance',
    );
  if (!instanceResource) return null;

  return parseIncusResourcePath(
    `/1.0/instances/${encodeURIComponent(instanceResource.name)}/files?project=${encodeURIComponent(instanceResource.project)}&path=${encodeURIComponent(filePath)}`,
    eventProject,
  );
}

function isLikelyInstanceFileOperation(metadata: OperationMetadata) {
  if (fileResourceFromOperation(metadata)) return true;
  if (typeof metadata.description !== 'string') return false;
  return /\bfile\b/i.test(metadata.description);
}

function applyResourceChange(
  store: IncusStore,
  resource: IncusResourceRef,
  options: { createShell?: boolean } = {},
) {
  const keys = keysForResource(resource);
  if (!keys.length) return;

  store.update((state) => {
    if (options.createShell) {
      addShellForCreatedResource(state, resource);
    }
    markResourceStale(state, resource);
  }, keys);
}

function applyLifecycleEvent(store: IncusStore, event: IncusEvent) {
  const metadata = event.metadata as LifecycleMetadata;
  if (typeof metadata.action !== 'string') return;

  const resource =
    fileResourceFromLifecycle(metadata, event.project) ??
    parseIncusResourcePath(metadata.source, event.project);
  if (!resource) return;

  if (isDeleteAction(metadata.action) && removeDeletedResource(store, resource)) {
    return;
  }

  if (
    isFileWriteAction(metadata.action) &&
    applyInstanceFileWriteEvent(store, resource, metadata.context)
  ) {
    return;
  }

  // Lifecycle events usually do not contain a full fresh object. They are still
  // authoritative enough to update identity: creates add shells when the parent
  // collection is known, deletes remove known entries, and all other changes mark
  // the exact resource stale so active hooks refresh it without blanking the UI.
  applyResourceChange(store, resource, {
    createShell: isCreateAction(metadata.action),
  });
}

function operationResourcePaths(metadata: OperationMetadata) {
  if (!metadata.resources || typeof metadata.resources !== 'object') return [];

  return Object.values(metadata.resources as Record<string, unknown>)
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((value): value is string => typeof value === 'string');
}

function operationFromMetadata(metadata: OperationMetadata): IncusOperation | null {
  if (typeof metadata.id !== 'string' || !metadata.id) return null;

  return {
    id: metadata.id,
    class: typeof metadata.class === 'string' ? metadata.class : undefined,
    description:
      typeof metadata.description === 'string' ? metadata.description : undefined,
    created_at:
      typeof metadata.created_at === 'string' ? metadata.created_at : undefined,
    updated_at:
      typeof metadata.updated_at === 'string' ? metadata.updated_at : undefined,
    err: typeof metadata.err === 'string' ? metadata.err : undefined,
    location: typeof metadata.location === 'string' ? metadata.location : undefined,
    may_cancel:
      typeof metadata.may_cancel === 'boolean' ? metadata.may_cancel : undefined,
    metadata: metadata.metadata,
    resources:
      metadata.resources && typeof metadata.resources === 'object'
        ? (metadata.resources as Record<string, string[]>)
        : undefined,
    status: typeof metadata.status === 'string' ? metadata.status : undefined,
    status_code:
      typeof metadata.status_code === 'number'
        ? (metadata.status_code as IncusOperation['status_code'])
        : undefined,
  };
}

function applyOperationEvent(store: IncusStore, event: IncusEvent) {
  const metadata = event.metadata as OperationMetadata;
  const operation = operationFromMetadata(metadata);
  const paths = operationResourcePaths(metadata);
  const fileResource = fileResourceFromOperation(metadata, event.project);
  const isFileOperation = Boolean(fileResource) || isLikelyInstanceFileOperation(metadata);

  const parsed = paths
    .map((path) => parseIncusResourcePath(path, event.project))
    .filter((resource) => !(isFileOperation && resource?.kind === 'instance'));
  if (fileResource) {
    parsed.push(fileResource);
  }
  const resources = parsed
    .filter((resource): resource is IncusResourceRef => Boolean(resource));

  const keys = new Set<IncusStoreKey>();
  if (operation) {
    keys.add(resourceKeys.operationsCollection);
    keys.add(resourceKeys.operationMetadata(operation.id));
  }
  for (const resource of resources) {
    for (const key of keysForResource(resource)) keys.add(key);
  }
  if (!keys.size) return;

  store.update((state) => {
    if (operation) {
      const item = state.operations.items[operation.id] ?? {
        metadata: { status: 'missing' as const },
      };
      item.metadata = { status: 'ready', data: operation };
      state.operations.items[operation.id] = item;
    }
    for (const resource of resources) {
      markResourceStale(state, resource);
    }
  }, Array.from(keys));
}

export function routeIncusEventToStore(store: IncusStore, event: IncusEvent) {
  if (event.type === 'lifecycle') {
    applyLifecycleEvent(store, event);
    return;
  }

  if (event.type === 'operation') {
    applyOperationEvent(store, event);
  }
}
