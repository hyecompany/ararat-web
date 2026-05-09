import { getBrowserIncusClient } from '@/app/_incus/client';

export async function deleteInstance(
  name: string,
  project: string | null,
): Promise<{ operation?: string; error?: string }> {
  try {
    const response = await getBrowserIncusClient().instances.delete({
      name,
      project: project ?? 'default',
    } as never);
    return {
      operation:
        'operation' in response && typeof response.operation === 'string'
          ? response.operation
          : undefined,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to delete instance.',
    };
  }
}

export async function createInstance(
  payload: Record<string, unknown>,
  project: string | null,
): Promise<{ operation?: string; error?: string }> {
  try {
    return await getBrowserIncusClient().instances.create(payload, project);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to create instance.',
    };
  }
}

export async function importInstanceFromBackup(
  backupFile: File,
  options: {
    name: string;
    pool: string;
    project: string | null;
    onProgress?: (percent: number | null) => void;
  },
): Promise<{ operation?: string; error?: string }> {
  return getBrowserIncusClient().instances.importFromBackup(backupFile, options);
}
