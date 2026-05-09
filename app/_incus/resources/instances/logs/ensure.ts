'use client';

import { instanceKey } from '../../../keys';
import { resourceKeys } from '../../../resources';
import type { RequestRegistry } from '../../../requests';
import type { IncusStore } from '../../../store';
import { shouldFetchStoredStatus } from '../../../status';
import { requestJson, requestText } from '../../../transport';

export type InstanceLogsRequest = {
  instanceName: string;
  project?: string | null;
};

export type InstanceLogContentRequest = InstanceLogsRequest & {
  filename: string;
};

export function logIdentity(request: InstanceLogsRequest) {
  const project = request.project ?? 'default';
  const key = instanceKey(project, request.instanceName);
  return {
    project,
    key,
    collectionKey: resourceKeys.instanceLogsCollection(key),
  };
}

function logNameFromPath(path: string) {
  return decodeURIComponent(path.split('/').filter(Boolean).pop() ?? path);
}

async function requestLogList(instanceName: string, project: string) {
  const response = await requestJson<string[]>(
    `/1.0/instances/${encodeURIComponent(instanceName)}/logs`,
    { params: { project } },
  );
  return response.metadata.map(logNameFromPath);
}

export async function ensureInstanceLogs(
  store: IncusStore,
  requests: RequestRegistry,
  request: InstanceLogsRequest,
) {
  const { project, key, collectionKey } = logIdentity(request);
  const collection =
    store.getSnapshot().state.instances.items[key]?.logs.collection ??
    { status: 'missing' as const };
  if (!shouldFetchStoredStatus(collection.status)) return;

  await requests.run(`instance:logs:${key}`, [collectionKey], async () => {
    try {
      const logs = await requestLogList(request.instanceName, project);
      store.update((state) => {
        const instance = state.instances.items[key] ?? store.ensureInstance(key);
        instance.logs.collection = { status: 'ready' };
        for (const log of logs) {
          instance.logs.items[log] ??= {
            metadata: { status: 'missing' },
            content: { status: 'missing' },
          };
          instance.logs.items[log].metadata = {
            status: 'ready',
            data: { name: log },
          };
        }
      }, [
        collectionKey,
        ...logs.map((log) => resourceKeys.instanceLogMetadata(key, log)),
      ]);
    } catch (error) {
      store.update((state) => {
        const instance = state.instances.items[key] ?? store.ensureInstance(key);
        instance.logs.collection = {
          status: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Unable to load instance logs.',
        };
      }, [collectionKey]);
    }
  });
}

export async function ensureInstanceLogContent(
  store: IncusStore,
  requests: RequestRegistry,
  request: InstanceLogContentRequest,
) {
  const { project, key } = logIdentity(request);
  const storeKey = resourceKeys.instanceLogContent(key, request.filename);
  const cached =
    store.getSnapshot().state.instances.items[key]?.logs.items[request.filename]
      ?.content;
  if (!shouldFetchStoredStatus(cached?.status ?? 'missing')) return;

  await requests.run(
    `instance:log-content:${key}:${request.filename}`,
    [storeKey],
    async () => {
      try {
        const content = await requestText(
          `/1.0/instances/${encodeURIComponent(request.instanceName)}/logs/${encodeURIComponent(request.filename)}`,
          { params: { project } },
        );
        store.update((state) => {
          const instance = state.instances.items[key] ?? store.ensureInstance(key);
          instance.logs.items[request.filename] ??= {
            metadata: {
              status: 'ready',
              data: { name: request.filename },
            },
            content: { status: 'missing' },
          };
          instance.logs.items[request.filename].content = {
            status: 'ready',
            data: content,
          };
        }, [storeKey]);
      } catch (error) {
        store.update((state) => {
          const instance = state.instances.items[key] ?? store.ensureInstance(key);
          instance.logs.items[request.filename] ??= {
            metadata: { status: 'missing' },
            content: { status: 'missing' },
          };
          instance.logs.items[request.filename].content = {
            ...instance.logs.items[request.filename].content,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Unable to load instance log.',
          };
        }, [storeKey]);
      }
    },
  );
}

export function markInstanceLogsStale(
  store: IncusStore,
  request: InstanceLogsRequest,
) {
  const { key, collectionKey } = logIdentity(request);
  store.update((state) => {
    const instance = state.instances.items[key] ?? store.ensureInstance(key);
    instance.logs.collection = {
      status: Object.keys(instance.logs.items).length ? 'stale' : 'missing',
    };
  }, [collectionKey]);
}

export function createInstanceLogsResource(
  store: IncusStore,
  requests: RequestRegistry,
) {
  return {
    ensure: (request: InstanceLogsRequest) =>
      ensureInstanceLogs(store, requests, request),
    ensureContent: (request: InstanceLogContentRequest) =>
      ensureInstanceLogContent(store, requests, request),
    delete: async (request: InstanceLogContentRequest) => {
      const { project, key, collectionKey } = logIdentity(request);
      await requestJson<unknown>(
        `/1.0/instances/${encodeURIComponent(request.instanceName)}/logs/${encodeURIComponent(request.filename)}`,
        {
          params: { project },
          init: { method: 'DELETE' },
        },
      );

      store.update((state) => {
        const instance = state.instances.items[key];
        if (!instance) return;
        delete instance.logs.items[request.filename];
        instance.logs.collection = {
          status: Object.keys(instance.logs.items).length ? 'stale' : 'missing',
        };
      }, [
        collectionKey,
        resourceKeys.instanceLogMetadata(key, request.filename),
        resourceKeys.instanceLogContent(key, request.filename),
      ]);
    },
    markStale: (request: InstanceLogsRequest) =>
      markInstanceLogsStale(store, request),
  };
}
