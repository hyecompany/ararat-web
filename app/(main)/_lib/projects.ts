import { jsonFetcher } from '../../_lib/fetcher';
import type { BackgroundOperationResponse, ErrorResponse } from '../../_lib/response';
import type {
  CreateProjectBody,
  Project,
  ProjectResponse,
  ProjectsMetadata,
  UpdateProjectBody,
} from './projects.d';

interface OperationStatusResponse {
  metadata?: {
    status?: string;
    status_code?: number;
    err?: string;
  };
  error?: string;
}

const OPERATION_TIMEOUT_MS = 30000;
const OPERATION_RETRY_DELAY_MS = 500;

export async function getProjects() {
  return jsonFetcher<ProjectsMetadata>('/1.0/projects?recursion=1').then((data) => data.metadata);
}

async function parseResponseBody<T>(response: Response) {
  return (await response.json().catch(() => ({}))) as
    | T
    | ErrorResponse<Record<string, unknown>>
    | Record<string, unknown>;
}

async function getErrorMessage(response: Response, fallback: string) {
  const payload = await parseResponseBody<Record<string, unknown>>(response);
  return ('error' in payload && typeof payload.error === 'string' && payload.error) || fallback;
}

export async function getProject(name: string): Promise<{ project: Project; etag: string | null }> {
  const response = await fetch(`/1.0/projects/${encodeURIComponent(name)}`);
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, `Unable to load project ${name}`));
  }

  const data = (await parseResponseBody<ProjectResponse>(response)) as ProjectResponse;
  return {
    project: data.metadata,
    etag: response.headers.get('etag') || response.headers.get('ETag'),
  };
}

async function waitForOperation(operation: string) {
  const waitUrl = new URL(`${operation}/wait`, window.location.origin);
  waitUrl.searchParams.set('timeout', String(Math.ceil(OPERATION_TIMEOUT_MS / 1000)));
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;

  while (true) {
    if (Date.now() > deadline) {
      throw new Error('Timed out while waiting for project operation to complete.');
    }

    const response = await fetch(waitUrl.toString());
    if (!response.ok) {
      throw new Error(await getErrorMessage(response, 'Unable to wait for project rename.'));
    }

    const payload = (await parseResponseBody<OperationStatusResponse>(
      response,
    )) as OperationStatusResponse;
    if (!payload.metadata) {
      throw new Error('Received an invalid response while waiting for project rename.');
    }

    const { status, status_code: statusCode, err } = payload.metadata;
    if (statusCode === 400 || status === 'Failure') {
      throw new Error(err || 'Project rename failed.');
    }

    if (statusCode === 401 || status === 'Cancelled') {
      throw new Error(err || 'Project rename was cancelled.');
    }

    if (status === 'Success') {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error('Timed out while waiting for project operation to complete.');
    }

    await new Promise((resolve) => window.setTimeout(resolve, OPERATION_RETRY_DELAY_MS));
  }
}

export async function createProject(
  payload: CreateProjectBody,
): Promise<{ operation?: string; error?: string }> {
  try {
    const response = await fetch('/1.0/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let data: Record<string, unknown> = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      return {
        error: (data.error as string) || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    if (data.type === 'error') {
      return { error: (data.error as string) || 'Failed to create project' };
    }

    return { operation: data.operation as string | undefined };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { error: message };
  }
}

export async function updateProject(
  payload: UpdateProjectBody,
): Promise<{ project: Project; renamedFrom?: string }> {
  const currentName = payload.currentName.trim();
  const nextName = payload.name.trim();
  const nextDescription = payload.description?.trim() || '';
  const nextConfig = payload.config ?? {};

  const { project: currentProject, etag } = await getProject(currentName);

  const updateResponse = await fetch(`/1.0/projects/${encodeURIComponent(currentName)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(etag ? { 'If-Match': etag } : {}),
    },
    body: JSON.stringify({
      description: nextDescription,
      config: nextConfig,
    }),
  });

  if (!updateResponse.ok) {
    throw new Error(
      await getErrorMessage(updateResponse, `Unable to update project ${currentProject.name}`),
    );
  }

  const updateData = (await parseResponseBody<BackgroundOperationResponse>(
    updateResponse,
  )) as BackgroundOperationResponse;
  if (updateData.operation) {
    await waitForOperation(updateData.operation);
  }

  if (nextName !== currentName) {
    const renameResponse = await fetch(`/1.0/projects/${encodeURIComponent(currentName)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: nextName,
      }),
    });

    if (!renameResponse.ok) {
      throw new Error(
        await getErrorMessage(renameResponse, `Unable to rename project ${currentName}`),
      );
    }

    const renameData = (await parseResponseBody<BackgroundOperationResponse>(
      renameResponse,
    )) as BackgroundOperationResponse;
    if (renameData.operation) {
      await waitForOperation(renameData.operation);
    }
  }

  return {
    project: {
      ...currentProject,
      name: nextName,
      description: nextDescription || undefined,
      config: nextConfig,
    },
    renamedFrom: nextName !== currentName ? currentName : undefined,
  };
}
