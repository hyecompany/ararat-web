import React from 'react';
import { useIncusClient } from '@/app/_incus/provider';
import { resourceKeys } from '@/app/_incus/resources';
import { useStoragePools as useStoragePoolsResource } from '@/app/_incus/resources/storage-pools/hooks';
import { collectionStatusKey } from '@/app/_incus/scope';
import { deriveResourceStatus, resourceStatusFlags } from '@/app/_incus/status';
import type { StoragePool, StorageVolume } from '@/app/_incus/types';
import { useIncusResourceSnapshot } from '@/app/_incus/use-resource-snapshot';

export function useStoragePools() {
  const result = useStoragePoolsResource({ include: { metadata: true } });
  const flags = resourceStatusFlags(result.status);
  return {
    data: result.rows
      .map((row) => row.metadata)
      .filter((pool): pool is StoragePool => Boolean(pool)),
    error: null,
    status: result.status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}

export function useStoragePoolVolumes(poolName: string | null | undefined) {
  const client = useIncusClient();
  const project = collectionStatusKey(client.getProject());
  const storeKey = poolName
    ? resourceKeys.storagePoolVolumesCollection(poolName, project)
    : null;
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    storeKey ? [storeKey] : [],
  );
  const collection = poolName
    ? snapshot.state.storagePools.items[poolName]?.volumes.collection.byProject[
        project
      ]
    : undefined;

  React.useEffect(() => {
    if (!poolName) return;
    void client.ensureStoragePoolVolumes(poolName, project);
  }, [client, poolName, project, collection?.status, snapshot.version]);

  const data = poolName
    ? Object.values(snapshot.state.storagePools.items[poolName]?.volumes.items ?? {})
        .map((item) => item.metadata.data)
        .filter((volume): volume is StorageVolume => Boolean(volume))
        .filter((volume) => (volume.project ?? project) === project)
    : null;
  const status = deriveResourceStatus({
    storedStatus: collection?.status ?? 'missing',
    hasData: Boolean(data?.length),
    inFlight: storeKey ? hasInFlight(storeKey) : false,
  });
  const flags = resourceStatusFlags(status);

  return {
    data,
    error:
      collection?.status === 'error'
        ? new Error(collection.error ?? 'Unable to load storage volumes.')
        : null,
    status,
    isLoading: Boolean(poolName) && flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}
