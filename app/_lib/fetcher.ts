import type { StandardResponse, ErrorResponse } from '@/app/_lib/response.d';

async function parseJsonResponse<T extends object>(response: Response) {
  return (await response.json()) as T | ErrorResponse<unknown>;
}

export async function jsonFetcherWithResponse<T extends object = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
) {
  const endpoint = new URL(window.location.origin + url);
  return fetch(endpoint.toString(), init)
    .then((res) =>
      parseJsonResponse<T>(res).then((data) => {
        if ('type' in data && data.type == 'error') {
          throw {
            ...data,
          } as ErrorResponse<unknown>;
        }

        return {
          data: data as T,
          response: res,
        };
      }),
    );
}

export async function jsonFetcher<T extends object = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
) {
  return jsonFetcherWithResponse<StandardResponse<T>>(url, init).then(({ data }) => data);
}

export async function textFetcher(url: string, init?: RequestInit) {
  const endpoint = new URL(window.location.origin + url);
  const res = await fetch(endpoint.toString(), init);
  if (!res.ok) {
    throw new Error('Failed to fetch text content');
  }
  return res.text();
}
