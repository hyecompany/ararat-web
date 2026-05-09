'use client';

import React from 'react';
import { useIncusClient } from '../../../provider';
import { resourceKeys } from '../../../resources';
import {
  deriveResourceStatus,
  resourceStatusFlags,
} from '../../../status';
import { useIncusResourceSnapshot } from '../../../use-resource-snapshot';
import { logIdentity } from './ensure';

export function useInstanceLogs(
  instanceName: string,
  project?: string | null,
) {
  const client = useIncusClient();
  const { key, collectionKey } = logIdentity({ instanceName, project });
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    [collectionKey],
  );
  const item = snapshot.state.instances.items[key];
  const collection = item?.logs.collection ?? { status: 'missing' as const };
  const data = Object.keys(item?.logs.items ?? {}).sort((a, b) =>
    a.localeCompare(b),
  );

  React.useEffect(() => {
    void client.instanceLogs.ensure({ instanceName, project });
  }, [client, instanceName, project]);

  const status = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: data.length > 0,
    inFlight: hasInFlight(collectionKey),
  });
  const flags = resourceStatusFlags(status);

  return {
    data,
    error:
      collection.status === 'error'
        ? new Error(collection.error ?? 'Unable to load instance logs.')
        : null,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}

export function useInstanceLogContent(
  instanceName: string,
  project: string | null | undefined,
  filename: string | null,
) {
  const client = useIncusClient();
  const { key } = logIdentity({ instanceName, project });
  const storeKey = filename
    ? resourceKeys.instanceLogContent(key, filename)
    : null;
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    storeKey ? [storeKey] : [],
  );
  const cached = filename
    ? snapshot.state.instances.items[key]?.logs.items[filename]?.content
    : undefined;

  React.useEffect(() => {
    if (!filename) return;
    void client.instanceLogs.ensureContent({
      instanceName,
      project,
      filename,
    });
  }, [client, filename, instanceName, project]);

  const status = deriveResourceStatus({
    storedStatus: cached?.status ?? 'missing',
    hasData: cached?.data !== undefined,
    inFlight: storeKey ? hasInFlight(storeKey) : false,
  });
  const flags = resourceStatusFlags(status);

  return {
    data: cached?.data ?? null,
    error:
      cached?.status === 'error'
        ? new Error(cached.error ?? 'Unable to load instance log.')
        : null,
    status,
    isLoading: Boolean(filename) && flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}
