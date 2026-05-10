'use client';

import {
  imageKey,
  instanceKey,
  networkKey,
  profileKey,
  storageBucketKey,
  storageVolumeKey,
} from './keys';

export type IncusStoreKey = string;

function normalizeResourcePath(path: string) {
  const trimmed = path.trim();
  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const collapsed = prefixed.replace(/\/+/g, '/');
  return collapsed.length > 1 && collapsed.endsWith('/')
    ? collapsed.slice(0, -1)
    : collapsed;
}

export function parentResourcePath(path: string) {
  const normalized = normalizeResourcePath(path);
  if (normalized === '/') return '/';
  return normalized.substring(0, normalized.lastIndexOf('/')) || '/';
}

export const resourceKeys = {
  events: 'events',
  serverConfiguration: 'server:configuration',
  configurableOptions: 'server:configurable-options',
  serverResources: 'server:resources',
  certificateMetadata: (fingerprint: string) =>
    `certificates:${fingerprint}:metadata`,
  imagesCollection: (project: string) => `images:${project}:collection`,
  imageMetadata: (key: string) => `images:${key}:metadata`,
  networksCollection: (project: string) => `networks:${project}:collection`,
  networkMetadata: (key: string) => `networks:${key}:metadata`,
  networkZonesCollection: 'networkZones:collection',
  networkZoneMetadata: (name: string) => `networkZones:${name}:metadata`,
  networkIntegrationsCollection: 'networkIntegrations:collection',
  networkIntegrationMetadata: (name: string) =>
    `networkIntegrations:${name}:metadata`,
  clusterGroupsCollection: 'clusterGroups:collection',
  clusterGroupMetadata: (name: string) => `clusterGroups:${name}:metadata`,
  projectsCollection: 'projects:collection',
  projectMetadata: (name: string) => `projects:${name}:metadata`,
  profilesCollection: (project: string) => `profiles:${project}:collection`,
  profileMetadata: (key: string) => `profiles:${key}:metadata`,
  operationsCollection: 'operations:collection',
  operationMetadata: (id: string) => `operations:${id}:metadata`,
  storagePoolsCollection: 'storagePools:collection',
  storagePoolMetadata: (name: string) => `storagePools:${name}:metadata`,
  storagePoolResources: (name: string) => `storagePools:${name}:resources`,
  storagePoolVolumesCollection: (pool: string, project: string) =>
    `storagePools:${pool}:volumes:${project}:collection`,
  storagePoolBucketsCollection: (pool: string, project: string) =>
    `storagePools:${pool}:buckets:${project}:collection`,
  storageVolumeMetadata: (pool: string, key: string) =>
    `storagePools:${pool}:volumes:${key}:metadata`,
  storageVolumeState: (pool: string, key: string) =>
    `storagePools:${pool}:volumes:${key}:state`,
  storageBucketMetadata: (pool: string, key: string) =>
    `storagePools:${pool}:buckets:${key}:metadata`,
  instancesCollection: (project: string) => `instances:${project}:collection`,
  instanceMetadata: (key: string) => `instances:${key}:metadata`,
  instanceState: (key: string) => `instances:${key}:state`,
  instanceAccess: (key: string) => `instances:${key}:access`,
  instanceBackupsCollection: (key: string) => `instances:${key}:backups:collection`,
  instanceBackupMetadata: (key: string, backup: string) =>
    `instances:${key}:backups:${backup}:metadata`,
  instanceSnapshotsCollection: (key: string) => `instances:${key}:snapshots:collection`,
  instanceSnapshotMetadata: (key: string, snapshot: string) =>
    `instances:${key}:snapshots:${snapshot}:metadata`,
  instanceLogsCollection: (key: string) => `instances:${key}:logs:collection`,
  instanceLogMetadata: (key: string, log: string) =>
    `instances:${key}:logs:${log}:metadata`,
  instanceLogContent: (key: string, log: string) =>
    `instances:${key}:logs:${log}:content`,
  instanceFileMetadata: (key: string, path: string) =>
    `instances:${key}:files:${path}:metadata`,
  instanceFileChildren: (key: string, path: string) =>
    `instances:${key}:files:${path}:children`,
  instanceFileContent: (key: string, path: string) =>
    `instances:${key}:files:${path}:content`,
};

export type IncusResourceRef =
  | { kind: 'projectsCollection' }
  | { kind: 'project'; name: string }
  | { kind: 'profilesCollection'; project: string }
  | { kind: 'profile'; project: string; name: string; key: string }
  | { kind: 'operationsCollection' }
  | { kind: 'operation'; id: string }
  | { kind: 'certificate'; fingerprint: string }
  | { kind: 'imagesCollection'; project: string }
  | { kind: 'image'; project: string; fingerprint: string; key: string }
  | { kind: 'networksCollection'; project: string }
  | { kind: 'network'; project: string; name: string; key: string }
  | { kind: 'networkZonesCollection' }
  | { kind: 'networkZone'; name: string }
  | { kind: 'networkIntegrationsCollection' }
  | { kind: 'networkIntegration'; name: string }
  | { kind: 'clusterGroupsCollection' }
  | { kind: 'clusterGroup'; name: string }
  | { kind: 'storagePoolsCollection' }
  | { kind: 'storagePool'; pool: string }
  | { kind: 'storagePoolResources'; pool: string }
  | { kind: 'storageVolumesCollection'; pool: string; project: string }
  | {
      kind: 'storageVolume';
      pool: string;
      project: string;
      volumeType: string;
      name: string;
    }
  | { kind: 'storageBucketsCollection'; pool: string; project: string }
  | {
      kind: 'storageBucket';
      pool: string;
      project: string;
      name: string;
    }
  | { kind: 'instancesCollection'; project: string }
  | { kind: 'instance'; project: string; name: string; key: string }
  | { kind: 'instanceState'; project: string; name: string; key: string }
  | {
      kind: 'instanceFile';
      project: string;
      name: string;
      key: string;
      path: string;
    }
  | { kind: 'instanceBackupsCollection'; project: string; name: string; key: string }
  | {
      kind: 'instanceBackup';
      project: string;
      name: string;
      key: string;
      backup: string;
    }
  | { kind: 'instanceSnapshotsCollection'; project: string; name: string; key: string }
  | {
      kind: 'instanceSnapshot';
      project: string;
      name: string;
      key: string;
      snapshot: string;
    };

function pathnameAndParams(value: unknown) {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value, window.location.origin);
    return {
      pathname: url.pathname,
      params: url.searchParams,
    };
  } catch {
    const [pathname = '', search = ''] = value.split('?');
    return {
      pathname,
      params: new URLSearchParams(search),
    };
  }
}

function projectFrom(params: URLSearchParams, eventProject?: string) {
  return params.get('project') ?? eventProject ?? 'default';
}

// Incus lifecycle and operation events point at REST paths such as
// `/1.0/instances/c1?project=demo`. This parser is the one place where those
// paths become app-level resource identities, so the fetcher and websocket router
// cannot accidentally disagree about where an object lives in the normalized
// client store.
export function parseIncusResourcePath(
  value: unknown,
  eventProject?: string,
): IncusResourceRef | null {
  const parsed = pathnameAndParams(value);
  if (!parsed) return null;

  const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (segments[0] !== '1.0') return null;

  if (segments[1] === 'projects') {
    if (!segments[2]) return { kind: 'projectsCollection' };
    return { kind: 'project', name: segments[2] };
  }

  if (segments[1] === 'profiles') {
    const project = projectFrom(parsed.params, eventProject);
    if (!segments[2]) return { kind: 'profilesCollection', project };
    const name = segments[2];
    return { kind: 'profile', project, name, key: profileKey(project, name) };
  }

  if (segments[1] === 'operations') {
    if (!segments[2]) return { kind: 'operationsCollection' };
    return { kind: 'operation', id: segments[2] };
  }

  if (segments[1] === 'certificates') {
    if (!segments[2]) return null;
    return { kind: 'certificate', fingerprint: segments[2] };
  }

  if (segments[1] === 'images') {
    const project = projectFrom(parsed.params, eventProject);
    if (!segments[2]) return { kind: 'imagesCollection', project };
    return {
      kind: 'image',
      project,
      fingerprint: segments[2],
      key: imageKey(project, segments[2]),
    };
  }

  if (segments[1] === 'networks') {
    const project = projectFrom(parsed.params, eventProject);
    if (!segments[2]) return { kind: 'networksCollection', project };
    return {
      kind: 'network',
      project,
      name: segments[2],
      key: networkKey(project, segments[2]),
    };
  }

  if (segments[1] === 'network-zones') {
    if (!segments[2]) return { kind: 'networkZonesCollection' };
    return { kind: 'networkZone', name: segments[2] };
  }

  if (segments[1] === 'network-integrations') {
    if (!segments[2]) return { kind: 'networkIntegrationsCollection' };
    return { kind: 'networkIntegration', name: segments[2] };
  }

  if (segments[1] === 'cluster' && segments[2] === 'groups') {
    if (!segments[3]) return { kind: 'clusterGroupsCollection' };
    return { kind: 'clusterGroup', name: segments[3] };
  }

  if (segments[1] === 'storage-pools') {
    if (!segments[2]) return { kind: 'storagePoolsCollection' };

    const pool = segments[2];
    if (segments[3] === 'resources') {
      return { kind: 'storagePoolResources', pool };
    }

    if (segments[3] === 'volumes') {
      const project = projectFrom(parsed.params, eventProject);
      if (!segments[4]) {
        return { kind: 'storageVolumesCollection', pool, project };
      }
      if (!segments[5]) return null;
      return {
        kind: 'storageVolume',
        pool,
        project,
        volumeType: segments[4],
        name: segments[5],
      };
    }

    if (segments[3] === 'buckets') {
      const project = projectFrom(parsed.params, eventProject);
      if (!segments[4]) {
        return { kind: 'storageBucketsCollection', pool, project };
      }
      return { kind: 'storageBucket', pool, project, name: segments[4] };
    }

    return { kind: 'storagePool', pool };
  }

  if (segments[1] === 'instances') {
    const project = projectFrom(parsed.params, eventProject);
    if (!segments[2]) return { kind: 'instancesCollection', project };

    const name = segments[2];
    const key = instanceKey(project, name);
    if (segments[3] === 'state') {
      return { kind: 'instanceState', project, name, key };
    }
    if (segments[3] === 'files') {
      const filePath = parsed.params.get('path');
      if (!filePath) return { kind: 'instance', project, name, key };
      return {
        kind: 'instanceFile',
        project,
        name,
        key,
        path: normalizeResourcePath(filePath),
      };
    }
    if (segments[3] === 'backups') {
      if (!segments[4]) {
        return { kind: 'instanceBackupsCollection', project, name, key };
      }
      return { kind: 'instanceBackup', project, name, key, backup: segments[4] };
    }
    if (segments[3] === 'snapshots') {
      if (!segments[4]) {
        return { kind: 'instanceSnapshotsCollection', project, name, key };
      }
      return {
        kind: 'instanceSnapshot',
        project,
        name,
        key,
        snapshot: segments[4],
      };
    }

    return { kind: 'instance', project, name, key };
  }

  return null;
}

export function keysForResource(resource: IncusResourceRef | null): IncusStoreKey[] {
  if (!resource) return [];

  switch (resource.kind) {
    case 'projectsCollection':
      return [resourceKeys.projectsCollection];
    case 'project':
      return [
        resourceKeys.projectsCollection,
        resourceKeys.projectMetadata(resource.name),
      ];
    case 'profilesCollection':
      return [resourceKeys.profilesCollection(resource.project)];
    case 'profile':
      return [
        resourceKeys.profilesCollection(resource.project),
        resourceKeys.profileMetadata(resource.key),
      ];
    case 'operationsCollection':
      return [resourceKeys.operationsCollection];
    case 'operation':
      return [
        resourceKeys.operationsCollection,
        resourceKeys.operationMetadata(resource.id),
      ];
    case 'certificate':
      return [resourceKeys.certificateMetadata(resource.fingerprint)];
    case 'imagesCollection':
      return [resourceKeys.imagesCollection(resource.project)];
    case 'image':
      return [
        resourceKeys.imagesCollection(resource.project),
        resourceKeys.imageMetadata(resource.key),
      ];
    case 'networksCollection':
      return [resourceKeys.networksCollection(resource.project)];
    case 'network':
      return [
        resourceKeys.networksCollection(resource.project),
        resourceKeys.networkMetadata(resource.key),
      ];
    case 'networkZonesCollection':
      return [resourceKeys.networkZonesCollection];
    case 'networkZone':
      return [
        resourceKeys.networkZonesCollection,
        resourceKeys.networkZoneMetadata(resource.name),
      ];
    case 'networkIntegrationsCollection':
      return [resourceKeys.networkIntegrationsCollection];
    case 'networkIntegration':
      return [
        resourceKeys.networkIntegrationsCollection,
        resourceKeys.networkIntegrationMetadata(resource.name),
      ];
    case 'clusterGroupsCollection':
      return [resourceKeys.clusterGroupsCollection];
    case 'clusterGroup':
      return [
        resourceKeys.clusterGroupsCollection,
        resourceKeys.clusterGroupMetadata(resource.name),
      ];
    case 'storagePoolsCollection':
      return [resourceKeys.storagePoolsCollection];
    case 'storagePool':
      return [
        resourceKeys.storagePoolsCollection,
        resourceKeys.storagePoolMetadata(resource.pool),
        resourceKeys.storagePoolResources(resource.pool),
      ];
    case 'storagePoolResources':
      return [resourceKeys.storagePoolResources(resource.pool)];
    case 'storageVolumesCollection':
      return [
        resourceKeys.storagePoolVolumesCollection(resource.pool, resource.project),
      ];
    case 'storageVolume': {
      const key = storageVolumeKey(
        resource.project,
        resource.volumeType,
        resource.name,
      );
      return [
        resourceKeys.storagePoolVolumesCollection(resource.pool, resource.project),
        resourceKeys.storageVolumeMetadata(resource.pool, key),
        resourceKeys.storageVolumeState(resource.pool, key),
      ];
    }
    case 'storageBucketsCollection':
      return [
        resourceKeys.storagePoolBucketsCollection(resource.pool, resource.project),
      ];
    case 'storageBucket': {
      const key = storageBucketKey(resource.project, resource.name);
      return [
        resourceKeys.storagePoolBucketsCollection(resource.pool, resource.project),
        resourceKeys.storageBucketMetadata(resource.pool, key),
      ];
    }
    case 'instancesCollection':
      return [resourceKeys.instancesCollection(resource.project)];
    case 'instance':
      return [
        resourceKeys.instancesCollection(resource.project),
        resourceKeys.instanceMetadata(resource.key),
        resourceKeys.instanceState(resource.key),
        resourceKeys.instanceAccess(resource.key),
      ];
    case 'instanceState':
      return [resourceKeys.instanceState(resource.key)];
    case 'instanceFile':
      return [
        resourceKeys.instanceFileChildren(
          resource.key,
          parentResourcePath(resource.path),
        ),
        resourceKeys.instanceFileMetadata(resource.key, resource.path),
        resourceKeys.instanceFileChildren(resource.key, resource.path),
        resourceKeys.instanceFileContent(resource.key, resource.path),
      ];
    case 'instanceBackupsCollection':
      return [resourceKeys.instanceBackupsCollection(resource.key)];
    case 'instanceBackup':
      return [
        resourceKeys.instanceBackupsCollection(resource.key),
        resourceKeys.instanceBackupMetadata(resource.key, resource.backup),
      ];
    case 'instanceSnapshotsCollection':
      return [resourceKeys.instanceSnapshotsCollection(resource.key)];
    case 'instanceSnapshot':
      return [
        resourceKeys.instanceSnapshotsCollection(resource.key),
        resourceKeys.instanceSnapshotMetadata(resource.key, resource.snapshot),
      ];
  }
}
