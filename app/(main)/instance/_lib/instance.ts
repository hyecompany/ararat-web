import { Instance } from '../../instances/_lib/instances.d';
import type { BackgroundOperationResponse } from '../../../_lib/response';

export type InstanceAction = 'start' | 'stop' | 'restart' | 'freeze';
const OPERATION_TIMEOUT_MS = 30000;

interface UpdateInstanceMetadataInput {
  instance: Instance;
  nextName: string;
  nextDescription: string;
  signal?: AbortSignal;
}

interface OperationStatusResponse {
  metadata?: {
    status?: string;
    status_code?: number;
    err?: string;
  };
  error?: string;
}

function getProjectSuffix(instance: Instance) {
  return instance.project
    ? `?project=${encodeURIComponent(instance.project)}`
    : '';
}

async function getErrorMessage(res: Response, fallback: string) {
  const payload = await res.json().catch(() => ({ error: res.statusText }));
  return payload?.error || fallback;
}

export async function performInstanceAction({
  action,
  instance,
}: {
  action: InstanceAction;
  instance: Instance;
}) {
  const projectSuffix = getProjectSuffix(instance);
  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(instance.name)}/state${projectSuffix}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action,
        timeout: 30,
        force: false,
        stateful: false,
      }),
    },
  );
  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      payload?.error || `Unable to ${action} instance ${instance.name}`,
    );
  }
}

async function updateInstanceDescription({
  instance,
  description,
}: {
  instance: Instance;
  description: string;
}) {
  const projectSuffix = getProjectSuffix(instance);
  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(instance.name)}${projectSuffix}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(
      await getErrorMessage(
        res,
        `Unable to update description for instance ${instance.name}`,
      ),
    );
  }
}

async function renameInstance({
  instance,
  nextName,
}: {
  instance: Instance;
  nextName: string;
}) {
  const projectSuffix = getProjectSuffix(instance);
  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(instance.name)}${projectSuffix}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: nextName,
        migration: false,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(
      await getErrorMessage(res, `Unable to rename instance ${instance.name}`),
    );
  }

  return (await res.json().catch(() => null)) as BackgroundOperationResponse | null;
}

async function waitForOperation({
  operation,
  project,
  signal,
}: {
  operation: string;
  project?: string;
  signal?: AbortSignal;
}) {
  const waitUrl = new URL(`${operation}/wait`, window.location.origin);
  waitUrl.searchParams.set(
    'timeout',
    String(Math.ceil(OPERATION_TIMEOUT_MS / 1000)),
  );

  if (project && !waitUrl.searchParams.has('project')) {
    waitUrl.searchParams.set('project', project);
  }

  while (true) {
    signal?.throwIfAborted();
    const res = await fetch(waitUrl.toString(), { signal });

    if (!res.ok) {
      throw new Error(
        await getErrorMessage(res, 'Unable to wait for instance rename operation'),
      );
    }

    const payload = (await res.json().catch(() => null)) as OperationStatusResponse | null;
    if (!payload?.metadata) {
      throw new Error('Received an invalid response while waiting for instance rename.');
    }

    const status = payload?.metadata?.status;
    const statusCode = payload?.metadata?.status_code;

    if (statusCode === 400 || status === 'Failure') {
      throw new Error(payload?.metadata?.err || 'Instance rename failed.');
    }

    if (statusCode === 401 || status === 'Cancelled') {
      throw new Error(payload?.metadata?.err || 'Instance rename was cancelled.');
    }

    if (status === 'Success') {
      return;
    }
  }
}

export async function updateInstanceMetadata({
  instance,
  nextName,
  nextDescription,
  signal,
}: UpdateInstanceMetadataInput) {
  const normalizedName = nextName.trim();
  const normalizedDescription = nextDescription.trim();
  const currentDescription = instance.description ?? '';
  const didRename = normalizedName !== instance.name;
  const didChangeDescription = normalizedDescription !== currentDescription;

  if (!didRename && !didChangeDescription) {
    return {
      instance: {
        ...instance,
        description: normalizedDescription || undefined,
      },
      renameOperation: null,
    };
  }

  if (didChangeDescription) {
    await updateInstanceDescription({
      instance,
      description: normalizedDescription,
    });
  }

  const renameOperation = didRename
    ? await renameInstance({
        instance,
        nextName: normalizedName,
      })
    : null;

  if (renameOperation?.operation) {
    await waitForOperation({
      operation: renameOperation.operation,
      project: instance.project,
      signal,
    });
  }

  return {
    instance: {
      ...instance,
      name: normalizedName,
      description: normalizedDescription || undefined,
    },
    renameOperation,
  };
}
