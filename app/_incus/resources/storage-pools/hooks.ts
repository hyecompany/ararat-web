'use client';

import React from 'react';
import { debugIncusData } from '@/app/_incus/debug';
import { useIncusClient } from '@/app/_incus/provider';
import type {
  ResourceStatus,
  ResourcesStoragePool,
  StoragePool,
  StorageVolume,
} from '@/app/_incus/types';
import type { UseStoragePoolsRequest } from './ensure';
import { resourceKeys } from '@/app/_incus/resources';
import {
  combineResourceStatuses,
  deriveResourceStatus,
  shouldFetchStoredStatus,
} from '@/app/_incus/status';
import { useIncusResourceSnapshot } from '@/app/_incus/use-resource-snapshot';
import {
  type IncusScopedStoreSnapshot,
  type IncusStoreSnapshot,
} from '@/app/_incus/store';
import { collectionStatusKey } from '@/app/_incus/scope';
import { splitStorageVolumeKey } from '@/app/_incus/keys';

export type StoragePoolRow = {
  name: string;
  metadata?: StoragePool;
  resources?: ResourcesStoragePool;
  metadataStatus: ResourceStatus;
  resourcesStatus: ResourceStatus;
};

export type StorageVolumeRow = {
  key: string;
  name: string;
  type: string;
  project: string;
  metadata?: StorageVolume;
  metadataStatus: ResourceStatus;
};

export type UseStoragePoolVolumesOptions = {
  project?: string | null;
  type?: string;
};

function visibleStatuses(
  snapshot: IncusScopedStoreSnapshot,
  request: UseStoragePoolsRequest,
) {
  const storagePools = snapshot.state.storagePools;
  const statuses = [storagePools.collection.status];

  const sortedNames = Object.keys(storagePools.items).sort((a, b) =>
    a.localeCompare(b),
  );
  const range = request.visibleRange;
  const overscan = range?.overscan ?? 0;
  const start = range ? Math.max(0, range.start - overscan) : 0;
  const end = range
    ? Math.min(sortedNames.length, range.start + range.count + overscan)
    : sortedNames.length;

  for (const name of sortedNames.slice(start, end)) {
    const item = storagePools.items[name];
    if (!item) continue;

    if (request.include?.metadata !== false) {
      statuses.push(item.metadata.status);
    }
    if (request.include?.resources === true) {
      statuses.push(item.resources.status);
    }
  }

  return statuses;
}

function hasVisibleWork(
  snapshot: IncusScopedStoreSnapshot,
  request: UseStoragePoolsRequest,
) {
  return visibleStatuses(snapshot, request).some(shouldFetchStoredStatus);
}

function visibleNamesFromState(
  snapshot: IncusStoreSnapshot,
  request: UseStoragePoolsRequest,
) {
  const sortedNames = Object.keys(snapshot.state.storagePools.items).sort((a, b) =>
    a.localeCompare(b),
  );
  const range = request.visibleRange;
  const overscan = range?.overscan ?? 0;
  const start = range ? Math.max(0, range.start - overscan) : 0;
  const end = range
    ? Math.min(sortedNames.length, range.start + range.count + overscan)
    : sortedNames.length;
  return sortedNames.slice(start, end);
}

function storagePoolSubscriptionKeys(
  snapshot: IncusStoreSnapshot,
  request: UseStoragePoolsRequest,
) {
  const keys = [resourceKeys.events, resourceKeys.storagePoolsCollection];
  for (const name of visibleNamesFromState(snapshot, request)) {
    if (request.include?.metadata !== false) {
      keys.push(resourceKeys.storagePoolMetadata(name));
    }
    if (request.include?.resources === true) {
      keys.push(resourceKeys.storagePoolResources(name));
    }
  }
  return keys;
}

export function useStoragePools(request: UseStoragePoolsRequest = {}) {
  const client = useIncusClient();
  const requestKey = JSON.stringify(request);
  const storeSnapshot = client.store.getSnapshot();
  const subscriptionKeys = React.useMemo(
    () => storagePoolSubscriptionKeys(storeSnapshot, request),
    [requestKey, storeSnapshot],
  );
  const subscriptionKey = subscriptionKeys.join('|');
  const {
    storeSnapshot: snapshot,
    requestSnapshot,
    hasInFlight,
  } = useIncusResourceSnapshot(
    client,
    subscriptionKeys,
  );

  React.useEffect(() => {
    const latestSnapshot =
      client.store.getSnapshotForKeys(subscriptionKeys);
    const hasWork = hasVisibleWork(latestSnapshot, request);
    const statuses = visibleStatuses(latestSnapshot, request);

    debugIncusData('storagePools.hook:status', {
      version: latestSnapshot.version,
      subscriptionKeys,
      events: latestSnapshot.state.events.status,
      collection: latestSnapshot.state.storagePools.collection.status,
      visibleStatuses: statuses,
      hasWork,
    });

    if (!hasWork) return;

    const visibleWorkIsOnlyStale =
      statuses
        .filter(shouldFetchStoredStatus)
        .every((status) => status === 'stale');
    const isOnlyDisconnectedStale =
      latestSnapshot.state.events.status === 'disconnected' &&
      visibleWorkIsOnlyStale;
    if (isOnlyDisconnectedStale) {
      debugIncusData('storagePools.hook:deferDisconnectedStale', {
        version: latestSnapshot.version,
      });
      return;
    }

    debugIncusData('storagePools.hook:ensure', {
      version: latestSnapshot.version,
      request,
    });
    void client.ensureStoragePools(request);
    // `requestKey` keeps this effect stable even when callers pass object literals.
    // Watching `snapshot.version` is what makes event-driven stale markings useful:
    // when an active row becomes stale, the hook asks the client to refresh that
    // visible requirement without throwing away the old row data.
  }, [client, requestKey, snapshot, snapshot.version, subscriptionKey]);

  return React.useMemo(() => {
    const storagePools = snapshot.state.storagePools;
    const sortedNames = Object.keys(storagePools.items).sort((a, b) =>
      a.localeCompare(b),
    );
    const range = request.visibleRange;
    const overscan = range?.overscan ?? 0;
    const start = range ? Math.max(0, range.start - overscan) : 0;
    const end = range
      ? Math.min(sortedNames.length, range.start + range.count + overscan)
      : sortedNames.length;

    const rows: StoragePoolRow[] = sortedNames.slice(start, end).map((name) => {
      const item = storagePools.items[name];
      const metadataKey = resourceKeys.storagePoolMetadata(name);
      const resourcesKey = resourceKeys.storagePoolResources(name);
      return {
        name,
        metadata: item.metadata.data,
        resources: item.resources.data,
        metadataStatus: deriveResourceStatus({
          storedStatus: item.metadata.status,
          hasData: item.metadata.data !== undefined,
          inFlight: hasInFlight(metadataKey),
        }),
        resourcesStatus: deriveResourceStatus({
          storedStatus: item.resources.status,
          hasData: item.resources.data !== undefined,
          inFlight: hasInFlight(resourcesKey),
        }),
      };
    });
    const collectionStatus = deriveResourceStatus({
      storedStatus: storagePools.collection.status,
      hasData: sortedNames.length > 0,
      inFlight: hasInFlight(resourceKeys.storagePoolsCollection),
    });

    return {
      rows,
      total: sortedNames.length,
      collectionStatus,
      status: combineResourceStatuses([
        collectionStatus,
        ...rows.map((row) => row.metadataStatus),
        ...(request.include?.resources
          ? rows.map((row) => row.resourcesStatus)
          : []),
      ]),
    };
  }, [
    hasInFlight,
    request.include?.resources,
    request.visibleRange,
    requestSnapshot.version,
    snapshot,
  ]);
}

export function useStoragePoolVolumes(
  poolName: string | null | undefined,
  options: UseStoragePoolVolumesOptions = {},
) {
  const client = useIncusClient();
  const selectedProject = options.project ?? client.getProject();
  const collectionKey = collectionStatusKey(selectedProject ?? 'default');
  const volumeType = options.type ?? 'custom';
  const storeKey = poolName
    ? resourceKeys.storagePoolVolumesCollection(poolName, collectionKey)
    : null;
  const storeSnapshot = client.store.getSnapshot();
  const knownVolumeKeys = React.useMemo(
    () =>
      poolName
        ? Object.keys(
            client.store.getSnapshot().state.storagePools.items[poolName]
              ?.volumes.items ?? {},
          ).filter((key) => {
            const identity = splitStorageVolumeKey(key);
            return (
              (collectionKey === 'all' || identity.project === collectionKey) &&
              identity.type === volumeType
            );
          })
        : [],
    [client, collectionKey, poolName, storeSnapshot.version, volumeType],
  );
  const knownVolumeSignature = knownVolumeKeys.join('|');
  const volumeMetadataKeys = React.useMemo(
    () =>
      poolName
        ? knownVolumeKeys.map((key) =>
            resourceKeys.storageVolumeMetadata(poolName, key),
          )
        : [],
    [knownVolumeSignature, poolName],
  );
  const subscriptionKeys = React.useMemo(
    () => (storeKey ? [storeKey, ...volumeMetadataKeys] : []),
    [storeKey, volumeMetadataKeys],
  );
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    subscriptionKeys,
  );
  const collection = poolName
    ? snapshot.state.storagePools.items[poolName]?.volumes.collection.byProject[
        collectionKey
      ] ?? snapshot.state.storagePools.items[poolName]?.volumes.collection.all
    : undefined;

  React.useEffect(() => {
    if (!poolName) return;
    void client.ensureStoragePoolVolumes(poolName, selectedProject ?? 'default');
  }, [client, poolName, selectedProject, collection?.status, snapshot.version]);

  return React.useMemo(() => {
    const volumeItems = poolName
      ? snapshot.state.storagePools.items[poolName]?.volumes.items ?? {}
      : {};
    const rows = Object.entries(volumeItems)
      .map(([key, item]) => {
        const identity = splitStorageVolumeKey(key);
        return {
          key,
          item,
          ...identity,
        };
      })
      .filter(
        (row) =>
          (collectionKey === 'all' || row.project === collectionKey) &&
          row.type === volumeType,
      )
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ key, name, type, project, item }): StorageVolumeRow => {
        const metadataKey = poolName
          ? resourceKeys.storageVolumeMetadata(poolName, key)
          : '';
        return {
          key,
          name,
          type,
          project,
          metadata: item.metadata.data,
          metadataStatus: deriveResourceStatus({
            storedStatus: item.metadata.status,
            hasData: item.metadata.data !== undefined,
            inFlight: poolName ? hasInFlight(metadataKey) : false,
          }),
        };
      });
    const collectionStatus = deriveResourceStatus({
      storedStatus: collection?.status ?? 'missing',
      hasData: rows.length > 0,
      inFlight: storeKey ? hasInFlight(storeKey) : false,
    });

    return {
      rows,
      total: rows.length,
      collectionStatus,
      status: combineResourceStatuses([
        collectionStatus,
        ...rows.map((row) => row.metadataStatus),
      ]),
      error:
        collection?.status === 'error'
          ? new Error(collection.error ?? 'Unable to load storage volumes.')
          : null,
    };
  }, [
    collection?.error,
    collection?.status,
    collectionKey,
    hasInFlight,
    poolName,
    snapshot,
    storeKey,
    volumeType,
  ]);
}
