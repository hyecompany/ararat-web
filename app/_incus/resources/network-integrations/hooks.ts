'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import { deriveResourceStatus, resourceStatusFlags } from '../../status';
import type { NetworkIntegration } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

export function useNetworkIntegrationsResource() {
  const client = useIncusClient();
  const knownNames = Object.keys(
    client.store.getSnapshot().state.networkIntegrations.items,
  );
  const keys = React.useMemo(
    () => [
      resourceKeys.networkIntegrationsCollection,
      ...knownNames.map(resourceKeys.networkIntegrationMetadata),
    ],
    [knownNames.join('|')],
  );
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    keys,
  );
  const collection = snapshot.state.networkIntegrations.collection;

  React.useEffect(() => {
    void client.networkIntegrations.ensure();
  }, [client, collection.status, snapshot.version]);

  const data = Object.values(snapshot.state.networkIntegrations.items)
    .map((item) => item.metadata.data)
    .filter((integration): integration is NetworkIntegration => Boolean(integration))
    .sort((a, b) => a.name.localeCompare(b.name));
  const status = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: data.length > 0,
    inFlight: hasInFlight(resourceKeys.networkIntegrationsCollection),
  });
  const flags = resourceStatusFlags(status);

  return {
    data,
    error:
      collection.status === 'error'
        ? new Error(collection.error ?? 'Unable to load network integrations.')
        : null,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}
