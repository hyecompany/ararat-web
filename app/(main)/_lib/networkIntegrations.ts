'use client';

import { jsonFetcher } from '@/app/_lib/fetcher';

import type { NetworkIntegration } from '@/app/(main)/_lib/networkIntegrations.d';

export async function getNetworkIntegrations() {
  return jsonFetcher<NetworkIntegration[]>('/1.0/network-integrations?recursion=1').then(
    (data) => data.metadata,
  );
}
