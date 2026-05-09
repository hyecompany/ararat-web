'use client';

import { resourceKeys } from './resources';
import type { IncusStore } from './store';

// When the websocket drops, event-managed data is no longer provably current.
// We keep the data visible and mark only loaded `ready` entries stale, so active
// hooks can refresh their exact resources after reconnect without blanking UI.
export function markAllEventManagedDataStale(store: IncusStore) {
  const changedKeys = new Set<string>([resourceKeys.events]);
  const snapshot = store.getSnapshot().state;
  const storagePools = snapshot.storagePools;

  if (snapshot.server.configuration.status === 'ready') {
    changedKeys.add(resourceKeys.serverConfiguration);
  }
  if (snapshot.server.configurableOptions.status === 'ready') {
    changedKeys.add(resourceKeys.configurableOptions);
  }
  if (snapshot.server.resources.status === 'ready') {
    changedKeys.add(resourceKeys.serverResources);
  }
  for (const [fingerprint, item] of Object.entries(snapshot.certificates.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.certificateMetadata(fingerprint));
    }
  }
  for (const [project, collection] of Object.entries(
    snapshot.images.collection.byProject,
  )) {
    if (collection.status === 'ready') {
      changedKeys.add(resourceKeys.imagesCollection(project));
    }
  }
  for (const [key, item] of Object.entries(snapshot.images.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.imageMetadata(key));
    }
  }
  for (const [project, collection] of Object.entries(
    snapshot.networks.collection.byProject,
  )) {
    if (collection.status === 'ready') {
      changedKeys.add(resourceKeys.networksCollection(project));
    }
  }
  for (const [key, item] of Object.entries(snapshot.networks.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.networkMetadata(key));
    }
  }
  if (snapshot.networkZones.collection.status === 'ready') {
    changedKeys.add(resourceKeys.networkZonesCollection);
  }
  for (const [name, item] of Object.entries(snapshot.networkZones.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.networkZoneMetadata(name));
    }
  }
  if (snapshot.networkIntegrations.collection.status === 'ready') {
    changedKeys.add(resourceKeys.networkIntegrationsCollection);
  }
  for (const [name, item] of Object.entries(snapshot.networkIntegrations.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.networkIntegrationMetadata(name));
    }
  }
  if (snapshot.clusterGroups.collection.status === 'ready') {
    changedKeys.add(resourceKeys.clusterGroupsCollection);
  }
  for (const [name, item] of Object.entries(snapshot.clusterGroups.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.clusterGroupMetadata(name));
    }
  }

  if (storagePools.collection.status === 'ready') {
    changedKeys.add(resourceKeys.storagePoolsCollection);
  }

  for (const [name, item] of Object.entries(storagePools.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.storagePoolMetadata(name));
    }
    if (item.resources.status === 'ready') {
      changedKeys.add(resourceKeys.storagePoolResources(name));
    }
    for (const [project, collection] of Object.entries(
      item.volumes.collection.byProject,
    )) {
      if (collection.status === 'ready') {
        changedKeys.add(resourceKeys.storagePoolVolumesCollection(name, project));
      }
    }
    for (const [volumeKey, volume] of Object.entries(item.volumes.items)) {
      if (volume.metadata.status === 'ready') {
        changedKeys.add(resourceKeys.storageVolumeMetadata(name, volumeKey));
      }
      if (volume.state.status === 'ready') {
        changedKeys.add(resourceKeys.storageVolumeState(name, volumeKey));
      }
    }
    for (const [project, collection] of Object.entries(
      item.buckets.collection.byProject,
    )) {
      if (collection.status === 'ready') {
        changedKeys.add(resourceKeys.storagePoolBucketsCollection(name, project));
      }
    }
    for (const [bucketKey, bucket] of Object.entries(item.buckets.items)) {
      if (bucket.metadata.status === 'ready') {
        changedKeys.add(resourceKeys.storageBucketMetadata(name, bucketKey));
      }
    }
  }

  for (const [project, collection] of Object.entries(
    snapshot.instances.collection.byProject,
  )) {
    if (collection.status === 'ready') {
      changedKeys.add(resourceKeys.instancesCollection(project));
    }
  }
  for (const [key, item] of Object.entries(snapshot.instances.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.instanceMetadata(key));
    }
    if (item.state.status === 'ready') {
      changedKeys.add(resourceKeys.instanceState(key));
    }
    if (item.access.status === 'ready') {
      changedKeys.add(resourceKeys.instanceAccess(key));
    }
  }
  if (snapshot.operations.collection.status === 'ready') {
    changedKeys.add(resourceKeys.operationsCollection);
  }
  for (const [id, item] of Object.entries(snapshot.operations.items)) {
    if (item.metadata.status === 'ready') {
      changedKeys.add(resourceKeys.operationMetadata(id));
    }
  }

  store.update((state) => {
    state.events.status = 'disconnected';
    if (state.server.configuration.status === 'ready') {
      state.server.configuration.status = 'stale';
    }
    if (state.server.configurableOptions.status === 'ready') {
      state.server.configurableOptions.status = 'stale';
    }
    if (state.server.resources.status === 'ready') {
      state.server.resources.status = 'stale';
    }
    for (const item of Object.values(state.certificates.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
    }
    for (const collection of Object.values(state.images.collection.byProject)) {
      if (collection.status === 'ready') collection.status = 'stale';
    }
    for (const item of Object.values(state.images.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
    }
    for (const collection of Object.values(state.networks.collection.byProject)) {
      if (collection.status === 'ready') collection.status = 'stale';
    }
    for (const item of Object.values(state.networks.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
    }
    if (state.networkZones.collection.status === 'ready') {
      state.networkZones.collection.status = 'stale';
    }
    for (const item of Object.values(state.networkZones.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
    }
    if (state.networkIntegrations.collection.status === 'ready') {
      state.networkIntegrations.collection.status = 'stale';
    }
    for (const item of Object.values(state.networkIntegrations.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
    }
    if (state.clusterGroups.collection.status === 'ready') {
      state.clusterGroups.collection.status = 'stale';
    }
    for (const item of Object.values(state.clusterGroups.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
    }
    if (state.storagePools.collection.status === 'ready') {
      state.storagePools.collection.status = 'stale';
    }
    for (const item of Object.values(state.storagePools.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
      if (item.resources.status === 'ready') item.resources.status = 'stale';
      for (const collection of Object.values(item.volumes.collection.byProject)) {
        if (collection.status === 'ready') collection.status = 'stale';
      }
      for (const volume of Object.values(item.volumes.items)) {
        if (volume.metadata.status === 'ready') volume.metadata.status = 'stale';
        if (volume.state.status === 'ready') volume.state.status = 'stale';
      }
      for (const collection of Object.values(item.buckets.collection.byProject)) {
        if (collection.status === 'ready') collection.status = 'stale';
      }
      for (const bucket of Object.values(item.buckets.items)) {
        if (bucket.metadata.status === 'ready') bucket.metadata.status = 'stale';
      }
    }
    for (const collection of Object.values(state.instances.collection.byProject)) {
      if (collection.status === 'ready') collection.status = 'stale';
    }
    for (const item of Object.values(state.instances.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
      if (item.state.status === 'ready') item.state.status = 'stale';
      if (item.access.status === 'ready') item.access.status = 'stale';
    }
    if (state.operations.collection.status === 'ready') {
      state.operations.collection.status = 'stale';
    }
    for (const item of Object.values(state.operations.items)) {
      if (item.metadata.status === 'ready') item.metadata.status = 'stale';
    }
  }, Array.from(changedKeys));
}
