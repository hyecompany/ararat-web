import type { Device, Instance } from '@/app/(main)/instances/_lib/instances.d';
import type { BackgroundOperationResponse, StandardResponse } from '@/app/_lib/response.d';
import { instanceKey } from '../../keys';
import { resourceKeys } from '../../resources';
import type { RequestRegistry } from '../../requests';
import type { IncusStore } from '../../store';
import {
  requestIncusJson,
  requestOperation,
  requestText,
} from '../../transport';

type OperationLike = BackgroundOperationResponse | StandardResponse<unknown>;
type InstanceRef = { name: string; project?: string | null };
export type InstanceAction = 'start' | 'stop' | 'restart' | 'freeze';
export type AdvancedInstanceRebuildSource =
  | { type: 'none' }
  | {
      type: 'image';
      fingerprint?: string;
      alias?: string;
      server?: string;
      mode?: 'pull';
      protocol?: 'simplestreams' | 'oci';
    };
export interface CloneInstanceInput {
  instance: Instance;
  name: string;
  targetProject: string;
  rootStoragePool: string;
  allowInconsistent: boolean;
  instanceOnly: boolean;
}

function operationPath(payload: OperationLike | null | undefined) {
  const maybeOperation = payload as { operation?: unknown } | null | undefined;
  return typeof maybeOperation?.operation === 'string'
    ? maybeOperation.operation
    : undefined;
}

function websocketUrl(operation: string, secret: string) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${window.location.host}${operation}/websocket?secret=${secret}`;
}

function operationWebsockets(payload: OperationLike) {
  const operation = operationPath(payload);
  const fds =
    ((payload as { metadata?: { metadata?: unknown } }).metadata?.metadata as
      | { fds?: Record<string, string> }
      | undefined)?.fds ?? {};
  const websockets = operation
    ? Object.fromEntries(
        Object.entries(fds).map(([key, secret]) => [
          key,
          websocketUrl(operation, secret),
        ]),
      )
    : {};
  return { operation, websockets };
}

function projectParams(project?: string | null) {
  return project && project !== 'all' ? { project } : undefined;
}

function projectFromInstance(instance: Instance) {
  return instance.project ?? 'default';
}

function instanceStoreKey(instance: Instance) {
  return instanceKey(projectFromInstance(instance), instance.name);
}

function buildInstanceUpdateBody({
  instance,
  nextConfig,
  nextDevices,
  nextProfiles,
}: {
  instance: Instance;
  nextConfig?: Record<string, string>;
  nextDevices?: Record<string, Device>;
  nextProfiles?: string[];
}) {
  return {
    ...(instance.architecture ? { architecture: instance.architecture } : {}),
    ...(instance.description !== undefined
      ? { description: instance.description }
      : {}),
    ...(instance.ephemeral !== undefined ? { ephemeral: instance.ephemeral } : {}),
    ...(instance.location ? { location: instance.location } : {}),
    config: nextConfig ?? instance.config ?? {},
    devices: nextDevices ?? ((instance.devices as Record<string, Device>) ?? {}),
    profiles: nextProfiles ?? instance.profiles ?? ['default'],
  };
}

async function waitForOperation(
  operation: string | undefined,
  project?: string | null,
  signal?: AbortSignal,
) {
  if (!operation) return;
  const waitUrl = new URL(`${operation}/wait`, window.location.origin);
  waitUrl.searchParams.set('timeout', '30');
  if (project && !waitUrl.searchParams.has('project')) {
    waitUrl.searchParams.set('project', project);
  }
  const response = await requestIncusJson<StandardResponse<{
    status?: string;
    status_code?: number;
    err?: string;
  }>>(`${waitUrl.pathname}${waitUrl.search}`, { init: { signal } });
  const metadata = response.metadata;
  if (metadata.status_code === 400 || metadata.status === 'Failure') {
    throw new Error(metadata.err || 'Operation failed.');
  }
  if (metadata.status_code === 401 || metadata.status === 'Cancelled') {
    throw new Error(metadata.err || 'Operation was cancelled.');
  }
}

function markInstanceTouched(store: IncusStore, instance: Instance) {
  const key = instanceStoreKey(instance);
  store.update((state) => {
    const item = state.instances.items[key] ?? store.ensureInstance(key);
    if (item.metadata.data) item.metadata.status = 'stale';
    if (item.state.data) item.state.status = 'stale';
    if (item.access.data) item.access.status = 'stale';
    const collection = state.instances.collection.byProject[projectFromInstance(instance)];
    if (collection?.status === 'ready') collection.status = 'stale';
    if (state.instances.collection.byProject.all?.status === 'ready') {
      state.instances.collection.byProject.all.status = 'stale';
    }
  }, [
    resourceKeys.instancesCollection(projectFromInstance(instance)),
    resourceKeys.instancesCollection('all'),
    resourceKeys.instanceMetadata(key),
    resourceKeys.instanceState(key),
    resourceKeys.instanceAccess(key),
  ]);
}

export function createInstanceActionsResource(
  store: IncusStore,
  _requests: RequestRegistry,
) {
  const createConsoleConnection = async ({
    instance,
    type = 'console',
    width,
    height,
    force,
  }: {
    instance: InstanceRef;
    type?: 'vga' | 'console';
    width?: number;
    height?: number;
    force?: boolean;
  }) => {
    const body: Record<string, boolean | number | string> = {
      type,
      'wait-for-websocket': true,
    };
    if (force) body.force = true;
    if (type === 'console') {
      if (width) body.width = width;
      if (height) body.height = height;
    }

    const response = await requestOperation(
      `/1.0/instances/${encodeURIComponent(instance.name)}/console`,
      {
        params: projectParams(instance.project),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      },
    );
    return operationWebsockets(response);
  };

  return {
    create: async (
      payload: Record<string, unknown>,
      project?: string | null,
    ) => {
      const response = await requestOperation('/1.0/instances', {
        params: projectParams(project),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      });
      const operation = operationPath(response);
      await waitForOperation(operation, project);
      store.update((state) => {
        const collectionKey = project ?? 'default';
        const collection = state.instances.collection.byProject[collectionKey];
        if (collection?.status === 'ready') collection.status = 'stale';
        if (state.instances.collection.byProject.all?.status === 'ready') {
          state.instances.collection.byProject.all.status = 'stale';
        }
      }, [
        resourceKeys.instancesCollection(project ?? 'default'),
        resourceKeys.instancesCollection('all'),
      ]);
      return { operation };
    },

    importFromBackup: (
      backupFile: File,
      options: {
        name: string;
        pool: string;
        project: string | null;
        onProgress?: (percent: number | null) => void;
      },
    ) =>
      new Promise<{ operation?: string; error?: string }>((resolve) => {
        const params = new URLSearchParams();
        if (options.project && options.project !== 'all') {
          params.set('project', options.project);
        }
        const url = new URL('/1.0/instances', window.location.origin);
        for (const [key, value] of params) url.searchParams.set(key, value);
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url.toString());
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-Incus-name', options.name);
        xhr.setRequestHeader('X-Incus-pool', options.pool);
        xhr.responseType = 'text';
        xhr.upload.onprogress = (event) => {
          options.onProgress?.(
            event.lengthComputable && event.total > 0
              ? Math.round((event.loaded / event.total) * 100)
              : null,
          );
        };
        xhr.onerror = () => {
          options.onProgress?.(null);
          resolve({ error: 'Network error' });
        };
        xhr.onload = () => {
          options.onProgress?.(100);
          let data: Record<string, unknown> = {};
          try {
            data = xhr.responseText
              ? (JSON.parse(xhr.responseText) as Record<string, unknown>)
              : {};
          } catch {
            data = {};
          }
          if (xhr.status < 200 || xhr.status >= 300 || data.type === 'error') {
            resolve({
              error:
                (data.error as string) ||
                xhr.statusText ||
                'Failed to import backup archive',
            });
            return;
          }
          resolve({ operation: data.operation as string | undefined });
        };
        xhr.send(backupFile);
      }),

    setState: async ({
      action,
      force = false,
      instance,
    }: {
      action: InstanceAction;
      force?: boolean;
      instance: Instance;
    }) => {
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(instance.name)}/state`,
        {
          params: projectParams(projectFromInstance(instance)),
          init: {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action,
              timeout: 30,
              force,
              stateful: false,
            }),
          },
        },
      );
      await waitForOperation(operationPath(response), projectFromInstance(instance));
      markInstanceTouched(store, instance);
      return response;
    },

    delete: async (instance: Instance, force = false) => {
      if (force) {
        await requestOperation(
          `/1.0/instances/${encodeURIComponent(instance.name)}/state`,
          {
            params: projectParams(projectFromInstance(instance)),
            init: {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'stop',
                timeout: 30,
                force: true,
                stateful: false,
              }),
            },
          },
        ).then((response) =>
          waitForOperation(operationPath(response), projectFromInstance(instance)),
        );
      }
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(instance.name)}`,
        {
          params: projectParams(projectFromInstance(instance)),
          init: { method: 'DELETE' },
        },
      );
      await waitForOperation(operationPath(response), projectFromInstance(instance));
      store.removeInstance(instanceStoreKey(instance));
      return response;
    },

    rebuild: async ({
      instance,
      source,
    }: {
      instance: Instance;
      source: AdvancedInstanceRebuildSource;
    }) => {
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(instance.name)}/rebuild`,
        {
          params: projectParams(projectFromInstance(instance)),
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source }),
          },
        },
      );
      await waitForOperation(operationPath(response), projectFromInstance(instance));
      markInstanceTouched(store, instance);
      return response;
    },

    repair: async ({
      instance,
      action,
    }: {
      instance: Instance;
      action: 'rebuild-config-volume';
    }) => {
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(instance.name)}/debug/repair`,
        {
          params: projectParams(projectFromInstance(instance)),
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          },
        },
      );
      await waitForOperation(operationPath(response), projectFromInstance(instance));
      markInstanceTouched(store, instance);
      return response;
    },

    clone: async ({
      instance,
      name,
      targetProject,
      rootStoragePool,
      allowInconsistent,
      instanceOnly,
    }: CloneInstanceInput) => {
      const sourceRootDevice =
        (instance.expanded_devices?.root as Device | undefined) ??
        (instance.devices?.root as Device | undefined);
      const response = await requestOperation('/1.0/instances', {
        params: projectParams(targetProject),
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            type: instance.type,
            devices: {
              root: {
                ...(sourceRootDevice ?? {}),
                type: sourceRootDevice?.type ?? 'disk',
                path: sourceRootDevice?.path ?? '/',
                pool: rootStoragePool.trim(),
              },
            },
            source: {
              type: 'copy',
              source: instance.name,
              project: projectFromInstance(instance),
              allow_inconsistent: allowInconsistent,
              instance_only: instanceOnly,
            },
          }),
        },
      });
      await waitForOperation(operationPath(response), targetProject);
      return response;
    },

    createConsoleConnection,

    openConsoleSocket: async (
      request: {
        instance: InstanceRef;
        type?: 'vga' | 'console';
        width?: number;
        height?: number;
        force?: boolean;
      },
    ) => {
      const connection = await createConsoleConnection(request);
      const dataUrl = connection.websockets['0'];
      const controlUrl = connection.websockets.control;
      if (!dataUrl || !controlUrl) {
        throw new Error('Console connection did not return the expected websocket endpoints.');
      }
      return {
        data: new WebSocket(dataUrl),
        control: new WebSocket(controlUrl),
      };
    },

    openExecSocket: async ({
      instance,
      command,
    }: {
      instance: InstanceRef;
      command: string[];
    }) => {
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(instance.name)}/exec`,
        {
          params: projectParams(instance.project),
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command,
              interactive: true,
              'wait-for-websocket': true,
            }),
          },
        },
      );
      const connection = operationWebsockets(response);
      const dataUrl = connection.websockets['0'];
      const controlUrl = connection.websockets.control;
      if (!dataUrl || !controlUrl) {
        throw new Error('Exec connection did not return the expected websocket endpoints.');
      }
      return {
        data: new WebSocket(dataUrl),
        control: new WebSocket(controlUrl),
      };
    },

    getConsoleOutput: ({
      instance,
      type,
    }: {
      instance: InstanceRef;
      type?: 'log' | 'vga';
    }) =>
      requestText(`/1.0/instances/${encodeURIComponent(instance.name)}/console`, {
        params: {
          ...projectParams(instance.project),
          ...(type ? { type } : {}),
        },
      }),

    updateSettings: async ({
      instance,
      nextConfig,
      nextDevices,
      nextProfiles,
      signal,
    }: {
      instance: Instance;
      nextConfig?: Record<string, string>;
      nextDevices?: Record<string, Device>;
      nextProfiles?: string[];
      signal?: AbortSignal;
    }) => {
      const response = await requestOperation(
        `/1.0/instances/${encodeURIComponent(instance.name)}`,
        {
          params: projectParams(projectFromInstance(instance)),
          init: {
            method: 'PUT',
            signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(
              buildInstanceUpdateBody({
                instance,
                nextConfig,
                nextDevices,
                nextProfiles,
              }),
            ),
          },
        },
      );
      await waitForOperation(operationPath(response), projectFromInstance(instance), signal);
      markInstanceTouched(store, instance);
      return {
        instance: {
          ...instance,
          config: nextConfig ?? instance.config,
          devices: nextDevices ?? instance.devices,
          profiles: nextProfiles ?? instance.profiles,
        },
        operation: response,
      };
    },

    updateMetadata: async ({
      instance,
      nextName,
      nextDescription,
      signal,
    }: {
      instance: Instance;
      nextName: string;
      nextDescription: string;
      signal?: AbortSignal;
    }) => {
      const normalizedName = nextName.trim();
      const normalizedDescription = nextDescription.trim();
      const didRename = normalizedName !== instance.name;
      const didChangeDescription =
        normalizedDescription !== (instance.description ?? '');

      if (didChangeDescription) {
        await requestIncusJson<StandardResponse<unknown>>(
          `/1.0/instances/${encodeURIComponent(instance.name)}`,
          {
            params: projectParams(projectFromInstance(instance)),
            init: {
              method: 'PATCH',
              signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ description: normalizedDescription }),
            },
          },
        );
      }

      const renameResponse = didRename
        ? await requestOperation(
            `/1.0/instances/${encodeURIComponent(instance.name)}`,
            {
              params: projectParams(projectFromInstance(instance)),
              init: {
                method: 'POST',
                signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: normalizedName,
                  migration: false,
                }),
              },
            },
          )
        : null;

      await waitForOperation(
        operationPath(renameResponse),
        projectFromInstance(instance),
        signal,
      );

      const oldKey = instanceStoreKey(instance);
      const nextInstance = {
        ...instance,
        name: normalizedName,
        description: normalizedDescription || undefined,
      };
      const nextKey = instanceStoreKey(nextInstance);
      store.update((state) => {
        if (didRename && state.instances.items[oldKey]) {
          state.instances.items[nextKey] = state.instances.items[oldKey];
          delete state.instances.items[oldKey];
        }
        const item = state.instances.items[nextKey] ?? store.ensureInstance(nextKey);
        item.metadata = {
          ...item.metadata,
          status: item.metadata.data ? 'ready' : 'missing',
          data: item.metadata.data
            ? { ...item.metadata.data, name: normalizedName, description: normalizedDescription }
            : item.metadata.data,
        };
        const collection = state.instances.collection.byProject[projectFromInstance(instance)];
        if (collection?.status === 'ready') collection.status = 'stale';
        if (state.instances.collection.byProject.all?.status === 'ready') {
          state.instances.collection.byProject.all.status = 'stale';
        }
      }, [
        resourceKeys.instancesCollection(projectFromInstance(instance)),
        resourceKeys.instancesCollection('all'),
        resourceKeys.instanceMetadata(oldKey),
        resourceKeys.instanceMetadata(nextKey),
      ]);

      return {
        instance: nextInstance,
        renameOperation: renameResponse,
      };
    },
  };
}
