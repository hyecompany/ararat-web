import { resourceKeys } from '../../resources';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type { NetworkIntegration } from '../../types';

export async function ensureNetworkIntegrations(
  store: IncusStore,
  requests: RequestRegistry,
) {
  const collection = store.getSnapshot().state.networkIntegrations.collection;
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(
    'network-integrations:collection',
    [resourceKeys.networkIntegrationsCollection],
    async () => {
      try {
        const response = await requestJson<NetworkIntegration[]>(
          '/1.0/network-integrations',
          { params: { recursion: 1 } },
        );
        store.update((state) => {
          state.networkIntegrations.collection = { status: 'ready' };
          for (const integration of response.metadata) {
            const item = state.networkIntegrations.items[integration.name] ??
              store.ensureNetworkIntegration(integration.name);
            item.metadata = { status: 'ready', data: integration };
          }
        }, [
          resourceKeys.networkIntegrationsCollection,
          ...response.metadata.map((integration) =>
            resourceKeys.networkIntegrationMetadata(integration.name),
          ),
        ]);
      } catch (error) {
        store.update((state) => {
          state.networkIntegrations.collection = {
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load network integrations.',
          };
        }, [resourceKeys.networkIntegrationsCollection]);
      }
    },
  );
}

export function createNetworkIntegrationsResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensure: () => ensureNetworkIntegrations(store, requests),
  };
}
