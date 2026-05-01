/**
 * Delete an instance via DELETE /1.0/instances/{name}
 */
export async function deleteInstance(
  name: string,
  project: string | null,
): Promise<{ operation?: string; error?: string }> {
  const params = new URLSearchParams();
  if (project && project !== 'all') {
    params.set('project', project);
  }
  const url = `/1.0/instances/${encodeURIComponent(name)}${params.toString() ? `?${params.toString()}` : ''}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    let data: Record<string, unknown> = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      return {
        error:
          (data.error as string) ||
          `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    if (data.type === 'error') {
      return { error: (data.error as string) || 'Failed to delete instance' };
    }
    return { operation: data.operation as string | undefined };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { error: message };
  }
}

/**
 * Create a new instance via POST /1.0/instances
 */
export async function createInstance(
  payload: Record<string, unknown>,
  project: string | null,
): Promise<{ operation?: string; error?: string }> {
  const params = new URLSearchParams();
  if (project && project !== 'all') {
    params.set('project', project);
  }
  const url = `/1.0/instances${params.toString() ? `?${params.toString()}` : ''}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let data: Record<string, unknown> = {};
    // Try to parse JSON, even for error responses
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      return {
        error:
          (data.error as string) ||
          `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    if (data.type === 'error') {
      return { error: (data.error as string) || 'Failed to create instance' };
    }
    return { operation: data.operation as string | undefined };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { error: message };
  }
}

function importInstanceFromBackupXhr(
  url: string,
  backupFile: File,
  headers: Record<string, string>,
  onProgress?: (percent: number | null) => void,
): Promise<{ operation?: string; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.round((event.loaded / event.total) * 100));
      } else {
        onProgress?.(null);
      }
    };
    xhr.onerror = () => {
      onProgress?.(null);
      resolve({ error: 'Network error' });
    };
    xhr.onload = () => {
      onProgress?.(100);

      let data: Record<string, unknown> = {};
      try {
        data = xhr.responseText ? (JSON.parse(xhr.responseText) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }

      if (xhr.status < 200 || xhr.status >= 300) {
        resolve({
          error:
            (data.error as string) ||
            `HTTP ${xhr.status}: ${xhr.statusText}`,
        });
        return;
      }

      if (data.type === 'error') {
        resolve({
          error: (data.error as string) || 'Failed to import backup archive',
        });
        return;
      }

      resolve({ operation: data.operation as string | undefined });
    };

    xhr.send(backupFile);
  });
}

/**
 * Import a new instance from a backup archive via POST /1.0/instances.
 */
export async function importInstanceFromBackup(
  backupFile: File,
  options: {
    name: string;
    pool: string;
    project: string | null;
    onProgress?: (percent: number | null) => void;
  },
): Promise<{ operation?: string; error?: string }> {
  const params = new URLSearchParams();
  if (options.project && options.project !== 'all') {
    params.set('project', options.project);
  }

  const url = `/1.0/instances${params.toString() ? `?${params.toString()}` : ''}`;
  return importInstanceFromBackupXhr(
    url,
    backupFile,
    {
      'Content-Type': 'application/octet-stream',
      'X-Incus-name': options.name,
      'X-Incus-pool': options.pool,
    },
    options.onProgress,
  );
}
