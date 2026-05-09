'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import {
  collectionStatusKey,
  resolveProjectResourceScope,
  type IncusProjectSelection,
} from '../../scope';
import { deriveResourceStatus, resourceStatusFlags } from '../../status';
import type { Network } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

export function useNetworksResource(project?: string | null) {
  const client = useIncusClient();
  const selectedProject: IncusProjectSelection =
    project === undefined ? client.getProject() : project ?? 'default';
  const projectKeys = React.useMemo(() => {
    const keys = [resourceKeys.projectsCollection];
    if (selectedProject !== 'all' && selectedProject !== 'default') {
      keys.push(resourceKeys.projectMetadata(selectedProject));
    }
    return keys;
  }, [selectedProject]);
  const collectionKey = collectionStatusKey(
    resolveProjectResourceScope(
      client.store.getSnapshotForKeys(projectKeys).state,
      selectedProject,
      'networks',
    ),
  );
  const knownKeys = Object.keys(client.store.getSnapshot().state.networks.items);
  const subscriptionKeys = React.useMemo(
    () => [
      ...projectKeys,
      resourceKeys.networksCollection(collectionKey),
      ...knownKeys.map(resourceKeys.networkMetadata),
    ],
    [collectionKey, knownKeys.join('|'), projectKeys.join('|')],
  );
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    subscriptionKeys,
  );
  const collection =
    snapshot.state.networks.collection.byProject[collectionKey] ??
    snapshot.state.networks.collection.all;

  React.useEffect(() => {
    void client.networks.ensure(selectedProject);
  }, [client, selectedProject, collection.status, snapshot.version]);

  const data = Object.values(snapshot.state.networks.items)
    .map((item) => item.metadata.data)
    .filter((network): network is Network => Boolean(network))
    .filter((network) => {
      if (collectionKey === 'all') return true;
      return (network.project ?? collectionKey) === collectionKey;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const status = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: data.length > 0,
    inFlight: hasInFlight(resourceKeys.networksCollection(collectionKey)),
  });
  const flags = resourceStatusFlags(status);

  const mutate = React.useCallback(async () => {
    client.store.update((state) => {
      const current = state.networks.collection.byProject[collectionKey];
      state.networks.collection.byProject[collectionKey] = {
        status: current?.status === 'missing' ? 'missing' : 'stale',
      };
    }, [resourceKeys.networksCollection(collectionKey)]);
    await client.networks.ensure(selectedProject);
  }, [client, collectionKey, selectedProject]);

  return {
    data,
    error:
      collection.status === 'error'
        ? new Error(collection.error ?? 'Unable to load networks.')
        : null,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
    mutate,
  };
}
