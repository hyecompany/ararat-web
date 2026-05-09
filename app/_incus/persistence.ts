'use client';

import { debugIncusData } from './debug';
import type {
  Cached,
  CollectionStatus,
  ImageItem,
  IncusStoreState,
  InstanceItem,
  NamedMetadataItem,
  NetworkItem,
  OperationItem,
  ProfileItem,
  ProjectItem,
  ScopedCollection,
  StorageBucketItem,
  StoragePoolItem,
  StorageVolumeItem,
} from './types';

const PERSISTENCE_KEY = 'ararat:incus-store:v1';
const PERSIST_DEBOUNCE_MS = 250;

type PersistedIncusState = {
  version: 1;
  savedAt: string;
  server?: IncusStoreState['server'];
  certificates?: IncusStoreState['certificates'];
  images?: IncusStoreState['images'];
  networks?: IncusStoreState['networks'];
  networkZones?: IncusStoreState['networkZones'];
  networkIntegrations?: IncusStoreState['networkIntegrations'];
  clusterGroups?: IncusStoreState['clusterGroups'];
  storagePools: IncusStoreState['storagePools'];
  projects?: IncusStoreState['projects'];
  profiles?: IncusStoreState['profiles'];
  operations?: IncusStoreState['operations'];
  instances?: IncusStoreState['instances'];
};

let pendingSave: number | undefined;

function staleCollection(collection: CollectionStatus): CollectionStatus {
  if (collection.status === 'missing') return { status: 'missing' };
  return { status: 'stale' };
}

function staleScopedCollection(collection: ScopedCollection): ScopedCollection {
  return {
    all: staleCollection(collection.all),
    byProject: Object.fromEntries(
      Object.entries(collection.byProject).map(([project, status]) => [
        project,
        staleCollection(status),
      ]),
    ),
  };
}

function staleCached<T>(cached: Cached<T>): Cached<T> {
  if (cached.data === undefined) return { status: 'missing' };
  return { status: 'stale', data: cached.data };
}

function staleStorageVolume(volume: StorageVolumeItem): StorageVolumeItem {
  return {
    metadata: staleCached(volume.metadata),
    state: staleCached(volume.state),
    snapshots: {
      collection: staleCollection(volume.snapshots.collection),
      items: Object.fromEntries(
        Object.entries(volume.snapshots.items).map(([name, snapshot]) => [
          name,
          { metadata: staleCached(snapshot.metadata) },
        ]),
      ),
    },
    backups: {
      collection: staleCollection(volume.backups.collection),
      items: Object.fromEntries(
        Object.entries(volume.backups.items).map(([name, backup]) => [
          name,
          { metadata: staleCached(backup.metadata) },
        ]),
      ),
    },
  };
}

function staleStorageBucket(bucket: StorageBucketItem): StorageBucketItem {
  return {
    metadata: staleCached(bucket.metadata),
    keys: {
      collection: staleCollection(bucket.keys.collection),
      items: Object.fromEntries(
        Object.entries(bucket.keys.items).map(([name, key]) => [
          name,
          { metadata: staleCached(key.metadata) },
        ]),
      ),
    },
    backups: {
      collection: staleCollection(bucket.backups.collection),
      items: Object.fromEntries(
        Object.entries(bucket.backups.items).map(([name, backup]) => [
          name,
          { metadata: staleCached(backup.metadata) },
        ]),
      ),
    },
  };
}

function staleStoragePool(pool: StoragePoolItem): StoragePoolItem {
  return {
    metadata: staleCached(pool.metadata),
    resources: staleCached(pool.resources),
    volumes: {
      collection: staleScopedCollection(pool.volumes.collection),
      items: Object.fromEntries(
        Object.entries(pool.volumes.items).map(([key, volume]) => [
          key,
          staleStorageVolume(volume),
        ]),
      ),
    },
    buckets: {
      collection: staleScopedCollection(pool.buckets.collection),
      items: Object.fromEntries(
        Object.entries(pool.buckets.items).map(([key, bucket]) => [
          key,
          staleStorageBucket(bucket),
        ]),
      ),
    },
  };
}

function staleProject(project: ProjectItem): ProjectItem {
  return {
    metadata: staleCached(project.metadata),
  };
}

function staleProfile(profile: ProfileItem): ProfileItem {
  return {
    metadata: staleCached(profile.metadata),
  };
}

function staleOperation(operation: OperationItem): OperationItem {
  return {
    metadata: staleCached(operation.metadata),
  };
}

function staleNamedMetadataItem<T>(
  item: NamedMetadataItem<T>,
): NamedMetadataItem<T> {
  return {
    metadata: staleCached(item.metadata),
  };
}

function staleImage(image: ImageItem): ImageItem {
  return {
    metadata: staleCached(image.metadata),
  };
}

function staleNetwork(network: NetworkItem): NetworkItem {
  return {
    metadata: staleCached(network.metadata),
  };
}

function staleInstance(instance: InstanceItem): InstanceItem {
  return {
    metadata: staleCached(instance.metadata),
    state: staleCached(instance.state),
    access: staleCached(instance.access),
    snapshots: {
      collection: staleCollection(instance.snapshots.collection),
      items: Object.fromEntries(
        Object.entries(instance.snapshots.items).map(([name, snapshot]) => [
          name,
          { metadata: staleCached(snapshot.metadata) },
        ]),
      ),
    },
    backups: {
      collection: staleCollection(instance.backups.collection),
      items: Object.fromEntries(
        Object.entries(instance.backups.items).map(([name, backup]) => [
          name,
          { metadata: staleCached(backup.metadata) },
        ]),
      ),
    },
    logs: {
      collection: staleCollection(instance.logs.collection),
      items: Object.fromEntries(
        Object.entries(instance.logs.items).map(([name, log]) => [
          name,
          {
            metadata: staleCached(log.metadata),
            content: staleCached(log.content),
          },
        ]),
      ),
    },
    files: {
      items: Object.fromEntries(
        Object.entries(instance.files.items).map(([path, file]) => [
          path,
          {
            metadata: staleCached(file.metadata),
            children: file.children
              ? {
                  status: file.children.status === 'missing' ? 'missing' : 'stale',
                  names: file.children.names,
                  error: file.children.error,
                }
              : undefined,
            content: file.content ? staleCached(file.content) : undefined,
          },
        ]),
      ),
    },
  };
}

function stalePersistedState(state: PersistedIncusState): Partial<IncusStoreState> {
  const projects = state.projects ?? {
    collection: { status: 'missing' as const },
    items: {},
  };
  const profiles = state.profiles ?? {
    collection: { all: { status: 'missing' as const }, byProject: {} },
    items: {},
  };
  const instances = state.instances ?? {
    collection: { all: { status: 'missing' as const }, byProject: {} },
    items: {},
  };
  const operations = state.operations ?? {
    collection: { status: 'missing' as const },
    items: {},
  };
  const server = state.server ?? {
    configuration: { status: 'missing' as const },
    configurableOptions: { status: 'missing' as const },
    resources: { status: 'missing' as const },
  };
  const certificates = state.certificates ?? { items: {} };
  const images = state.images ?? {
    collection: { all: { status: 'missing' as const }, byProject: {} },
    items: {},
  };
  const networks = state.networks ?? {
    collection: { all: { status: 'missing' as const }, byProject: {} },
    items: {},
  };
  const networkZones = state.networkZones ?? {
    collection: { status: 'missing' as const },
    items: {},
  };
  const networkIntegrations = state.networkIntegrations ?? {
    collection: { status: 'missing' as const },
    items: {},
  };
  const clusterGroups = state.clusterGroups ?? {
    collection: { status: 'missing' as const },
    items: {},
  };

  return {
    server: {
      configuration: staleCached(server.configuration),
      configurableOptions: staleCached(server.configurableOptions),
      resources: staleCached(server.resources),
    },
    certificates: {
      items: Object.fromEntries(
        Object.entries(certificates.items).map(([fingerprint, certificate]) => [
          fingerprint,
          staleNamedMetadataItem(certificate),
        ]),
      ),
    },
    images: {
      collection: staleScopedCollection(images.collection),
      items: Object.fromEntries(
        Object.entries(images.items).map(([key, image]) => [
          key,
          staleImage(image),
        ]),
      ),
    },
    networks: {
      collection: staleScopedCollection(networks.collection),
      items: Object.fromEntries(
        Object.entries(networks.items).map(([key, network]) => [
          key,
          staleNetwork(network),
        ]),
      ),
    },
    networkZones: {
      collection: staleCollection(networkZones.collection),
      items: Object.fromEntries(
        Object.entries(networkZones.items).map(([name, zone]) => [
          name,
          staleNamedMetadataItem(zone),
        ]),
      ),
    },
    networkIntegrations: {
      collection: staleCollection(networkIntegrations.collection),
      items: Object.fromEntries(
        Object.entries(networkIntegrations.items).map(([name, integration]) => [
          name,
          staleNamedMetadataItem(integration),
        ]),
      ),
    },
    clusterGroups: {
      collection: staleCollection(clusterGroups.collection),
      items: Object.fromEntries(
        Object.entries(clusterGroups.items).map(([name, group]) => [
          name,
          staleNamedMetadataItem(group),
        ]),
      ),
    },
    storagePools: {
      collection: staleCollection(state.storagePools.collection),
      items: Object.fromEntries(
        Object.entries(state.storagePools.items).map(([name, pool]) => [
          name,
          staleStoragePool(pool),
        ]),
      ),
    },
    projects: {
      collection: staleCollection(projects.collection),
      items: Object.fromEntries(
        Object.entries(projects.items).map(([name, project]) => [
          name,
          staleProject(project),
        ]),
      ),
    },
    profiles: {
      collection: staleScopedCollection(profiles.collection),
      items: Object.fromEntries(
        Object.entries(profiles.items).map(([key, profile]) => [
          key,
          staleProfile(profile),
        ]),
      ),
    },
    operations: {
      collection: staleCollection(operations.collection),
      items: Object.fromEntries(
        Object.entries(operations.items).map(([id, operation]) => [
          id,
          staleOperation(operation),
        ]),
      ),
    },
    instances: {
      collection: staleScopedCollection(instances.collection),
      items: Object.fromEntries(
        Object.entries(instances.items).map(([key, instance]) => [
          key,
          staleInstance(instance),
        ]),
      ),
    },
  };
}

export function loadPersistedIncusState() {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(PERSISTENCE_KEY);
    if (!raw) {
      debugIncusData('persistence:miss');
      return null;
    }

    const persisted = JSON.parse(raw) as PersistedIncusState;
    if (persisted.version !== 1) {
      debugIncusData('persistence:version-mismatch', persisted.version);
      return null;
    }

    const restored = stalePersistedState(persisted);
    debugIncusData('persistence:restored', {
      savedAt: persisted.savedAt,
      storagePoolCount: Object.keys(persisted.storagePools.items).length,
      imageCount: Object.keys(persisted.images?.items ?? {}).length,
      networkCount: Object.keys(persisted.networks?.items ?? {}).length,
      projectCount: Object.keys(persisted.projects?.items ?? {}).length,
      profileCount: Object.keys(persisted.profiles?.items ?? {}).length,
      operationCount: Object.keys(persisted.operations?.items ?? {}).length,
      instanceCount: Object.keys(persisted.instances?.items ?? {}).length,
    });
    return restored;
  } catch (error) {
    debugIncusData('persistence:load-error', error);
    return null;
  }
}

export function scheduleIncusStatePersistence(state: IncusStoreState) {
  if (typeof window === 'undefined') return;

  if (pendingSave !== undefined) {
    window.clearTimeout(pendingSave);
  }

  // Persistence is intentionally delayed so rapid data updates do not turn into
  // a burst of synchronous localStorage writes.
  pendingSave = window.setTimeout(() => {
      const payload: PersistedIncusState = {
        version: 1,
        savedAt: new Date().toISOString(),
        server: state.server,
        certificates: state.certificates,
        images: state.images,
        networks: state.networks,
        networkZones: state.networkZones,
        networkIntegrations: state.networkIntegrations,
        clusterGroups: state.clusterGroups,
        storagePools: state.storagePools,
      projects: state.projects,
      profiles: state.profiles,
      operations: state.operations,
      instances: state.instances,
    };

    try {
      window.localStorage.setItem(PERSISTENCE_KEY, JSON.stringify(payload));
      debugIncusData('persistence:saved', {
        storagePoolCount: Object.keys(state.storagePools.items).length,
        imageCount: Object.keys(state.images.items).length,
        networkCount: Object.keys(state.networks.items).length,
        projectCount: Object.keys(state.projects.items).length,
        profileCount: Object.keys(state.profiles.items).length,
        operationCount: Object.keys(state.operations.items).length,
        instanceCount: Object.keys(state.instances.items).length,
      });
    } catch (error) {
      debugIncusData('persistence:save-error', error);
    }
  }, PERSIST_DEBOUNCE_MS);
}
