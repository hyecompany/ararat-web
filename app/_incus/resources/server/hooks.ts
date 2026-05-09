'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import type { IncusScopedStoreSnapshot, IncusStoreSnapshot } from '../../store';
import { deriveResourceStatus, resourceStatusFlags } from '../../status';
import type { Cached, ConfigurableOptions, ResourcesMetadata, Server } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

function useServerCachedValue<T>(
  key: string,
  select: (snapshot: IncusScopedStoreSnapshot | IncusStoreSnapshot) => Cached<T>,
  ensure: () => Promise<void>,
) {
  const client = useIncusClient();
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    [key],
  );
  const cached = select(snapshot);

  React.useEffect(() => {
    void ensure();
  }, [ensure, snapshot.version]);

  const status = deriveResourceStatus({
    storedStatus: cached.status,
    hasData: cached.data !== undefined,
    inFlight: hasInFlight(key),
  });
  const flags = resourceStatusFlags(status);

  return {
    data: cached.data,
    error:
      cached.status === 'error'
        ? new Error(cached.error ?? 'Unable to load Incus data.')
        : null,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}

export function useServerConfigurationResource() {
  const client = useIncusClient();
  return useServerCachedValue<Server>(
    resourceKeys.serverConfiguration,
    (snapshot) => snapshot.state.server.configuration,
    React.useCallback(() => client.server.ensureConfiguration(), [client]),
  );
}

export function useConfigurableOptionsResource() {
  const client = useIncusClient();
  return useServerCachedValue<ConfigurableOptions>(
    resourceKeys.configurableOptions,
    (snapshot) => snapshot.state.server.configurableOptions,
    React.useCallback(() => client.server.ensureConfigurableOptions(), [client]),
  );
}

export function useServerResourcesResource() {
  const client = useIncusClient();
  return useServerCachedValue<ResourcesMetadata>(
    resourceKeys.serverResources,
    (snapshot) => snapshot.state.server.resources,
    React.useCallback(() => client.server.ensureResources(), [client]),
  );
}
