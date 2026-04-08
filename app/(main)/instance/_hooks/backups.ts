import useSWR, { useSWRConfig } from 'swr';
import { jsonFetcher } from '../../../_lib/fetcher';
import { Backup } from '../../_components/backups';
import { StandardResponse } from '../../../_lib/response';
import {
  createBackup as apiCreateBackup,
  deleteBackup as apiDeleteBackup,
  renameBackup as apiRenameBackup,
  downloadBackup as apiDownloadBackup,
} from '../_lib/backups';

export function useBackups(instanceName: string) {
  const { mutate } = useSWRConfig();
  const { data, error, isLoading } = useSWR<StandardResponse<Backup[]>>(
    `/1.0/instances/${instanceName}/backups?recursion=1`,
    (url: string) => jsonFetcher<Backup[]>(url),
  );

  const createBackup = async (
    name?: string,
    instanceOnly?: boolean,
    optimizedStorage?: boolean,
  ) => {
    await apiCreateBackup(instanceName, name, instanceOnly, optimizedStorage);
    await mutate(`/1.0/instances/${instanceName}/backups?recursion=1`);
  };

  const deleteBackup = async (backupName: string) => {
    await apiDeleteBackup(instanceName, backupName);
    await mutate(`/1.0/instances/${instanceName}/backups?recursion=1`);
  };

  const renameBackup = async (oldName: string, newName: string) => {
    await apiRenameBackup(instanceName, oldName, newName);
    await mutate(`/1.0/instances/${instanceName}/backups?recursion=1`);
  };

  const downloadBackup = (backupName: string) => {
    apiDownloadBackup(instanceName, backupName);
  };

  return {
    backups: data?.metadata || [],
    isLoading,
    isError: error,
    createBackup,
    deleteBackup,
    renameBackup,
    downloadBackup,
  };
}
