import useSWR, { type SWRConfiguration } from 'swr';
import { Instance } from '../../instances/_lib/instances.d';
import { StandardResponse } from '../../../_lib/response';
import { jsonFetcher } from '../../../_lib/fetcher';

export function getInstanceCacheKey(name: string | null) {
  return name ? `/1.0/instances/${encodeURIComponent(name)}?recursion=1` : null;
}

export function useInstance(
  name: string | null,
  config?: SWRConfiguration<StandardResponse<Instance>>,
) {
  const { data, error, isLoading, mutate, isValidating } = useSWR<
    StandardResponse<Instance>
  >(
    getInstanceCacheKey(name),
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

export function useInstanceAccess(name: string | null) {
  const { data, error, isLoading, isValidating } = useSWR<
    StandardResponse<string[]>
  >(name ? `/1.0/instances/${name}/access` : null, (url: string) =>
    jsonFetcher<string[]>(url),
  );

  return {
    access: data?.metadata,
    isLoading,
    isValidating,
    isError: error,
  };
}
