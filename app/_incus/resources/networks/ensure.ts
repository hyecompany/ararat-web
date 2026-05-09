import { networkKey } from '../../keys';
import { resourceKeys } from '../../resources';
import {
  applyProjectSelection,
  collectionStatusKey,
  resolveProjectResourceScope,
  type IncusProjectSelection,
} from '../../scope';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type { Network } from '../../types';
import { ensureProjects } from '../projects/ensure';

export async function ensureNetworks(
  store: IncusStore,
  requests: RequestRegistry,
  selectedProject: IncusProjectSelection,
) {
  await ensureProjects(store, requests);

  const effectiveProject = resolveProjectResourceScope(
    store.getSnapshot().state,
    selectedProject,
    'networks',
  );
  const collectionKey = collectionStatusKey(effectiveProject);
  const collection =
    store.getSnapshot().state.networks.collection.byProject[collectionKey] ??
    store.getSnapshot().state.networks.collection.all;
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(
    `networks:${collectionKey}:collection`,
    [resourceKeys.networksCollection(collectionKey)],
    async () => {
      try {
        const params = new URLSearchParams({ recursion: '1' });
        applyProjectSelection(params, effectiveProject);
        const response = await requestJson<Network[]>('/1.0/networks', {
          params: Object.fromEntries(params.entries()),
        });

        store.update((state) => {
          state.networks.collection.byProject[collectionKey] = { status: 'ready' };
          for (const network of response.metadata) {
            const key = networkKey(
              network.project ?? (collectionKey === 'all' ? 'default' : collectionKey),
              network.name,
            );
            const item = state.networks.items[key] ?? store.ensureNetwork(key);
            item.metadata = { status: 'ready', data: network };
          }
        }, [
          resourceKeys.networksCollection(collectionKey),
          ...response.metadata.map((network) =>
            resourceKeys.networkMetadata(
              networkKey(
                network.project ?? (collectionKey === 'all' ? 'default' : collectionKey),
                network.name,
              ),
            ),
          ),
        ]);
      } catch (error) {
        store.update((state) => {
          state.networks.collection.byProject[collectionKey] = {
            status: 'error',
            error:
              error instanceof Error ? error.message : 'Unable to load networks.',
          };
        }, [resourceKeys.networksCollection(collectionKey)]);
      }
    },
  );
}

export function createNetworksResource(
  store: IncusStore,
  requests: RequestRegistry,
  getProject: () => string,
) {
  return {
    ensure: (project?: IncusProjectSelection) =>
      ensureNetworks(store, requests, project ?? getProject()),
  };
}
