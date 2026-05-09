'use client';

import React from 'react';
import { debugIncusData } from '@/app/_incus/debug';
import { useIncusClient } from '@/app/_incus/provider';
import type {
  ResourceStatus,
  ResourcesStoragePool,
  StoragePool,
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

export type StoragePoolRow = {
  name: string;
  metadata?: StoragePool;
  resources?: ResourcesStoragePool;
  metadataStatus: ResourceStatus;
  resourcesStatus: ResourceStatus;
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
