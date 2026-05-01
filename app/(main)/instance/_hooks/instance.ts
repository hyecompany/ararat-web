import useSWR, { type SWRConfiguration } from 'swr';
import { Instance } from '../../instances/_lib/instances.d';
import { StandardResponse } from '../../../_lib/response';
import { jsonFetcher } from '../../../_lib/fetcher';
import { buildApiPath } from '@/app/_lib/url';

export function getInstanceCacheKey(
  name: string | null,
  project?: string | null,
) {
  return name
    ? buildApiPath(`/1.0/instances/${encodeURIComponent(name)}`, {
        project: project ?? null,
        params: { recursion: 1 },
      })
    : null;
}

export function useInstance(
  name: string | null,
  project?: string | null,
  config?: SWRConfiguration<StandardResponse<Instance>>,
) {
  const { data, error, isLoading, mutate, isValidating } = useSWR<
    StandardResponse<Instance>
  >(
    getInstanceCacheKey(name, project),
    (url) => jsonFetcher<Instance>(url),
    config,
  );

  return {
    instance: data?.metadata,
    isLoading,
    isValidating,
    isError: error,
    mutate,
  };
}

export function useInstanceAccess(name: string | null, project?: string | null) {
  const { data, error, isLoading, isValidating } = useSWR<
    StandardResponse<string[]>
  >(
    name
      ? buildApiPath(`/1.0/instances/${encodeURIComponent(name)}/access`, {
          project: project ?? null,
        })
      : null,
    (url: string) =>
    jsonFetcher<string[]>(url),
  );

  return {
    access: data?.metadata,
    isLoading,
    isValidating,
    isError: error,
  };
}
