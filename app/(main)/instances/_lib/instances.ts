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
