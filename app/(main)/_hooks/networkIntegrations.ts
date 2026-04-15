import useSWR from 'swr';

import { getNetworkIntegrations } from '@/app/(main)/_lib/networkIntegrations';

export function useNetworkIntegrations() {
  return useSWR('/1.0/network-integrations?recursion=1', getNetworkIntegrations);
}
