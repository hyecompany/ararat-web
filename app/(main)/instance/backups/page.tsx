'use client';

import React from 'react';
import { useInstanceContext } from '../_context/instance';
import { useInstance } from '../_hooks/instance';
import { useBackups } from '../_hooks/backups';
import { useStoragePools } from '../../_hooks/storagePools';
import { getRootDiskPool } from '../_lib/utils';
import { BackupList } from './_components/backup-list';

export default function BackupsPage() {
  const { name, project } = useInstanceContext();
  const { instance } = useInstance(name, project, { metadata: true });
  const { data: storagePools } = useStoragePools();

  const instanceName = name;
  if (!instanceName) {
    return null;
  }

  return (
    <Backups
      instanceName={instanceName}
      instance={instance}
      project={project}
      storagePools={storagePools || []}
    />
  );
}

function Backups({
  instanceName,
  instance,
  project,
  storagePools,
}: {
  instanceName: string;
  instance: any | undefined;
  project: string | null;
  storagePools: any[];
}) {
  const instanceProject = instance?.project ?? project ?? null;
  const rootDiskPoolName = instance ? getRootDiskPool(instance) : null;
  const rootDiskPool = rootDiskPoolName
    ? storagePools.find((p) => p.name === rootDiskPoolName)
    : null;
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
  } = useBackups(instanceName, instanceProject);

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
