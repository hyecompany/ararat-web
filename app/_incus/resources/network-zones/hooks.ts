'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import { deriveResourceStatus, resourceStatusFlags } from '../../status';
import type { NetworkZone } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

export function useNetworkZonesResource() {
  const client = useIncusClient();
  const knownNames = Object.keys(client.store.getSnapshot().state.networkZones.items);
  const keys = React.useMemo(
    () => [
      resourceKeys.networkZonesCollection,
      ...knownNames.map(resourceKeys.networkZoneMetadata),
    ],
    [knownNames.join('|')],
  );
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    keys,
  );
  const collection = snapshot.state.networkZones.collection;

  React.useEffect(() => {
    void client.networkZones.ensure();
  }, [client, collection.status, snapshot.version]);

  const data = Object.values(snapshot.state.networkZones.items)
    .map((item) => item.metadata.data)
    .filter((zone): zone is NetworkZone => Boolean(zone))
    .sort((a, b) => a.name.localeCompare(b.name));
  const status = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: data.length > 0,
    inFlight: hasInFlight(resourceKeys.networkZonesCollection),
  });
  const flags = resourceStatusFlags(status);

  return {
    data,
    error:
      collection.status === 'error'
        ? new Error(collection.error ?? 'Unable to load network zones.')
        : null,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}
