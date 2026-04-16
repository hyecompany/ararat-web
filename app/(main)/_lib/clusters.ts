'use client';

import { jsonFetcher } from '@/app/_lib/fetcher';

import type { ClusterGroup } from '@/app/(main)/_lib/clusters.d';

export async function getClusterGroups() {
  return jsonFetcher<ClusterGroup[]>('/1.0/cluster/groups?recursion=1').then(
    (data) => data.metadata,
  );
}
