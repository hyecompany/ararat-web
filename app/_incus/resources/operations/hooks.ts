'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import {
  combineResourceStatuses,
  deriveResourceStatus,
  resourceStatusFlags,
  shouldFetchStoredStatus,
} from '../../status';
import type { IncusOperation } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';
import { sortedOperations } from './ensure';

export type UseOperationsRequest = {
  visibleRange?: {
    start: number;
    count: number;
    overscan?: number;
  };
};

export function useOperations(request: UseOperationsRequest = {}) {
  const client = useIncusClient();
  const knownIds = Object.keys(client.store.getSnapshot().state.operations.items);
  const knownSignature = knownIds.join('|');
  const subscriptionKeys = React.useMemo(
    () => [
      resourceKeys.operationsCollection,
      ...knownIds.map(resourceKeys.operationMetadata),
    ],
    [knownSignature],
  );

  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    subscriptionKeys,
  );
  const collection = snapshot.state.operations.collection;

  React.useEffect(() => {
    if (!shouldFetchStoredStatus(collection.status)) return;
    void client.operations.ensureList();
  }, [client, collection.status]);

  const items = React.useMemo(
    () =>
      sortedOperations(
        Object.values(snapshot.state.operations.items)
          .map((item) => item.metadata.data)
          .filter((operation): operation is IncusOperation => Boolean(operation)),
      ),
    [snapshot],
  );

  const range = request.visibleRange;
  const visibleItems = React.useMemo(() => {
    if (!range) return items;
    const overscan = range.overscan ?? 0;
    const start = Math.max(0, range.start - overscan);
    const end = Math.min(items.length, range.start + range.count + overscan);
    return items.slice(start, end);
  }, [items, range?.start, range?.count, range?.overscan]);

  const collectionStatus = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: items.length > 0,
    inFlight: hasInFlight(resourceKeys.operationsCollection),
  });
  const visibleStatuses = visibleItems.map((operation) => {
    const item = snapshot.state.operations.items[operation.id];
    return deriveResourceStatus({
      storedStatus: item?.metadata.status ?? 'missing',
      hasData: item?.metadata.data !== undefined,
      inFlight: hasInFlight(resourceKeys.operationMetadata(operation.id)),
    });
  });
  const status = combineResourceStatuses([collectionStatus, ...visibleStatuses]);
  const flags = resourceStatusFlags(status);

  return {
    items,
    status,
    error:
      collection.status === 'error'
        ? new Error(collection.error ?? 'Unable to load operations.')
        : null,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
    cancel: client.operations.cancel,
  };
}
