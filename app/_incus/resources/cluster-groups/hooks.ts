'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import { deriveResourceStatus, resourceStatusFlags } from '../../status';
import type { ClusterGroup } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

export function useClusterGroupsResource() {
  const client = useIncusClient();
  const knownNames = Object.keys(client.store.getSnapshot().state.clusterGroups.items);
  const keys = React.useMemo(
    () => [
      resourceKeys.clusterGroupsCollection,
      ...knownNames.map(resourceKeys.clusterGroupMetadata),
    ],
    [knownNames.join('|')],
  );
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    keys,
  );
  const collection = snapshot.state.clusterGroups.collection;

  React.useEffect(() => {
    void client.clusterGroups.ensure();
  }, [client, collection.status, snapshot.version]);

  const data = Object.values(snapshot.state.clusterGroups.items)
    .map((item) => item.metadata.data)
    .filter((group): group is ClusterGroup => Boolean(group))
    .sort((a, b) => a.name.localeCompare(b.name));
  const status = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: data.length > 0,
    inFlight: hasInFlight(resourceKeys.clusterGroupsCollection),
  });
  const flags = resourceStatusFlags(status);

  return {
    data,
    error:
      collection.status === 'error'
        ? new Error(collection.error ?? 'Unable to load cluster groups.')
        : null,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}
