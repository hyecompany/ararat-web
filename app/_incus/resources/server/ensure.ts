import { processConfigurableOptions } from '@/app/_lib/server';
import { debugIncusData } from '../../debug';
import { resourceKeys } from '../../resources';
import { shouldFetchStoredStatus } from '../../status';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import { requestJson } from '../../transport';
import type { ConfigurableOptions, ResourcesMetadata, Server } from '../../types';

export async function ensureServerConfiguration(
  store: IncusStore,
  requests: RequestRegistry,
) {
  const cached = store.getSnapshot().state.server.configuration;
  if (!shouldFetchStoredStatus(cached.status)) return;

  await requests.run('server:configuration', [resourceKeys.serverConfiguration], async () => {
    try {
      const response = await requestJson<Server>('/1.0');
      store.update((state) => {
        state.server.configuration = { status: 'ready', data: response.metadata };
      }, [resourceKeys.serverConfiguration]);
    } catch (error) {
      store.update((state) => {
        state.server.configuration = {
          ...state.server.configuration,
          status: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to load server configuration.',
        };
      }, [resourceKeys.serverConfiguration]);
      debugIncusData('server.configuration:error', error);
    }
  });
}

export async function ensureConfigurableOptions(
  store: IncusStore,
  requests: RequestRegistry,
) {
  const cached = store.getSnapshot().state.server.configurableOptions;
  if (!shouldFetchStoredStatus(cached.status)) return;

  await requests.run(
    'server:configurable-options',
    [resourceKeys.configurableOptions],
    async () => {
      try {
        const response = await requestJson<ConfigurableOptions>(
          '/1.0/metadata/configuration',
        );
        processConfigurableOptions(response.metadata);
        store.update((state) => {
          state.server.configurableOptions = {
            status: 'ready',
            data: response.metadata,
          };
        }, [resourceKeys.configurableOptions]);
      } catch (error) {
        store.update((state) => {
          state.server.configurableOptions = {
            ...state.server.configurableOptions,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load configurable options.',
          };
        }, [resourceKeys.configurableOptions]);
        debugIncusData('server.configurableOptions:error', error);
      }
    },
  );
}

export async function ensureServerResources(
  store: IncusStore,
  requests: RequestRegistry,
) {
  const cached = store.getSnapshot().state.server.resources;
  if (!shouldFetchStoredStatus(cached.status)) return;

  await requests.run('server:resources', [resourceKeys.serverResources], async () => {
    try {
      const response = await requestJson<ResourcesMetadata>('/1.0/resources');
      store.update((state) => {
        state.server.resources = { status: 'ready', data: response.metadata };
      }, [resourceKeys.serverResources]);
    } catch (error) {
      store.update((state) => {
        state.server.resources = {
          ...state.server.resources,
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Unable to load resources.',
        };
      }, [resourceKeys.serverResources]);
      debugIncusData('server.resources:error', error);
    }
  });
}

export function createServerResource(store: IncusStore, requests: RequestRegistry) {
  return {
    ensureConfiguration: () => ensureServerConfiguration(store, requests),
    ensureConfigurableOptions: () => ensureConfigurableOptions(store, requests),
    ensureResources: () => ensureServerResources(store, requests),
  };
}
