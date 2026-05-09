'use client';

import React from 'react';
import { useIncusClient } from '../../../provider';
import {
  deriveResourceStatus,
  resourceStatusFlags,
} from '../../../status';
import type { InstanceBackup } from '../../../types';
import { useIncusResourceSnapshot } from '../../../use-resource-snapshot';
import { backupIdentity } from './ensure';

export function useInstanceBackups(
  instanceName: string,
  project?: string | null,
) {
  const client = useIncusClient();
  const { key, collectionKey } = backupIdentity({ instanceName, project });
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    [collectionKey],
  );
  const item = snapshot.state.instances.items[key];
  const collection = item?.backups.collection ?? { status: 'missing' as const };
  const backups = Object.values(item?.backups.items ?? {})
    .map((backup) => backup.metadata.data)
    .filter((backup): backup is InstanceBackup => Boolean(backup))
    .sort((a, b) => a.name.localeCompare(b.name));

  React.useEffect(() => {
    void client.instanceBackups.ensure({ instanceName, project });
  }, [client, instanceName, project]);

  const status = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: backups.length > 0,
    inFlight: hasInFlight(collectionKey),
  });
  const flags = resourceStatusFlags(status);

  return {
    backups,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
    isError:
      collection.status === 'error'
        ? new Error(collection.error ?? 'Unable to load instance backups.')
        : null,
  };
}
