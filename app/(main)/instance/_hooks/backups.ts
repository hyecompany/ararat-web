import useSWR, { useSWRConfig } from 'swr';
import { jsonFetcher } from '../../../_lib/fetcher';
import { Backup } from '../../_components/backups';
import { StandardResponse } from '../../../_lib/response';
import { buildApiPath } from '@/app/_lib/url';
import {
  createBackup as apiCreateBackup,
  deleteBackup as apiDeleteBackup,
  renameBackup as apiRenameBackup,
  downloadBackup as apiDownloadBackup,
} from '../_lib/backups';

function getBackupsCacheKey(instanceName: string, project?: string | null) {
  return buildApiPath(`/1.0/instances/${encodeURIComponent(instanceName)}/backups`, {
    project: project ?? null,
    params: { recursion: 1 },
  });
}

export function useBackups(instanceName: string, project?: string | null) {
  const { mutate } = useSWRConfig();
  const backupsCacheKey = getBackupsCacheKey(instanceName, project);
  const { data, error, isLoading } = useSWR<StandardResponse<Backup[]>>(
    backupsCacheKey,
    (url: string) => jsonFetcher<Backup[]>(url),
  );

  const createBackup = async (
    name?: string,
    instanceOnly?: boolean,
    optimizedStorage?: boolean,
  ) => {
    await apiCreateBackup(
      instanceName,
      project,
      name,
      instanceOnly,
      optimizedStorage,
    );
    await mutate(backupsCacheKey);
  };

  const deleteBackup = async (backupName: string) => {
    await apiDeleteBackup(instanceName, project, backupName);
    await mutate(backupsCacheKey);
  };

  const renameBackup = async (oldName: string, newName: string) => {
    await apiRenameBackup(instanceName, project, oldName, newName);
    await mutate(backupsCacheKey);
  };

  const downloadBackup = (backupName: string) => {
    apiDownloadBackup(instanceName, project, backupName);
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
