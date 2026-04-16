import useSWR from 'swr';

import { getClusterGroups } from '@/app/(main)/_lib/clusters';

export function useClusterGroups() {
  return useSWR('/1.0/cluster/groups?recursion=1', getClusterGroups);
}
