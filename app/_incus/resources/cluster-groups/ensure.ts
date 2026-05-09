import { resourceKeys } from '../../resources';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type { ClusterGroup } from '../../types';

export async function ensureClusterGroups(
  store: IncusStore,
  requests: RequestRegistry,
) {
  const collection = store.getSnapshot().state.clusterGroups.collection;
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(
    'cluster-groups:collection',
    [resourceKeys.clusterGroupsCollection],
    async () => {
      try {
        const response = await requestJson<ClusterGroup[]>('/1.0/cluster/groups', {
          params: { recursion: 1 },
        });
        store.update((state) => {
          state.clusterGroups.collection = { status: 'ready' };
          for (const group of response.metadata) {
            const item = state.clusterGroups.items[group.name] ??
              store.ensureClusterGroup(group.name);
            item.metadata = { status: 'ready', data: group };
          }
        }, [
          resourceKeys.clusterGroupsCollection,
          ...response.metadata.map((group) =>
            resourceKeys.clusterGroupMetadata(group.name),
          ),
        ]);
      } catch (error) {
        store.update((state) => {
          state.clusterGroups.collection = {
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load cluster groups.',
          };
        }, [resourceKeys.clusterGroupsCollection]);
      }
    },
  );
}

export function createClusterGroupsResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensure: () => ensureClusterGroups(store, requests),
  };
}
