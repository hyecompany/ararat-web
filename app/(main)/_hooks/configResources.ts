import useSWR from 'swr';

import {
  getAllNetworks,
  getClusterGroups,
  getNetworkIntegrations,
  getNetworkZones,
} from '@/app/(main)/_lib/configResources';

export function useClusterGroups() {
  return useSWR('/1.0/cluster/groups?recursion=1', getClusterGroups);
}

export function useAllNetworks() {
  return useSWR('/1.0/networks?recursion=1', getAllNetworks);
}

export function useNetworkIntegrations() {
  return useSWR('/1.0/network-integrations?recursion=1', getNetworkIntegrations);
}

export function useNetworkZones() {
  return useSWR('/1.0/network-zones?recursion=1', getNetworkZones);
}
