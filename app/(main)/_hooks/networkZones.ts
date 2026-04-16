import useSWR from 'swr';

import { getNetworkZones } from '@/app/(main)/_lib/networkZones';

export function useNetworkZones() {
  return useSWR('/1.0/network-zones?recursion=1', getNetworkZones);
}
