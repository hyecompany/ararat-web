import type { CacheStatus, ResourceStatus } from './types';

export function shouldFetchStoredStatus(status: CacheStatus) {
  return status === 'missing' || status === 'stale' || status === 'error';
}

export function isUnavailableResourceStatus(status: ResourceStatus) {
  return status === 'missing' || status === 'loading';
}

export function isStaleResourceStatus(status: ResourceStatus) {
  return status === 'stale' || status === 'refreshing';
}

export function isFetchingResourceStatus(status: ResourceStatus) {
  return status === 'loading' || status === 'refreshing';
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
    // UI-facing code should treat `missing/loading` as one unavailable state
    // and `stale/refreshing` as one stale-data state. The split remains useful
    // internally for request concurrency, but components should not need to
    // duplicate those pair checks.
    isLoading: isUnavailableResourceStatus(status),
    isStale: isStaleResourceStatus(status),
    isFetching: isFetchingResourceStatus(status),
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
