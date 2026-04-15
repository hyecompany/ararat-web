'use client';

import { jsonFetcher } from '@/app/_lib/fetcher';

import type { NetworkZone } from '@/app/(main)/_lib/networkZones.d';

export async function getNetworkZones() {
  return jsonFetcher<NetworkZone[]>('/1.0/network-zones?recursion=1').then(
    (data) => data.metadata,
  );
}
