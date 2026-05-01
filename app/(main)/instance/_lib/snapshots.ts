import { buildApiPath } from '@/app/_lib/url';
import { parseOperationResponse, waitForOperation } from './instance';

type CreateSnapshotInput = {
  instanceName: string;
  project?: string | null;
  name?: string;
  stateful?: boolean;
  expiresAt?: string;
};

type EditSnapshotInput = {
  instanceName: string;
  project?: string | null;
  snapshotName: string;
  newName: string;
  expiresAt?: string;
};

type CreateInstanceFromSnapshotInput = {
  instanceName: string;
  snapshotName: string;
  targetName: string;
  instanceType: string;
  project?: string | null;
};

type CreateImageFromSnapshotInput = {
  instanceName: string;
  snapshotName: string;
  project?: string | null;
  alias?: string;
};

function buildInstanceSnapshotsPath(
  instanceName: string,
  project?: string | null,
  snapshotName?: string,
) {
  const encodedInstanceName = encodeURIComponent(instanceName);
  const basePath = `/1.0/instances/${encodedInstanceName}/snapshots`;
  const path = snapshotName
    ? `${basePath}/${encodeURIComponent(snapshotName)}`
    : basePath;

  return buildApiPath(path, { project: project ?? null });
}

function getShortSnapshotName(snapshotName: string) {
  return snapshotName.split('/').pop() || '';
}

function getSnapshotSourceName(instanceName: string, snapshotName: string) {
  return `${instanceName}/${getShortSnapshotName(snapshotName)}`;
}

export async function createSnapshot({
  instanceName,
  project,
  name,
  stateful,
  expiresAt,
}: CreateSnapshotInput) {
  const res = await fetch(buildInstanceSnapshotsPath(instanceName, project), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name || undefined,
      stateful,
      expires_at: expiresAt,
    }),
  });

  const payload = await parseOperationResponse(
    res,
    `Unable to create a snapshot for ${instanceName}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export async function deleteSnapshot(
  instanceName: string,
  project: string | null | undefined,
  snapshotName: string,
) {
  const shortName = getShortSnapshotName(snapshotName);
  const res = await fetch(buildInstanceSnapshotsPath(instanceName, project, shortName), {
    method: 'DELETE',
  });

  const payload = await parseOperationResponse(
    res,
    `Unable to delete snapshot ${shortName}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export async function restoreSnapshot(
  instanceName: string,
  project: string | null | undefined,
  snapshotName: string,
) {
  const shortName = getShortSnapshotName(snapshotName);
  const res = await fetch(
    buildApiPath(`/1.0/instances/${encodeURIComponent(instanceName)}`, {
      project: project ?? null,
    }),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restore: shortName }),
    },
  );

  const payload = await parseOperationResponse(
    res,
    `Unable to restore snapshot ${shortName}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export async function renameSnapshot(
  instanceName: string,
  project: string | null | undefined,
  snapshotName: string,
  newName: string,
) {
  const shortName = getShortSnapshotName(snapshotName);
  const res = await fetch(buildInstanceSnapshotsPath(instanceName, project, shortName), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });

  const payload = await parseOperationResponse(
    res,
    `Unable to rename snapshot ${shortName}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export async function updateSnapshotExpiry(
  instanceName: string,
  project: string | null | undefined,
  snapshotName: string,
  expiresAt?: string,
) {
  const shortName = getShortSnapshotName(snapshotName);
  const res = await fetch(buildInstanceSnapshotsPath(instanceName, project, shortName), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expires_at: expiresAt }),
  });

  const payload = await parseOperationResponse(
    res,
    `Unable to update snapshot ${shortName}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export async function editSnapshot({
  instanceName,
  project,
  snapshotName,
  newName,
  expiresAt,
}: EditSnapshotInput) {
  const shortName = getShortSnapshotName(snapshotName);
  const normalizedName = newName.trim();

  if (!normalizedName) {
    throw new Error('Snapshot name is required.');
  }

  let finalSnapshotName = snapshotName;
  if (normalizedName !== shortName) {
    await renameSnapshot(instanceName, project, snapshotName, normalizedName);
    finalSnapshotName = `${instanceName}/${normalizedName}`;
  }

  await updateSnapshotExpiry(instanceName, project, finalSnapshotName, expiresAt);
}

export async function createInstanceFromSnapshot({
  instanceName,
  snapshotName,
  targetName,
  instanceType,
  project,
}: CreateInstanceFromSnapshotInput) {
  const normalizedTargetName = targetName.trim();
  if (!normalizedTargetName) {
    throw new Error('Instance name is required.');
  }

  const res = await fetch(
    buildApiPath('/1.0/instances', { project: project ?? null }),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: normalizedTargetName,
        type: instanceType,
        source: {
          type: 'copy',
          source: getSnapshotSourceName(instanceName, snapshotName),
          project: project ?? 'default',
        },
      }),
    },
  );

  const payload = await parseOperationResponse(
    res,
    `Unable to create instance ${normalizedTargetName} from snapshot.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}

export async function createImageFromSnapshot({
  instanceName,
  snapshotName,
  project,
  alias,
}: CreateImageFromSnapshotInput) {
  const res = await fetch(buildApiPath('/1.0/images', { project: project ?? null }), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      aliases: alias?.trim() ? [{ name: alias.trim() }] : undefined,
      source: {
        type: 'snapshot',
        name: getSnapshotSourceName(instanceName, snapshotName),
        project: project ?? 'default',
      },
    }),
  });

  const payload = await parseOperationResponse(
    res,
    `Unable to create an image from snapshot ${getShortSnapshotName(snapshotName)}.`,
  );

  if (payload?.operation) {
    await waitForOperation({
      operation: payload.operation,
      project: project ?? undefined,
    });
  }
}
