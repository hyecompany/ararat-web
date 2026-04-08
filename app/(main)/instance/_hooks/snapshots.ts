import { useSWRConfig } from 'swr';
import {
  createSnapshot as apiCreateSnapshot,
  deleteSnapshot as apiDeleteSnapshot,
  restoreSnapshot as apiRestoreSnapshot,
  renameSnapshot as apiRenameSnapshot,
} from '../_lib/snapshots';

export function useSnapshots(instanceName: string) {
  const { mutate } = useSWRConfig();

  const createSnapshot = async (name?: string, stateful?: boolean) => {
    await apiCreateSnapshot(instanceName, name, stateful);
    await mutate(`/1.0/instances/${instanceName}?recursion=1`);
  };

  const deleteSnapshot = async (snapshotName: string) => {
    await apiDeleteSnapshot(instanceName, snapshotName);
    await mutate(`/1.0/instances/${instanceName}?recursion=1`);
  };

  const restoreSnapshot = async (snapshotName: string) => {
    await apiRestoreSnapshot(instanceName, snapshotName);
    await mutate(`/1.0/instances/${instanceName}?recursion=1`);
  };

  const renameSnapshot = async (snapshotName: string, newName: string) => {
    await apiRenameSnapshot(instanceName, snapshotName, newName);
    await mutate(`/1.0/instances/${instanceName}?recursion=1`);
  };

  return {
    createSnapshot,
    deleteSnapshot,
    restoreSnapshot,
    renameSnapshot,
  };
}
