import { buildApiPath } from '@/app/_lib/url';

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
) {
  const res = await fetch(buildInstanceBackupsPath(instanceName, project), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name || undefined,
      instance_only: instanceOnly,
      optimized_storage: optimizedStorage,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
}

export async function deleteBackup(
  instanceName: string,
  project: string | null | undefined,
  backupName: string,
) {
  const shortName = backupName.split('/').pop() || '';

  const res = await fetch(buildInstanceBackupsPath(instanceName, project, shortName), {
    method: 'DELETE',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
}

export async function renameBackup(
  instanceName: string,
  project: string | null | undefined,
  oldName: string,
  newName: string,
) {
  const shortOldName = oldName.split('/').pop() || '';
  const res = await fetch(buildInstanceBackupsPath(instanceName, project, shortOldName), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText);
  }
}

export function downloadBackup(
  instanceName: string,
  project: string | null | undefined,
  backupName: string,
) {
  const shortName = backupName.split('/').pop() || '';
  const url = buildInstanceBackupsPath(instanceName, project, shortName, 'export');
  const link = document.createElement('a');
  link.href = url;
  link.download = `${shortName}.tar.gz`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
