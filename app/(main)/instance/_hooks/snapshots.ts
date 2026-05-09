import { useIncusClient } from '@/app/_incus/provider';
import { useInstanceSnapshots } from '@/app/_incus/resources/instances/snapshots/hooks';

export function useSnapshots(instanceName: string, project?: string | null) {
  const client = useIncusClient();
  const resource = useInstanceSnapshots(instanceName, project);

  const mutateSnapshots = async () => {
    client.instanceSnapshots.markStale({ instanceName, project });
  };

  const createSnapshot = async (
    name?: string,
    stateful?: boolean,
    expiresAt?: string,
  ) => {
    await client.instanceSnapshots.create({
      instanceName,
      project,
      name,
      stateful,
      expiresAt,
    });
    await mutateSnapshots();
  };

  const deleteSnapshot = async (snapshotName: string) => {
    await client.instanceSnapshots.delete({ instanceName, project, snapshotName });
    await mutateSnapshots();
  };

  const restoreSnapshot = async (snapshotName: string) => {
    await client.instanceSnapshots.restore({ instanceName, project, snapshotName });
    await mutateSnapshots();
  };

  const editSnapshot = async (
    snapshotName: string,
    newName: string,
    expiresAt?: string,
  ) => {
    await client.instanceSnapshots.edit({
      instanceName,
      project,
      snapshotName,
      newName,
      expiresAt,
    });
    await mutateSnapshots();
  };

  const createInstanceFromSnapshot = async (
    snapshotName: string,
    targetName: string,
    instanceType: string,
  ) => {
    await client.instanceSnapshots.createInstance({
      instanceName,
      snapshotName,
      targetName,
      instanceType,
      project,
    });
  };

  const createImageFromSnapshot = async (
    snapshotName: string,
    alias?: string,
  ) => {
    await client.instanceSnapshots.createImage({
      instanceName,
      snapshotName,
      project,
      alias,
    });
  };

  return {
    ...resource,
    createSnapshot,
    deleteSnapshot,
    restoreSnapshot,
    editSnapshot,
    createInstanceFromSnapshot,
    createImageFromSnapshot,
  };
}
