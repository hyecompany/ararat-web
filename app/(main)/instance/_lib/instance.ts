import { Instance } from '../../instances/_lib/instances.d';
import type { BackgroundOperationResponse } from '../../../_lib/response';
import type { Device } from '../../instances/_lib/instances.d';
import { jsonFetcherWithResponse } from '@/app/_lib/fetcher';
import type { StandardResponse } from '@/app/_lib/response.d';

export type InstanceAction = 'start' | 'stop' | 'restart' | 'freeze';
export type AdvancedInstanceRepairAction = 'rebuild-config-volume';
export type AdvancedInstanceRebuildSource =
  | {
      type: 'none';
    }
  | {
      type: 'image';
      fingerprint?: string;
      alias?: string;
      server?: string;
      mode?: 'pull';
      protocol?: 'simplestreams' | 'oci';
    };
const OPERATION_TIMEOUT_MS = 30000;

interface UpdateInstanceMetadataInput {
  instance: Instance;
  nextName: string;
  nextDescription: string;
  signal?: AbortSignal;
}

interface UpdateInstanceSettingsInput {
  instance: Instance;
  nextConfig?: Record<string, string>;
  nextDevices?: Record<string, Device>;
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

interface UpdateInstanceBody {
  architecture?: string;
  config: Record<string, string>;
  description?: string;
  devices: Record<string, Device>;
  ephemeral?: boolean;
  location?: string;
  profiles: string[];
}

interface OperationResponseBody {
  type?: string;
  error?: string;
  operation?: string;
}

function getProjectSuffix(instance: Instance) {
  return instance.project
    ? `?project=${encodeURIComponent(instance.project)}`
    : '';
}

function getProjectParam(instance: Instance) {
  return getProjectSuffix(instance);
}

async function getErrorMessage(res: Response, fallback: string) {
  const payload = await res.json().catch(() => ({ error: res.statusText }));
  return payload?.error || fallback;
}

async function parseOperationResponse(
  res: Response,
  fallback: string,
): Promise<OperationResponseBody | null> {
  const payload = (await res
    .json()
    .catch(() => null)) as OperationResponseBody | null;

  if (!res.ok) {
    throw new Error(payload?.error || fallback);
  }

  if (payload?.type === 'error') {
    throw new Error(payload.error || fallback);
  }

  return payload;
}

async function waitForOperationIfNeeded({
  payload,
  instance,
}: {
  payload: OperationResponseBody | null;
  instance: Instance;
}) {
  if (!payload?.operation) {
    return;
  }

  await waitForOperation({
    operation: payload.operation,
    project: instance.project,
  });
}

async function getInstanceForUpdate({
  instance,
  signal,
}: {
  instance: Instance;
  signal?: AbortSignal;
}) {
  const projectSuffix = getProjectSuffix(instance);
  const { data, response } = await jsonFetcherWithResponse<StandardResponse<Instance>>(
    `/1.0/instances/${encodeURIComponent(instance.name)}?recursion=1${projectSuffix ? `&${projectSuffix.slice(1)}` : ''}`,
    { signal },
  );

  return {
    instance: data.metadata,
    etag: response.headers.get('etag'),
  };
}

function buildInstanceUpdateBody({
  instance,
  nextConfig,
  nextDevices,
}: {
  instance: Instance;
  nextConfig?: Record<string, string>;
  nextDevices?: Record<string, Device>;
}) {
  const payload: UpdateInstanceBody = {
    config: nextConfig ?? instance.config ?? {},
    devices: nextDevices ?? (instance.devices as Record<string, Device>) ?? {},
    profiles: instance.profiles ?? ['default'],
  };

  if (instance.architecture) {
    payload.architecture = instance.architecture;
  }

  if (instance.description !== undefined) {
    payload.description = instance.description;
  }

  if (instance.ephemeral !== undefined) {
    payload.ephemeral = instance.ephemeral;
  }

  if (instance.location) {
    payload.location = instance.location;
  }

  return payload;
}

export async function performInstanceAction({
  action,
  force = false,
  instance,
}: {
  action: InstanceAction;
  force?: boolean;
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
        force,
        stateful: false,
      }),
    },
  );
  const payload = await parseOperationResponse(
    res,
    `Unable to ${action} instance ${instance.name}`,
  );

  await waitForOperationIfNeeded({ payload, instance });
}

export function isInstanceDeleteProtected(instance: Instance) {
  const config = instance.expanded_config ?? instance.config ?? {};
  return config['security.protection.delete'] === 'true';
}

export function isInstanceRunning(instance: Instance) {
  const status = instance.status?.toLowerCase();
  return status === 'running' || status === 'started';
}

export function canDeleteInstance(instance: Instance) {
  return !isInstanceDeleteProtected(instance) && !isInstanceRunning(instance);
}

export async function deleteInstance(instance: Instance, force = false) {
  if (force && isInstanceRunning(instance)) {
    await performInstanceAction({
      action: 'stop',
      force: true,
      instance,
    });
  }

  const projectParam = getProjectParam(instance);
  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(instance.name)}${projectParam}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );

  const payload = await parseOperationResponse(
    res,
    `Unable to delete instance ${instance.name}.`,
  );

  await waitForOperationIfNeeded({ payload, instance });

  return payload;
}

export async function rebuildInstance({
  instance,
  source,
}: {
  instance: Instance;
  source: AdvancedInstanceRebuildSource;
}) {
  const projectParam = getProjectParam(instance);
  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(instance.name)}/rebuild${projectParam}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source,
      }),
    },
  );

  const payload = await parseOperationResponse(
    res,
    `Unable to rebuild instance ${instance.name}.`,
  );

  await waitForOperationIfNeeded({ payload, instance });

  return payload;
}

export async function repairInstance({
  instance,
  action,
}: {
  instance: Instance;
  action: AdvancedInstanceRepairAction;
}) {
  const projectParam = getProjectParam(instance);
  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(instance.name)}/debug/repair${projectParam}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action,
      }),
    },
  );

  const payload = await parseOperationResponse(
    res,
    `Unable to repair instance ${instance.name}.`,
  );

  await waitForOperationIfNeeded({ payload, instance });

  return payload;
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

export async function updateInstanceSettings({
  instance,
  nextConfig,
  nextDevices,
  signal,
}: UpdateInstanceSettingsInput) {
  const { instance: latestInstance, etag } = await getInstanceForUpdate({
    instance,
    signal,
  });
  const projectSuffix = getProjectSuffix(latestInstance);
  const payload = buildInstanceUpdateBody({
    instance: latestInstance,
    nextConfig,
    nextDevices,
  });

  const res = await fetch(
    `/1.0/instances/${encodeURIComponent(latestInstance.name)}${projectSuffix}`,
    {
      method: 'PUT',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(etag ? { 'If-Match': etag } : {}),
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    throw new Error(
      await getErrorMessage(
        res,
        `Unable to update settings for instance ${latestInstance.name}`,
      ),
    );
  }

  const operation = (await res.json().catch(() => null)) as BackgroundOperationResponse | null;

  if (operation?.operation) {
    await waitForOperation({
      operation: operation.operation,
      project: latestInstance.project,
      signal,
    });
  }

  return {
    instance: {
      ...latestInstance,
      description: payload.description,
      ephemeral: payload.ephemeral,
      location: payload.location,
      architecture: payload.architecture,
      profiles: payload.profiles,
      config: payload.config,
      devices: payload.devices,
    },
    operation,
  };
}
