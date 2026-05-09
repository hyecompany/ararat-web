'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import {
  deriveResourceStatus,
  resourceStatusFlags,
} from '../../status';
import type { Project } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

export function useProjectsResource() {
  const client = useIncusClient();
  const keys = React.useMemo(() => [resourceKeys.projectsCollection], []);

  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    keys,
  );

  React.useEffect(() => {
    void client.projects.ensure();
  }, [client, snapshot.version]);

  return React.useMemo(() => {
    const collection = snapshot.state.projects.collection;
    const data = Object.values(snapshot.state.projects.items)
      .map((item) => item.metadata.data)
      .filter((project): project is Project => Boolean(project))
      .sort((a, b) => a.name.localeCompare(b.name));
    const status = deriveResourceStatus({
      storedStatus: collection.status,
      hasData: data.length > 0,
      inFlight: hasInFlight(resourceKeys.projectsCollection),
    });
    const flags = resourceStatusFlags(status);

    return {
      data,
      error: collection.status === 'error' ? new Error(collection.error ?? '') : null,
      status,
      isLoading: flags.isLoading,
      isStale: flags.isStale,
      isRefreshing: flags.isRefreshing,
    };
  }, [hasInFlight, snapshot]);
}
