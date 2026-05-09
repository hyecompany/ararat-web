'use client';

import React from 'react';
import { normalizeAbsPath } from '@/app/(main)/_lib/files/path';
import { instanceKey } from '../../../keys';
import { useIncusClient } from '../../../provider';
import { resourceKeys } from '../../../resources';
import {
  deriveResourceStatus,
  resourceStatusFlags,
  shouldFetchStoredStatus,
} from '../../../status';
import { useIncusResourceSnapshot } from '../../../use-resource-snapshot';

export type UseInstanceFileChildrenRequest = {
  instanceName: string;
  project?: string | null;
  path: string;
};

export function useInstanceFileChildren({
  instanceName,
  project,
  path,
}: UseInstanceFileChildrenRequest) {
  const client = useIncusClient();
  const normalizedPath = normalizeAbsPath(path);
  const projectKey = project || 'default';
  const key = instanceKey(projectKey, instanceName);
  const storeKey = resourceKeys.instanceFileChildren(key, normalizedPath);
  const { storeSnapshot, hasInFlight } = useIncusResourceSnapshot(client, [
    storeKey,
  ]);
  const children =
    storeSnapshot.state.instances.items[key]?.files.items[normalizedPath]
      ?.children;
  const storedStatus = children?.status ?? 'missing';

  React.useEffect(() => {
    if (!shouldFetchStoredStatus(storedStatus)) return;
    void client.instanceFiles
      .getChildren({ instanceName, project, path: normalizedPath })
      .catch(() => undefined);
  }, [client, instanceName, normalizedPath, project, storedStatus]);

  const status = deriveResourceStatus({
    storedStatus,
    hasData: Array.isArray(children?.names),
    inFlight: hasInFlight(storeKey),
  });
  const flags = resourceStatusFlags(status);

  return {
    names: children?.names,
    status,
    error:
      status === 'error'
        ? new Error(children?.error ?? 'Unable to load folder.')
        : null,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}
