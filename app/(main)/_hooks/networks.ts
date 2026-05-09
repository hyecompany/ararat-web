import { useContext, useMemo } from 'react';
import ProjectsContext from '@/app/(main)/_context/projects';
import { useNetworksResource } from '@/app/_incus/resources/networks/hooks';

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

export function useNetworks(project?: string | null) {
  // Default to globally selected project when not explicitly provided
  const { effectiveProject } = useContext(ProjectsContext);
  const scopedProject = useMemo(
    () => (project === undefined ? effectiveProject : project),
    [project, effectiveProject],
  );

  return useNetworksResource(scopedProject);
}

export function useAllNetworks() {
  return useNetworksResource('default');
}
