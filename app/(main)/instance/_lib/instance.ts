import type { Instance } from '../../instances/_lib/instances.d';
import type { Device } from '../../instances/_lib/instances.d';
import type { BackgroundOperationResponse } from '../../../_lib/response';
import { getBrowserIncusClient } from '@/app/_incus/client';
import type {
  AdvancedInstanceRebuildSource,
  CloneInstanceInput,
  InstanceAction,
} from '@/app/_incus/resources/instances/actions';

export type { AdvancedInstanceRebuildSource, CloneInstanceInput, InstanceAction };
export type AdvancedInstanceRepairAction = 'rebuild-config-volume';

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
  nextProfiles?: string[];
  signal?: AbortSignal;
}

export interface OperationResponseBody {
  type?: string;
  error?: string;
  operation?: string;
}

export async function getOperationErrorMessage(res: Response, fallback: string) {
  const payload = await res.json().catch(() => ({ error: res.statusText }));
  return payload?.error || fallback;
}

export async function parseOperationResponse(
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

export async function waitForOperation({
  operation,
  project,
  signal,
}: {
  operation: string;
  project?: string;
  signal?: AbortSignal;
}) {
  await getBrowserIncusClient().operations.wait(operation, { project, signal });
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

export async function performInstanceAction({
  action,
  force = false,
  instance,
}: {
  action: InstanceAction;
  force?: boolean;
  instance: Instance;
}) {
  await getBrowserIncusClient().instances.setState({ action, force, instance });
}

export async function deleteInstance(instance: Instance, force = false) {
  return getBrowserIncusClient().instances.delete(instance, force);
}

export async function rebuildInstance({
  instance,
  source,
}: {
  instance: Instance;
  source: AdvancedInstanceRebuildSource;
}) {
  return getBrowserIncusClient().instances.rebuild({ instance, source });
}

export async function repairInstance({
  instance,
  action,
}: {
  instance: Instance;
  action: AdvancedInstanceRepairAction;
}) {
  return getBrowserIncusClient().instances.repair({ instance, action });
}

export async function cloneInstance(input: CloneInstanceInput) {
  return getBrowserIncusClient().instances.clone(input);
}

export async function updateInstanceMetadata(input: UpdateInstanceMetadataInput) {
  return getBrowserIncusClient().instances.updateMetadata(input);
}

export async function updateInstanceSettings(input: UpdateInstanceSettingsInput) {
  return getBrowserIncusClient().instances.updateSettings(input);
}

export type { BackgroundOperationResponse };
