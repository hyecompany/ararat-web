import { buildApiPath } from '@/app/_lib/url';
import { parseOperationResponse, waitForOperation } from './instance';
import { getInstanceResourceShortName } from './utils';

export interface InstanceBackup {
  name: string;
  created_at: string;
  expires_at?: string;
  container_only?: boolean;
  instance_only?: boolean;
  optimized_storage?: boolean;
}

function buildInstanceBackupsPath(
  instanceName: string,
  project?: string | null,
  backupName?: string,
  action?: 'export',
) {
  const encodedInstanceName = encodeURIComponent(instanceName);
  const segments = [`/1.0/instances/${encodedInstanceName}/backups`];
  if (backupName) {
    segments.push(encodeURIComponent(backupName));
  }
  if (action) {
    segments.push(action);
  }

  return buildApiPath(segments.join('/'), { project: project ?? null });
}

export async function createBackup(
  instanceName: string,
  project?: string | null,
  name?: string,
  instanceOnly?: boolean,
  optimizedStorage?: boolean,
  compressionAlgorithm?: string,
  expiresAt?: string,
) {
  const res = await fetch(buildInstanceBackupsPath(instanceName, project), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name || undefined,
      instance_only: instanceOnly,
      optimized_storage: optimizedStorage,
      compression_algorithm: compressionAlgorithm || undefined,
      expires_at: expiresAt ?? null,
    }),
  });

  const payload = await parseOperationResponse(
    res,
    `Unable to create a backup for ${instanceName}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export async function deleteBackup(
  instanceName: string,
  project: string | null | undefined,
  backupName: string,
) {
  const shortName = getInstanceResourceShortName(backupName);

  const res = await fetch(buildInstanceBackupsPath(instanceName, project, shortName), {
    method: 'DELETE',
  });

  const payload = await parseOperationResponse(
    res,
    `Unable to delete backup ${shortName}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export async function renameBackup(
  instanceName: string,
  project: string | null | undefined,
  oldName: string,
  newName: string,
) {
  const shortOldName = getInstanceResourceShortName(oldName);
  const res = await fetch(buildInstanceBackupsPath(instanceName, project, shortOldName), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });

  const payload = await parseOperationResponse(
    res,
    `Unable to rename backup ${shortOldName}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export function downloadBackup(
  instanceName: string,
  project: string | null | undefined,
  backupName: string,
) {
  const shortName = getInstanceResourceShortName(backupName);
  const url = buildInstanceBackupsPath(instanceName, project, shortName, 'export');
  const link = document.createElement('a');
  link.href = url;
  link.download = `${shortName}.tar.gz`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
