import { useSWRConfig } from 'swr';
import {
  createSnapshot as apiCreateSnapshot,
  createImageFromSnapshot as apiCreateImageFromSnapshot,
  createInstanceFromSnapshot as apiCreateInstanceFromSnapshot,
  deleteSnapshot as apiDeleteSnapshot,
  editSnapshot as apiEditSnapshot,
  restoreSnapshot as apiRestoreSnapshot,
} from '../_lib/snapshots';
import { getInstanceCacheKey } from './instance';

export function useSnapshots(instanceName: string, project?: string | null) {
  const { mutate } = useSWRConfig();
  const instanceCacheKey = getInstanceCacheKey(instanceName, project);

  const mutateInstance = async () => {
    if (!instanceCacheKey) return;
    await mutate(instanceCacheKey);
  };

  const createSnapshot = async (
    name?: string,
    stateful?: boolean,
    expiresAt?: string,
  ) => {
    await apiCreateSnapshot({
      instanceName,
      project,
      name,
      stateful,
      expiresAt,
    });
    await mutateInstance();
  };

  const deleteSnapshot = async (snapshotName: string) => {
    await apiDeleteSnapshot(instanceName, project, snapshotName);
    await mutateInstance();
  };

  const restoreSnapshot = async (snapshotName: string) => {
    await apiRestoreSnapshot(instanceName, project, snapshotName);
    await mutateInstance();
  };

  const editSnapshot = async (
    snapshotName: string,
    newName: string,
    expiresAt?: string,
  ) => {
    await apiEditSnapshot({
      instanceName,
      project,
      snapshotName,
      newName,
      expiresAt,
    });
    await mutateInstance();
  };

  const createInstanceFromSnapshot = async (
    snapshotName: string,
    targetName: string,
    instanceType: string,
  ) => {
    await apiCreateInstanceFromSnapshot({
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
    await apiCreateImageFromSnapshot({
      instanceName,
      snapshotName,
      project,
      alias,
    });
  };

  return {
    createSnapshot,
    deleteSnapshot,
    restoreSnapshot,
    editSnapshot,
    createInstanceFromSnapshot,
    createImageFromSnapshot,
  };
}
