import React from 'react';
import { useIncusClient } from '@/app/_incus/provider';
import { useInstanceBackups } from '@/app/_incus/resources/instances/backups/hooks';

export function useBackups(instanceName: string, project?: string | null) {
  const client = useIncusClient();
  const resource = useInstanceBackups(instanceName, project);

  const mutate = React.useCallback(async () => {
    client.instanceBackups.markStale({ instanceName, project });
    await client.instanceBackups.ensure({ instanceName, project });
  }, [client, instanceName, project]);

  const createBackup = async (
    name?: string,
    instanceOnly?: boolean,
    optimizedStorage?: boolean,
    compressionAlgorithm?: string,
    expiresAt?: string,
  ) => {
    await client.instanceBackups.create({
      instanceName,
      project,
      name,
      instanceOnly,
      optimizedStorage,
      compressionAlgorithm,
      expiresAt,
    });
    await mutate();
  };

  const deleteBackup = async (backupName: string) => {
    await client.instanceBackups.delete({ instanceName, project, backupName });
    await mutate();
  };

  const renameBackup = async (oldName: string, newName: string) => {
    await client.instanceBackups.rename({ instanceName, project, oldName, newName });
    await mutate();
  };

  const downloadBackup = (backupName: string) => {
    client.instanceBackups.download({ instanceName, project, backupName });
  };

  return {
    ...resource,
    createBackup,
    deleteBackup,
    renameBackup,
    downloadBackup,
  };
}
