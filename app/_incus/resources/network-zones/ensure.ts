import { resourceKeys } from '../../resources';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type { NetworkZone } from '../../types';

export async function ensureNetworkZones(
  store: IncusStore,
  requests: RequestRegistry,
) {
  const collection = store.getSnapshot().state.networkZones.collection;
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(
    'network-zones:collection',
    [resourceKeys.networkZonesCollection],
    async () => {
      try {
        const response = await requestJson<NetworkZone[]>('/1.0/network-zones', {
          params: { recursion: 1 },
        });
        store.update((state) => {
          state.networkZones.collection = { status: 'ready' };
          for (const zone of response.metadata) {
            const item = state.networkZones.items[zone.name] ??
              store.ensureNetworkZone(zone.name);
            item.metadata = { status: 'ready', data: zone };
          }
        }, [
          resourceKeys.networkZonesCollection,
          ...response.metadata.map((zone) =>
            resourceKeys.networkZoneMetadata(zone.name),
          ),
        ]);
      } catch (error) {
        store.update((state) => {
          state.networkZones.collection = {
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load network zones.',
          };
        }, [resourceKeys.networkZonesCollection]);
      }
    },
  );
}

export function createNetworkZonesResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensure: () => ensureNetworkZones(store, requests),
  };
}
