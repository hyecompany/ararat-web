'use client';

import { instanceKey } from '../../../keys';
import { resourceKeys } from '../../../resources';
import type { RequestRegistry } from '../../../requests';
import type { IncusStore } from '../../../store';
import { shouldFetchStoredStatus } from '../../../status';
import { requestJson, requestOperation } from '../../../transport';
import type { InstanceSnapshot } from '../../../types';

export type InstanceSnapshotsRequest = {
  instanceName: string;
  project?: string | null;
};

function snapshotShortName(name: string) {
  return name.split('/').filter(Boolean).pop() ?? name;
}

function snapshotSourceName(instanceName: string, snapshotName: string) {
  return `${instanceName}/${snapshotShortName(snapshotName)}`;
}

export function snapshotIdentity(request: InstanceSnapshotsRequest) {
  const project = request.project ?? 'default';
  const key = instanceKey(project, request.instanceName);
  return {
    project,
    key,
    collectionKey: resourceKeys.instanceSnapshotsCollection(key),
  };
}

export async function ensureInstanceSnapshots(
  store: IncusStore,
  requests: RequestRegistry,
  request: InstanceSnapshotsRequest,
) {
  const { project, key, collectionKey } = snapshotIdentity(request);
  const collection =
    store.getSnapshot().state.instances.items[key]?.snapshots.collection ??
    { status: 'missing' as const };
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(`instance:snapshots:${key}`, [collectionKey], async () => {
    try {
      const response = await requestJson<InstanceSnapshot[]>(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/snapshots`,
        {
          params: {
            project,
            recursion: 1,
          },
        },
      );

      store.update((state) => {
        const instance = state.instances.items[key] ?? store.ensureInstance(key);
        instance.snapshots.collection = { status: 'ready' };
        instance.snapshots.items = {};
        for (const snapshot of response.metadata) {
          instance.snapshots.items[snapshot.name] = {
            metadata: { status: 'ready', data: snapshot },
          };
        }
      }, [
        collectionKey,
        ...response.metadata.map((snapshot) =>
          resourceKeys.instanceSnapshotMetadata(key, snapshot.name),
        ),
      ]);
    } catch (error) {
      store.update((state) => {
        const instance = state.instances.items[key] ?? store.ensureInstance(key);
        instance.snapshots.collection = {
          status: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to load instance snapshots.',
        };
      }, [collectionKey]);
    }
  });
}

export function markInstanceSnapshotsStale(
  store: IncusStore,
  request: InstanceSnapshotsRequest,
) {
  const { key, collectionKey } = snapshotIdentity(request);
  store.update((state) => {
    const instance = state.instances.items[key] ?? store.ensureInstance(key);
    instance.snapshots.collection = {
      status: Object.keys(instance.snapshots.items).length ? 'stale' : 'missing',
    };
  }, [collectionKey]);
}

export function createInstanceSnapshotsResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensure: (request: InstanceSnapshotsRequest) =>
      ensureInstanceSnapshots(store, requests, request),
    markStale: (request: InstanceSnapshotsRequest) =>
      markInstanceSnapshotsStale(store, request),
    create: async (
      request: InstanceSnapshotsRequest & {
        name?: string;
        stateful?: boolean;
        expiresAt?: string;
      },
    ) => {
      const { project } = snapshotIdentity(request);
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/snapshots`,
        {
          params: { project },
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: request.name || undefined,
              stateful: request.stateful,
              expires_at: request.expiresAt,
            }),
          },
        },
      );
      markInstanceSnapshotsStale(store, request);
      return response;
    },
    delete: async (request: InstanceSnapshotsRequest & { snapshotName: string }) => {
      const { project, key, collectionKey } = snapshotIdentity(request);
      const snapshotName = snapshotShortName(request.snapshotName);
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/snapshots/${encodeURIComponent(snapshotName)}`,
        {
          params: { project },
          init: { method: 'DELETE' },
        },
      );
      store.update((state) => {
        const instance = state.instances.items[key];
        if (!instance) return;
        delete instance.snapshots.items[snapshotName];
        instance.snapshots.collection.status = 'stale';
      }, [
        collectionKey,
        resourceKeys.instanceSnapshotMetadata(key, snapshotName),
      ]);
      return response;
    },
    restore: async (
      request: InstanceSnapshotsRequest & { snapshotName: string },
    ) => {
      const { project } = snapshotIdentity(request);
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}`,
        {
          params: { project },
          init: {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ restore: snapshotShortName(request.snapshotName) }),
          },
        },
      );
      markInstanceSnapshotsStale(store, request);
      return response;
    },
    edit: async (
      request: InstanceSnapshotsRequest & {
        snapshotName: string;
        newName: string;
        expiresAt?: string;
      },
    ) => {
      const { project } = snapshotIdentity(request);
      const snapshotName = snapshotShortName(request.snapshotName);
      const normalizedName = request.newName.trim();
      if (!normalizedName) throw new Error('Snapshot name is required.');
      if (normalizedName !== snapshotName) {
        await requestOperation(
          `/1.0/instances/${encodeURIComponent(request.instanceName)}/snapshots/${encodeURIComponent(snapshotName)}`,
          {
            params: { project },
            init: {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: normalizedName }),
            },
          },
        );
      }
      const finalName = normalizedName || snapshotName;
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/snapshots/${encodeURIComponent(finalName)}`,
        {
          params: { project },
          init: {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expires_at: request.expiresAt ?? null }),
          },
        },
      );
      markInstanceSnapshotsStale(store, request);
      return response;
    },
    createInstance: async (
      request: InstanceSnapshotsRequest & {
        snapshotName: string;
        targetName: string;
        instanceType: string;
      },
    ) => {
      const { project } = snapshotIdentity(request);
      return requestOperation('/1.0/instances', {
        params: { project },
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: request.targetName.trim(),
            type: request.instanceType,
            source: {
              type: 'copy',
              source: snapshotSourceName(request.instanceName, request.snapshotName),
              project,
            },
          }),
        },
      });
    },
    createImage: async (
      request: InstanceSnapshotsRequest & {
        snapshotName: string;
        alias?: string;
      },
    ) => {
      const { project } = snapshotIdentity(request);
      return requestOperation('/1.0/images', {
        params: { project },
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aliases: request.alias?.trim()
              ? [{ name: request.alias.trim() }]
              : undefined,
            source: {
              type: 'snapshot',
              name: snapshotSourceName(request.instanceName, request.snapshotName),
              project,
            },
          }),
        },
      });
    },
  };
}
