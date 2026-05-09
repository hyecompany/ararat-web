import { useClusterGroupsResource } from '@/app/_incus/resources/cluster-groups/hooks';

export function useClusterGroups() {
  return useClusterGroupsResource();
}
