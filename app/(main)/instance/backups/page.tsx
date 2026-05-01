'use client';

import React from 'react';
import { useInstanceContext } from '../_context/instance';
import { useBackups } from '../_hooks/backups';
import { useStoragePools } from '../../_hooks/storagePools';
import { getRootDiskPool } from '../_lib/utils';
import { Spinner } from 'ui-web/components/spinner';
import { BackupList } from '../../_components/backups';

export default function BackupsPage() {
  const {
    instance,
    project,
    isLoading: isInstanceLoading,
  } = useInstanceContext();
  const { data: storagePools, isLoading: isStorageLoading } = useStoragePools();

  const isLoading = isInstanceLoading || isStorageLoading;

  if (isLoading) {
    return <Spinner />;
  }

  if (!instance) {
    return null;
  }

  return (
    <Backups
      instance={instance}
      project={project}
      storagePools={storagePools || []}
    />
  );
}

function Backups({
  instance,
  project,
  storagePools,
}: {
  instance: any;
  project: string | null;
  storagePools: any[];
}) {
  const rootDiskPoolName = getRootDiskPool(instance);
  const rootDiskPool = storagePools.find((p) => p.name === rootDiskPoolName);
  const canUseOptimizedStorage =
    rootDiskPool?.driver === 'zfs' || rootDiskPool?.driver === 'btrfs';

  const {
    backups,
    isLoading,
    isError,
    createBackup,
    deleteBackup,
    renameBackup,
    downloadBackup,
  } = useBackups(instance.name, instance.project ?? project ?? null);

  return (
    <BackupList
      backups={backups}
      isLoading={isLoading}
      isError={isError}
      onCreate={createBackup}
      onDelete={deleteBackup}
      onRename={renameBackup}
      onDownload={downloadBackup}
      canUseOptimizedStorage={canUseOptimizedStorage}
    />
  );
}
