import type {
  BackgroundOperationResponse,
  ErrorResponse,
  StandardResponse,
} from '@/app/_lib/response.d';

type QueryValue = string | number | boolean | null | undefined;

export type RequestJsonOptions = {
  params?: Record<string, QueryValue>;
  init?: RequestInit;
};

function buildUrl(path: string, params?: Record<string, QueryValue>) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

async function parseResponse<T>(response: Response) {
  const data = (await response.json()) as StandardResponse<T> | ErrorResponse<unknown>;
  if (!response.ok || data.type === 'error') {
    // Every Incus caller should get the same error shape. Keeping this parser in
    // one place prevents each resource hook from inventing slightly different
    // "what failed?" behavior.
    const message =
      'error' in data && data.error
        ? data.error
        : `Incus request failed with status ${response.status}`;
    throw new Error(message);
  }
  return data as StandardResponse<T>;
}

async function parseAnyJsonResponse<T>(response: Response) {
  const data = (await response.json().catch(() => ({}))) as
    | T
    | ErrorResponse<unknown>;
  const isObject = typeof data === 'object' && data !== null;
  if (!response.ok || (isObject && 'type' in data && data.type === 'error')) {
    const message =
      isObject && 'error' in data && typeof data.error === 'string' && data.error
        ? data.error
        : `Incus request failed with status ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function requestJson<T>(
  path: string,
  options?: RequestJsonOptions,
) {
  const url = buildUrl(path, options?.params);
  const response = await fetch(url.toString(), options?.init);
  return parseResponse<T>(response);
}

export async function requestIncusJson<T>(
  path: string,
  options?: RequestJsonOptions,
) {
  const url = buildUrl(path, options?.params);
  const response = await fetch(url.toString(), options?.init);
  return parseAnyJsonResponse<T>(response);
}

export async function requestOperation(
  path: string,
  options?: RequestJsonOptions,
) {
  return requestIncusJson<BackgroundOperationResponse | StandardResponse<unknown>>(
    path,
    options,
  );
}

export async function requestText(path: string, options?: RequestJsonOptions) {
  const url = buildUrl(path, options?.params);
  const response = await fetch(url.toString(), options?.init);
  if (!response.ok) {
    throw new Error(`Incus text request failed with status ${response.status}`);
  }
  return response.text();
}

export async function requestBlob(path: string, options?: RequestJsonOptions) {
  const url = buildUrl(path, options?.params);
  const response = await fetch(url.toString(), options?.init);
  if (!response.ok) {
    throw new Error(`Incus blob request failed with status ${response.status}`);
  }
  return response.blob();
}

export async function requestRaw(path: string, options?: RequestJsonOptions) {
  const url = buildUrl(path, options?.params);
  const response = await fetch(url.toString(), options?.init);
  if (!response.ok) {
    throw new Error(`Incus raw request failed with status ${response.status}`);
  }
  return response;
}

export function requestUpload(
  path: string,
  body: BodyInit,
  options: {
    headers?: Record<string, string>;
    params?: Record<string, QueryValue>;
    onProgress?: (loaded: number, total: number | null) => void;
  } = {},
) {
  const url = buildUrl(path, options.params);
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url.toString());
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      xhr.setRequestHeader(key, value);
    }
    xhr.responseType = 'text';
    xhr.upload.onprogress = (event) => {
      options.onProgress?.(
        event.loaded,
        event.lengthComputable ? event.total : null,
      );
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      try {
        const payload = JSON.parse(xhr.responseText || '{}') as { error?: string };
        reject(new Error(payload.error || xhr.statusText || `HTTP ${xhr.status}`));
      } catch {
        reject(new Error(xhr.responseText || xhr.statusText || `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(body as XMLHttpRequestBodyInit);
  });
}
