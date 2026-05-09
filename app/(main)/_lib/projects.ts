import { getBrowserIncusClient } from '@/app/_incus/client';
import type {
  CreateProjectBody,
  Project,
  UpdateProjectBody,
} from './projects.d';

export class ProjectRenamePartialFailureError extends Error {
  project: Project;

  constructor(message: string, project: Project) {
    super(message);
    this.name = 'ProjectRenamePartialFailureError';
    this.project = project;
  }
}

export async function createProject(
  payload: CreateProjectBody,
  signal?: AbortSignal,
): Promise<{ operation?: string; error?: string }> {
  try {
    const response = await getBrowserIncusClient().projects.create(payload, signal);
    return {
      operation:
        'operation' in response && typeof response.operation === 'string'
          ? response.operation
          : undefined,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { error: 'Request was cancelled.' };
    }
    return {
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

export async function updateProject(
  payload: UpdateProjectBody,
  signal?: AbortSignal,
) {
  return getBrowserIncusClient().projects.update(payload, signal);
}
