import useSWR from 'swr';
import { jsonFetcher } from '@/app/_lib/fetcher';
import { useContext, useMemo } from 'react';
import ProjectsContext from '@/app/(main)/_context/projects';
import { buildApiPath } from '@/app/_lib/url';

export interface NetworkAddress {
  family: string;
  address: string;
  netmask: string;
}

export interface Network {
  name: string;
  description: string;
  type: string;
  config: Record<string, string>;
  managed: boolean;
  status: string;
  locations?: string[];
  used_by?: string[];
}

async function fetchNetworks(url: string): Promise<Network[]> {
  const res = await jsonFetcher<Network[]>(url);
  return res.metadata;
}

export function useNetworks(project?: string | null) {
  // Default to globally selected project when not explicitly provided
  const { effectiveProject } = useContext(ProjectsContext);
  const scopedProject = useMemo(
    () => (project === undefined ? effectiveProject : project),
    [project, effectiveProject],
  );

  const url = useMemo(
    () =>
      buildApiPath('/1.0/networks', {
        project: scopedProject ?? null,
        params: { recursion: 1 },
      }),
    [scopedProject],
  );

  const { data, error, isLoading, isValidating, mutate } = useSWR<Network[]>(
    url,
    fetchNetworks,
  );

  return {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
  };
}

export function useAllNetworks() {
  return useSWR<Network[]>('/1.0/networks?recursion=1', fetchNetworks);
}
