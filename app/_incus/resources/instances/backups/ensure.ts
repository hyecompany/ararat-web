'use client';

import { instanceKey } from '../../../keys';
import { resourceKeys } from '../../../resources';
import type { RequestRegistry } from '../../../requests';
import type { IncusStore } from '../../../store';
import { shouldFetchStoredStatus } from '../../../status';
import { requestJson } from '../../../transport';
import { requestOperation } from '../../../transport';
import type { InstanceBackup } from '../../../types';

export type InstanceBackupsRequest = {
  instanceName: string;
  project?: string | null;
};

export function backupIdentity(request: InstanceBackupsRequest) {
  const project = request.project ?? 'default';
  const key = instanceKey(project, request.instanceName);
  return {
    project,
    key,
    collectionKey: resourceKeys.instanceBackupsCollection(key),
  };
}

function backupShortName(name: string) {
  return name.split('/').filter(Boolean).pop() ?? name;
}

export async function ensureInstanceBackups(
  store: IncusStore,
  requests: RequestRegistry,
  request: InstanceBackupsRequest,
) {
  const { project, key, collectionKey } = backupIdentity(request);
  const collection =
    store.getSnapshot().state.instances.items[key]?.backups.collection ??
    { status: 'missing' as const };
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(`instance:backups:${key}`, [collectionKey], async () => {
    try {
      const response = await requestJson<InstanceBackup[]>(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/backups`,
        {
          params: {
            project,
            recursion: 1,
          },
        },
      );

      store.update((state) => {
        const instance = state.instances.items[key] ?? store.ensureInstance(key);
        instance.backups.collection = { status: 'ready' };
        instance.backups.items = {};
        for (const backup of response.metadata) {
          const name = backupShortName(backup.name);
          instance.backups.items[name] = {
            metadata: { status: 'ready', data: { ...backup, name } },
          };
        }
      }, [
        collectionKey,
        ...response.metadata.map((backup) =>
          resourceKeys.instanceBackupMetadata(key, backupShortName(backup.name)),
        ),
      ]);
    } catch (error) {
      store.update((state) => {
        const instance = state.instances.items[key] ?? store.ensureInstance(key);
        instance.backups.collection = {
          status: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to load instance backups.',
        };
      }, [collectionKey]);
    }
  });
}

export function markInstanceBackupsStale(
  store: IncusStore,
  request: InstanceBackupsRequest,
) {
  const { key, collectionKey } = backupIdentity(request);
  store.update((state) => {
    const instance = state.instances.items[key] ?? store.ensureInstance(key);
    instance.backups.collection = {
      status: Object.keys(instance.backups.items).length ? 'stale' : 'missing',
    };
  }, [collectionKey]);
}

export function createInstanceBackupsResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensure: (request: InstanceBackupsRequest) =>
      ensureInstanceBackups(store, requests, request),
    markStale: (request: InstanceBackupsRequest) =>
      markInstanceBackupsStale(store, request),
    create: async (
      request: InstanceBackupsRequest & {
        name?: string;
        instanceOnly?: boolean;
        optimizedStorage?: boolean;
        compressionAlgorithm?: string;
        expiresAt?: string;
      },
    ) => {
      const project = request.project ?? 'default';
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/backups`,
        {
          params: { project },
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: request.name || undefined,
              instance_only: request.instanceOnly,
              optimized_storage: request.optimizedStorage,
              compression_algorithm: request.compressionAlgorithm || undefined,
              expires_at: request.expiresAt ?? null,
            }),
          },
        },
      );
      markInstanceBackupsStale(store, request);
      return response;
    },
    delete: async (request: InstanceBackupsRequest & { backupName: string }) => {
      const project = request.project ?? 'default';
      const backupName = backupShortName(request.backupName);
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/backups/${encodeURIComponent(backupName)}`,
        {
          params: { project },
          init: { method: 'DELETE' },
        },
      );
      store.update((state) => {
        const instance = state.instances.items[backupIdentity(request).key];
        if (!instance) return;
        delete instance.backups.items[backupName];
        instance.backups.collection.status = 'stale';
      }, [
        backupIdentity(request).collectionKey,
        resourceKeys.instanceBackupMetadata(backupIdentity(request).key, backupName),
      ]);
      return response;
    },
    rename: async (
      request: InstanceBackupsRequest & { oldName: string; newName: string },
    ) => {
      const project = request.project ?? 'default';
      const oldName = backupShortName(request.oldName);
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/backups/${encodeURIComponent(oldName)}`,
        {
          params: { project },
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: request.newName }),
          },
        },
      );
      markInstanceBackupsStale(store, request);
      return response;
    },
    download: (request: InstanceBackupsRequest & { backupName: string }) => {
      const project = request.project ?? 'default';
      const backupName = backupShortName(request.backupName);
      const url = new URL(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/backups/${encodeURIComponent(backupName)}/export`,
        window.location.origin,
      );
      url.searchParams.set('project', project);
      const link = document.createElement('a');
      link.href = url.toString();
      link.download = `${backupName}.tar.gz`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
  };
}
