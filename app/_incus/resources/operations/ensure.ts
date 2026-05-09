import { mapWithConcurrency } from '../../concurrency';
import { debugIncusData } from '../../debug';
import { resourceKeys } from '../../resources';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type { IncusOperation } from '../../types';

type OperationListBuckets = Record<string, (string | IncusOperation)[]>;
type OperationsMetadata = IncusOperation[] | OperationListBuckets | IncusOperation;

type OperationsResponse = {
  metadata: OperationsMetadata;
};

function hasOperationId(value: unknown): value is IncusOperation {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { id?: unknown }).id === 'string',
  );
}

async function resolveOperations(metadata: OperationsMetadata) {
  if (Array.isArray(metadata)) {
    return metadata.filter(hasOperationId);
  }

  if (hasOperationId(metadata)) {
    return [metadata];
  }

  if (!metadata || typeof metadata !== 'object') return [];

  const entries = Object.values(metadata).flat();
  const inlineOperations = entries.filter(hasOperationId);
  const detailPaths = Array.from(
    new Set(entries.filter((entry): entry is string => typeof entry === 'string')),
  );

  if (!detailPaths.length) return inlineOperations;

  const fetchedOperations = await mapWithConcurrency(detailPaths, 6, async (path) => {
    const response = await requestJson<IncusOperation>(path);
    return response.metadata;
  });

  return [...inlineOperations, ...fetchedOperations.filter(hasOperationId)];
}

export function sortedOperations(operations: IncusOperation[]) {
  return [...operations].sort((a, b) => {
    const dateA = new Date(a.created_at ?? a.updated_at ?? 0).getTime();
    const dateB = new Date(b.created_at ?? b.updated_at ?? 0).getTime();
    return dateB - dateA;
  });
}

export async function ensureOperations(
  store: IncusStore,
  requests: RequestRegistry,
) {
  const status = store.getSnapshot().state.operations.collection.status;
  if (!shouldFetchStoredStatus(status)) return;

  debugIncusData('operations.ensure:fetch', { from: status });

  await requests.run(
    'operations:collection',
    [resourceKeys.operationsCollection],
    async () => {
      try {
        const response = await requestJson<OperationsResponse['metadata']>(
          '/1.0/operations',
          {
            params: { recursion: 1, 'all-projects': true },
          },
        );
        const operations = await resolveOperations(response.metadata);

        store.update((state) => {
          state.operations.collection = { status: 'ready' };
          const seen = new Set<string>();
          for (const operation of operations) {
            seen.add(operation.id);
            const item = state.operations.items[operation.id] ??
              store.ensureOperation(operation.id);
            item.metadata = { status: 'ready', data: operation };
          }
          for (const id of Object.keys(state.operations.items)) {
            if (!seen.has(id)) delete state.operations.items[id];
          }
        }, [
          resourceKeys.operationsCollection,
          ...operations.map((operation) =>
            resourceKeys.operationMetadata(operation.id),
          ),
        ]);
        debugIncusData('operations.ensure:ready', {
          count: operations.length,
        });
      } catch (error) {
        store.update((state) => {
          state.operations.collection = {
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load operations.',
          };
        }, [resourceKeys.operationsCollection]);
        debugIncusData('operations.ensure:error', error);
      }
    },
  );
}

export function createOperationsResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensureList: () => ensureOperations(store, requests),
    wait: async (
      operation: string,
      options: { project?: string | null; signal?: AbortSignal; timeoutSeconds?: number } = {},
    ) => {
      const waitUrl = new URL(`${operation}/wait`, window.location.origin);
      waitUrl.searchParams.set('timeout', String(options.timeoutSeconds ?? 30));
      if (options.project && !waitUrl.searchParams.has('project')) {
        waitUrl.searchParams.set('project', options.project);
      }

      const response = await requestJson<{
        status?: string;
        status_code?: number;
        err?: string;
      }>(`${waitUrl.pathname}${waitUrl.search}`, {
        init: { signal: options.signal },
      });
      const metadata = response.metadata;
      if (metadata.status_code === 400 || metadata.status === 'Failure') {
        throw new Error(metadata.err || 'Operation failed.');
      }
      if (metadata.status_code === 401 || metadata.status === 'Cancelled') {
        throw new Error(metadata.err || 'Operation was cancelled.');
      }
      return metadata;
    },
    cancel: async (id: string) => {
      await requestJson<unknown>(`/1.0/operations/${encodeURIComponent(id)}`, {
        init: { method: 'DELETE' },
      });
      store.update((state) => {
        const item = state.operations.items[id];
        if (item && item.metadata.status === 'ready') {
          item.metadata.status = 'stale';
        }
        if (state.operations.collection.status === 'ready') {
          state.operations.collection.status = 'stale';
        }
      }, [
        resourceKeys.operationsCollection,
        resourceKeys.operationMetadata(id),
      ]);
    },
  };
}
