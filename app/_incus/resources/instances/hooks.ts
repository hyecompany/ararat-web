'use client';

import React from 'react';
import { debugIncusData } from '../../debug';
import { instanceKey } from '../../keys';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import { collectionStatusKey } from '../../scope';
import {
  combineResourceStatuses,
  deriveResourceStatus,
  resourceStatusFlags,
  shouldFetchStoredStatus,
} from '../../status';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';
import type { Instance } from '../../types';
import {
  ensureInstances,
  instanceKeysForProject,
  shellInstanceFromKey,
  splitInstanceKey,
  visibleInstanceKeys,
  type EnsureInstancesRequest,
  type InstanceInclude,
} from './ensure';

export type UseInstancesRequest = Omit<EnsureInstancesRequest, 'visibleKeys'> & {
  project?: string | null;
};

function keysForInstanceInclude(key: string, include: InstanceInclude) {
  return [
    ...(include.metadata !== false ? [resourceKeys.instanceMetadata(key)] : []),
    ...(include.state ? [resourceKeys.instanceState(key)] : []),
    ...(include.access ? [resourceKeys.instanceAccess(key)] : []),
  ];
}

export function useInstanceResource(
  name: string | null,
  project?: string | null,
  include: InstanceInclude = { metadata: true },
) {
  const client = useIncusClient();
  const selectedProject = project ?? 'default';
  const key = name ? instanceKey(selectedProject, name) : null;
  const subscriptionKeys = React.useMemo(
    () => (key ? keysForInstanceInclude(key, include) : []),
    [include.access, include.metadata, include.state, key],
  );
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    subscriptionKeys,
  );
  const item = key ? snapshot.state.instances.items[key] : undefined;
  const cached = item?.metadata;
  const instance =
    key && item && cached?.data ? shellInstanceFromKey(key, item) : undefined;

  React.useEffect(() => {
    if (!key) return;
    void ensureInstances(client.store, client.requestRegistry, selectedProject, {
      visibleKeys: [key],
      include,
      collection: false,
    }).catch(() => undefined);
  }, [client, include.access, include.metadata, include.state, key, selectedProject]);

  const metadataStatus = deriveResourceStatus({
    storedStatus: cached?.status ?? 'missing',
    hasData: instance !== undefined,
    inFlight: key ? hasInFlight(resourceKeys.instanceMetadata(key)) : false,
  });
  const childStatuses = [
    include.state
      ? deriveResourceStatus({
          storedStatus: item?.state.status ?? 'missing',
          hasData: item?.state.data !== undefined,
          inFlight: key ? hasInFlight(resourceKeys.instanceState(key)) : false,
        })
      : null,
    include.access
      ? deriveResourceStatus({
          storedStatus: item?.access.status ?? 'missing',
          hasData: item?.access.data !== undefined,
          inFlight: key ? hasInFlight(resourceKeys.instanceAccess(key)) : false,
        })
      : null,
  ].filter((status): status is ReturnType<typeof deriveResourceStatus> =>
    Boolean(status),
  );
  const status = combineResourceStatuses([metadataStatus, ...childStatuses]);
  const flags = resourceStatusFlags(status);
  const mutate = React.useCallback(async () => {
    if (!key) return;
    client.instances.markStale(key, include);
    await ensureInstances(client.store, client.requestRegistry, selectedProject, {
      visibleKeys: [key],
      include,
      collection: false,
    });
  }, [client, include.access, include.metadata, include.state, key, selectedProject]);

  return {
    instance,
    status,
    isLoading: Boolean(name) && flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
    isError:
      cached?.status === 'error'
        ? new Error(cached.error ?? 'Unable to load instance.')
        : null,
    mutate,
  };
}

export function useInstanceAccessResource(
  name: string | null,
  project?: string | null,
) {
  const client = useIncusClient();
  const selectedProject = project ?? 'default';
  const key = name ? instanceKey(selectedProject, name) : null;
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    key ? [resourceKeys.instanceAccess(key)] : [],
  );
  const cached = key ? snapshot.state.instances.items[key]?.access : undefined;

  React.useEffect(() => {
    if (!key) return;
    void ensureInstances(client.store, client.requestRegistry, selectedProject, {
      visibleKeys: [key],
      include: { metadata: false, access: true },
      collection: false,
    }).catch(() => undefined);
  }, [client, key, selectedProject]);

  const status = deriveResourceStatus({
    storedStatus: cached?.status ?? 'missing',
    hasData: cached?.data !== undefined,
    inFlight: key ? hasInFlight(resourceKeys.instanceAccess(key)) : false,
  });
  const flags = resourceStatusFlags(status);

  return {
    access: cached?.data,
    status,
    isLoading: Boolean(name) && flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
    isError:
      cached?.status === 'error'
        ? new Error(cached.error ?? 'Unable to load instance access.')
        : null,
  };
}

export function useInstancesResource(request: UseInstancesRequest = {}) {
  const client = useIncusClient();
  const selectedProject = request.project ?? client.getProject();
  const collectionKey = collectionStatusKey(selectedProject);
  const include = request.include ?? { metadata: true, state: true };
  const requestKey = JSON.stringify(request);
  const storeSnapshot = client.store.getSnapshot();
  const visibleKeys = React.useMemo(
    () => visibleInstanceKeys(client.store, selectedProject, request.visibleRange),
    [client, selectedProject, requestKey, storeSnapshot.version],
  );
  const visibleSignature = visibleKeys.join('|');
  const subscriptionKeys = React.useMemo(
    () => [
      resourceKeys.instancesCollection(collectionKey),
      ...visibleKeys.flatMap((key) => keysForInstanceInclude(key, include)),
    ],
    [collectionKey, include.access, include.metadata, include.state, visibleSignature],
  );
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    subscriptionKeys,
  );
  const collection =
    snapshot.state.instances.collection.byProject[collectionKey] ??
    snapshot.state.instances.collection.all;
  const visibleStatuses = React.useMemo(
    () =>
      visibleKeys.map((key) => {
        const item = snapshot.state.instances.items[key];
        return {
          key,
          metadata: item?.metadata.status ?? 'missing',
          state: item?.state.status ?? 'missing',
          access: item?.access.status ?? 'missing',
        };
      }),
    [snapshot, visibleSignature],
  );
  const statusSignature = [
    collection.status,
    ...visibleStatuses.map(
      ({ key, metadata, state, access }) =>
        `${key}:${metadata}:${state}:${access}`,
    ),
  ].join('|');

  React.useEffect(() => {
    const needsWork =
      shouldFetchStoredStatus(collection.status) ||
      visibleStatuses.some(
        ({ metadata, state, access }) =>
          (include.metadata !== false && shouldFetchStoredStatus(metadata)) ||
          (include.state && shouldFetchStoredStatus(state)) ||
          (include.access && shouldFetchStoredStatus(access)),
      );

    debugIncusData('instances.hook:ensure', {
      project: selectedProject,
      collection: collection.status,
      visible: visibleStatuses,
      totalKnownItems: Object.keys(snapshot.state.instances.items).length,
      needsWork,
      request,
    });

    if (!needsWork) return;

    void ensureInstances(client.store, client.requestRegistry, selectedProject, {
      include,
      visibleRange: request.visibleRange,
    });
  }, [
    client,
    include.access,
    include.metadata,
    include.state,
    requestKey,
    selectedProject,
    statusSignature,
  ]);

  const data = React.useMemo(
    () =>
      instanceKeysForProject(client.store, selectedProject).map((key) =>
        shellInstanceFromKey(key, snapshot.state.instances.items[key]),
      ),
    [client, selectedProject, snapshot],
  );

  const mutate = React.useCallback(async () => {
    client.store.update((state) => {
      state.instances.collection.byProject[collectionKey] = { status: 'stale' };
      for (const key of visibleKeys) {
        const item = state.instances.items[key];
        if (!item) continue;
        if (include.metadata !== false && item.metadata.status === 'ready') {
          item.metadata.status = 'stale';
        }
        if (include.state && item.state.status === 'ready') {
          item.state.status = 'stale';
        }
        if (include.access && item.access.status === 'ready') {
          item.access.status = 'stale';
        }
      }
    }, [
      resourceKeys.instancesCollection(collectionKey),
      ...visibleKeys.flatMap((key) => keysForInstanceInclude(key, include)),
    ]);
    await ensureInstances(client.store, client.requestRegistry, selectedProject, {
      include,
      visibleRange: request.visibleRange,
    });
  }, [
    client,
    collectionKey,
    include.access,
    include.metadata,
    include.state,
    request.visibleRange,
    selectedProject,
    visibleSignature,
  ]);

  const collectionStatus = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: data.length > 0,
    inFlight: hasInFlight(resourceKeys.instancesCollection(collectionKey)),
  });
  const visibleResourceStatuses = visibleKeys.flatMap((key) => {
    const item = snapshot.state.instances.items[key];
    return [
      include.metadata !== false
        ? deriveResourceStatus({
            storedStatus: item?.metadata.status ?? 'missing',
            hasData: item?.metadata.data !== undefined,
            inFlight: hasInFlight(resourceKeys.instanceMetadata(key)),
          })
        : null,
      include.state
        ? deriveResourceStatus({
            storedStatus: item?.state.status ?? 'missing',
            hasData: item?.state.data !== undefined,
            inFlight: hasInFlight(resourceKeys.instanceState(key)),
          })
        : null,
      include.access
        ? deriveResourceStatus({
            storedStatus: item?.access.status ?? 'missing',
            hasData: item?.access.data !== undefined,
            inFlight: hasInFlight(resourceKeys.instanceAccess(key)),
          })
        : null,
    ].filter((status): status is ReturnType<typeof deriveResourceStatus> =>
      Boolean(status),
    );
  });
  const status = combineResourceStatuses([
    collectionStatus,
    ...visibleResourceStatuses,
  ]);
  const flags = resourceStatusFlags(status);

  return {
    data,
    error: collection.status === 'error' ? new Error(collection.error ?? '') : null,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
    mutate,
  };
}
