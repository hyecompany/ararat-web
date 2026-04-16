import { jsonFetcher, jsonFetcherWithResponse } from '../../_lib/fetcher';
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

export class ProjectRenamePartialFailureError extends Error {
  project: Project;

  constructor(message: string, project: Project) {
    super(message);
    this.name = 'ProjectRenamePartialFailureError';
    this.project = project;
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('The operation was aborted.', 'AbortError');
  }
}

async function abortableDelay(ms: number, signal?: AbortSignal) {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', handleAbort, { once: true });
  });
}

export async function getProjects() {
  return jsonFetcher<ProjectsMetadata>('/1.0/projects?recursion=1').then((data) => data.metadata);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (
    error &&
    typeof error === 'object' &&
    'error' in error &&
    typeof (error as ErrorResponse<unknown>).error === 'string' &&
    (error as ErrorResponse<unknown>).error
  ) {
    return (error as ErrorResponse<unknown>).error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export async function getProject(
  name: string,
  signal?: AbortSignal,
): Promise<{ project: Project; etag: string | null }> {
  try {
    const { data, response } = await jsonFetcherWithResponse<ProjectResponse>(
      `/1.0/projects/${encodeURIComponent(name)}`,
      { signal },
    );

    return {
      project: data.metadata,
      etag: response.headers.get('etag') || response.headers.get('ETag'),
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new Error(getErrorMessage(error, `Unable to load project ${name}`));
  }
}

async function waitForOperation(operation: string, signal?: AbortSignal) {
  const waitUrl = new URL(`${operation}/wait`, window.location.origin);
  waitUrl.searchParams.set('timeout', String(Math.ceil(OPERATION_TIMEOUT_MS / 1000)));
  const deadline = Date.now() + OPERATION_TIMEOUT_MS;

  for (;;) {
    throwIfAborted(signal);

    if (Date.now() > deadline) {
      throw new Error('Timed out while waiting for project operation to complete.');
    }

    const waitPath = `${waitUrl.pathname}${waitUrl.search}`;
    let payload: OperationStatusResponse;
    try {
      const result = await jsonFetcherWithResponse<OperationStatusResponse>(waitPath, { signal });
      payload = result.data;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      throw new Error(getErrorMessage(error, 'Unable to wait for project rename.'));
    }

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

    await abortableDelay(OPERATION_RETRY_DELAY_MS, signal);
  }
}

export async function createProject(
  payload: CreateProjectBody,
  signal?: AbortSignal,
): Promise<{ operation?: string; error?: string }> {
  try {
    const { data } = await jsonFetcherWithResponse<BackgroundOperationResponse | Record<string, unknown>>(
      '/1.0/projects',
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    const operation = data.operation as string | undefined;
    if (operation) {
      await waitForOperation(operation, signal);
    }

    return { operation };
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return { error: 'Request was cancelled.' };
    }
    const message = getErrorMessage(err, 'Network error');
    return { error: message };
  }
}

export async function updateProject(
  payload: UpdateProjectBody,
  signal?: AbortSignal,
): Promise<{ project: Project; renamedFrom?: string }> {
  throwIfAborted(signal);
  const currentName = payload.currentName.trim();
  const nextName = payload.name.trim();
  const nextDescription = payload.description?.trim() || '';
  const nextConfig = payload.config ?? {};

  const { project: currentProject, etag } = await getProject(currentName, signal);
  throwIfAborted(signal);

  let updateData: BackgroundOperationResponse;
  try {
    const result = await jsonFetcherWithResponse<BackgroundOperationResponse>(
      `/1.0/projects/${encodeURIComponent(currentName)}`,
      {
        method: 'PUT',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: JSON.stringify({
          description: nextDescription,
          config: nextConfig,
        }),
      },
    );
    updateData = result.data;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new Error(getErrorMessage(error, `Unable to update project ${currentProject.name}`));
  }

  if (updateData.operation) {
    await waitForOperation(updateData.operation, signal);
  }

  const updatedProject: Project = {
    ...currentProject,
    name: currentName,
    description: nextDescription || undefined,
    config: nextConfig,
  };

  if (nextName !== currentName) {
    // Incus applies config/description updates and renames through separate operations.
    // If the rename fails after the PUT succeeds, callers surface a partial-failure state
    // so the UI can reflect the already-persisted settings without pretending the rename
    // succeeded.
    let renameData: BackgroundOperationResponse;
    try {
      const result = await jsonFetcherWithResponse<BackgroundOperationResponse>(
        `/1.0/projects/${encodeURIComponent(currentName)}`,
        {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: nextName,
          }),
        },
      );
      renameData = result.data;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const renameError = getErrorMessage(error, `Unable to rename project ${currentName}`);
      throw new ProjectRenamePartialFailureError(
        `Project settings were updated, but rename failed: ${renameError}`,
        updatedProject,
      );
    }

    if (renameData.operation) {
      try {
        await waitForOperation(renameData.operation, signal);
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        const renameError =
          error instanceof Error ? error.message : `Unable to rename project ${currentName}`;
        throw new ProjectRenamePartialFailureError(
          `Project settings were updated, but rename failed: ${renameError}`,
          updatedProject,
        );
      }
    }
  }

  return {
    project: {
      ...updatedProject,
      name: nextName,
    },
    renamedFrom: nextName !== currentName ? currentName : undefined,
  };
}
