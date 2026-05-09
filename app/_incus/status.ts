import type { CacheStatus, ResourceStatus } from './types';

export function shouldFetchStoredStatus(status: CacheStatus) {
  return status === 'missing' || status === 'stale' || status === 'error';
}

export function deriveResourceStatus({
  storedStatus,
  hasData,
  inFlight,
}: {
  storedStatus: CacheStatus;
  hasData: boolean;
  inFlight: boolean;
}): ResourceStatus {
  if (!inFlight) return storedStatus;
  if (!hasData) return 'loading';
  if (storedStatus === 'stale' || storedStatus === 'error') return 'refreshing';
  return storedStatus;
}

export function resourceStatusFlags(status: ResourceStatus) {
  return {
    isLoading: status === 'loading',
    isStale: status === 'stale',
    isRefreshing: status === 'refreshing',
  };
}

export function combineResourceStatuses(statuses: ResourceStatus[]): ResourceStatus {
  if (statuses.includes('loading')) return 'loading';
  if (statuses.includes('refreshing')) return 'refreshing';
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('stale')) return 'stale';
  if (statuses.includes('missing')) return 'missing';
  return 'ready';
}
