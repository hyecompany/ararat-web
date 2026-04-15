'use client';

import { jsonFetcher } from '@/app/_lib/fetcher';

import type {
  ClusterGroup,
  NetworkIntegration,
  NetworkZone,
} from '@/app/(main)/_lib/configResources.d';
import type { Network } from '@/app/(main)/_hooks/networks';

export async function getClusterGroups() {
  return jsonFetcher<ClusterGroup[]>('/1.0/cluster/groups?recursion=1').then(
    (data) => data.metadata,
  );
}

export async function getAllNetworks() {
  return jsonFetcher<Network[]>('/1.0/networks?recursion=1').then(
    (data) => data.metadata,
  );
}

export async function getNetworkIntegrations() {
  return jsonFetcher<NetworkIntegration[]>('/1.0/network-integrations?recursion=1').then(
    (data) => data.metadata,
  );
}

export async function getNetworkZones() {
  return jsonFetcher<NetworkZone[]>('/1.0/network-zones?recursion=1').then(
    (data) => data.metadata,
  );
}
