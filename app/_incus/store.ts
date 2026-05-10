import type {
  CacheStatus,
  Certificate,
  ClusterGroup,
  Cached,
  CollectionStatus,
  ImageItem,
  IncusStoreState,
  InstanceFileMetadata,
  InstanceItem,
  NamedMetadataItem,
  NetworkIntegration,
  NetworkItem,
  NetworkZone,
  OperationItem,
  ScopedCollection,
  StorageBucketItem,
  StoragePoolItem,
  StorageVolumeItem,
  ProjectItem,
  ProfileItem,
} from './types';
import { resourceKeys, type IncusStoreKey } from './resources';

export type IncusStoreSnapshot = {
  version: number;
  state: IncusStoreState;
};

export type IncusScopedStoreSnapshot = {
  version: string;
  state: IncusStoreState;
};

const missingCollection = (): CollectionStatus => ({ status: 'missing' });

const missingScopedCollection = (): ScopedCollection => ({
  all: missingCollection(),
  byProject: {},
});

export function missingCached<T>(): Cached<T> {
  return { status: 'missing' };
}

function createStorageVolumeItem(): StorageVolumeItem {
  return {
    metadata: missingCached(),
    state: missingCached(),
    snapshots: { collection: missingCollection(), items: {} },
    backups: { collection: missingCollection(), items: {} },
  };
}

function createStorageBucketItem(): StorageBucketItem {
  return {
    metadata: missingCached(),
    keys: { collection: missingCollection(), items: {} },
    backups: { collection: missingCollection(), items: {} },
  };
}

function createStoragePoolItem(): StoragePoolItem {
  return {
    metadata: missingCached(),
    resources: missingCached(),
    volumes: { collection: missingScopedCollection(), items: {} },
    buckets: { collection: missingScopedCollection(), items: {} },
  };
}

function createProjectItem(): ProjectItem {
  return {
    metadata: missingCached(),
  };
}

function createProfileItem(): ProfileItem {
  return {
    metadata: missingCached(),
  };
}

function createOperationItem(): OperationItem {
  return {
    metadata: missingCached(),
  };
}

function createNamedMetadataItem<T>(): NamedMetadataItem<T> {
  return {
    metadata: missingCached(),
  };
}

function createImageItem(): ImageItem {
  return {
    metadata: missingCached(),
  };
}

function createNetworkItem(): NetworkItem {
  return {
    metadata: missingCached(),
  };
}

function createInstanceItem(): InstanceItem {
  return {
    metadata: missingCached(),
    state: missingCached(),
    access: missingCached(),
    snapshots: { collection: missingCollection(), items: {} },
    backups: { collection: missingCollection(), items: {} },
    logs: { collection: missingCollection(), items: {} },
    files: { items: {} },
  };
}

function createInitialState(): IncusStoreState {
  return {
    events: { status: 'connecting' },
    server: {
      configuration: missingCached(),
      configurableOptions: missingCached(),
      resources: missingCached(),
    },
    certificates: {
      items: {},
    },
    images: {
      collection: missingScopedCollection(),
      items: {},
    },
    networks: {
      collection: missingScopedCollection(),
      items: {},
    },
    networkZones: {
      collection: missingCollection(),
      items: {},
    },
    networkIntegrations: {
      collection: missingCollection(),
      items: {},
    },
    clusterGroups: {
      collection: missingCollection(),
      items: {},
    },
    storagePools: {
      collection: missingCollection(),
      items: {},
    },
    projects: {
      collection: missingCollection(),
      items: {},
    },
    profiles: {
      collection: missingScopedCollection(),
      items: {},
    },
    operations: {
      collection: missingCollection(),
      items: {},
    },
    instances: {
      collection: missingScopedCollection(),
      items: {},
    },
  };
}

const emptyHydrationState = createInitialState();
const emptyHydrationSnapshotCache = new Map<string, IncusScopedStoreSnapshot>();

export function getEmptyHydrationSnapshotForKeys(
  keys: IncusStoreKey[],
): IncusScopedStoreSnapshot {
  const signature = keys.map((key) => `${key}:0`).join('|');
  const cached = emptyHydrationSnapshotCache.get(signature);
  if (cached) return cached;

  // Client store singletons can already contain persisted data before a new
  // route hydrates. The server snapshot fallback must stay empty so React sees
  // identical markup on the server render and the first client render; normal
  // subscriptions replace it with the restored cache immediately after hydrate.
  const snapshot = {
    version: signature,
    state: emptyHydrationState,
  };
  emptyHydrationSnapshotCache.set(signature, snapshot);
  return snapshot;
}

export class IncusStore {
  private version = 0;
  private keyVersions = new Map<IncusStoreKey, number>();
  private scopedSnapshotCache = new Map<string, IncusScopedStoreSnapshot>();
  private state = createInitialState();
  private snapshot: IncusStoreSnapshot = { version: this.version, state: this.state };
  private allListeners = new Set<() => void>();
  private keyListeners = new Map<IncusStoreKey, Set<() => void>>();

  // React cannot safely read a mutable singleton directly during concurrent
  // rendering. `useSyncExternalStore` solves that by subscribing to this method
  // and asking for a versioned snapshot whenever the store notifies listeners.
  subscribeAll = (listener: () => void) => {
    this.allListeners.add(listener);
    // Hydration can restore persisted data before a component subscribes. Queue a
    // notification so React reconciles from its SSR fallback snapshot to the
    // already-restored client snapshot immediately after subscription.
    queueMicrotask(listener);
    return () => {
      this.allListeners.delete(listener);
    };
  };

  subscribeKeys = (keys: IncusStoreKey[], listener: () => void) => {
    for (const key of keys) {
      const listeners = this.keyListeners.get(key) ?? new Set<() => void>();
      listeners.add(listener);
      this.keyListeners.set(key, listeners);
    }

    queueMicrotask(listener);
    return () => {
      for (const key of keys) {
        this.keyListeners.get(key)?.delete(listener);
      }
    };
  };

  getSnapshot = () => this.snapshot;

  getSnapshotForKeys = (keys: IncusStoreKey[]) => {
    const signature = keys
      .map((key) => `${key}:${this.keyVersions.get(key) ?? 0}`)
      .join('|');
    const cached = this.scopedSnapshotCache.get(signature);
    if (cached) return cached;

    // React hooks subscribe to the exact resource keys they render. The returned
    // snapshot still exposes the normalized store, but its version only changes
    // when one of those keys changes, which keeps unrelated Incus events from
    // waking large parts of the UI.
    const snapshot: IncusScopedStoreSnapshot = {
      version: signature,
      state: this.state,
    };
    this.scopedSnapshotCache.set(signature, snapshot);
    return snapshot;
  };

  update(mutator: (state: IncusStoreState) => void, keys: IncusStoreKey[]) {
    // The store is intentionally mutated in one place and exposed through a new
    // snapshot object. That keeps updates cheap for large Incus collections while
    // still giving React a stable "something changed" signal.
    mutator(this.state);
    this.version += 1;
    for (const key of keys) {
      this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
    }
    this.snapshot = { version: this.version, state: this.state };
    this.scopedSnapshotCache.clear();

    const listenersToNotify = new Set<() => void>(this.allListeners);
    for (const key of keys) {
      for (const listener of this.keyListeners.get(key) ?? []) {
        listenersToNotify.add(listener);
      }
    }

    for (const listener of listenersToNotify) {
      listener();
    }
  }

  hydrate(partialState: Partial<IncusStoreState>) {
    this.update((state) => {
      if (partialState.storagePools) {
        state.storagePools = partialState.storagePools;
      }
      if (partialState.server) {
        state.server = partialState.server;
      }
      if (partialState.certificates) {
        state.certificates = partialState.certificates;
      }
      if (partialState.images) {
        state.images = partialState.images;
      }
      if (partialState.networks) {
        state.networks = partialState.networks;
      }
      if (partialState.networkZones) {
        state.networkZones = partialState.networkZones;
      }
      if (partialState.networkIntegrations) {
        state.networkIntegrations = partialState.networkIntegrations;
      }
      if (partialState.clusterGroups) {
        state.clusterGroups = partialState.clusterGroups;
      }
      if (partialState.projects) {
        state.projects = partialState.projects;
      }
      if (partialState.profiles) {
        state.profiles = partialState.profiles;
      }
      if (partialState.operations) {
        state.operations = partialState.operations;
      }
      if (partialState.instances) {
        state.instances = partialState.instances;
      }
    }, [
      ...(partialState.storagePools
        ? [
            resourceKeys.storagePoolsCollection,
            ...Object.keys(partialState.storagePools.items).flatMap((name) => [
              resourceKeys.storagePoolMetadata(name),
              resourceKeys.storagePoolResources(name),
            ]),
          ]
        : []),
      ...(partialState.server
        ? [
            resourceKeys.serverConfiguration,
            resourceKeys.configurableOptions,
            resourceKeys.serverResources,
          ]
        : []),
      ...(partialState.certificates
        ? Object.keys(partialState.certificates.items).map(
            resourceKeys.certificateMetadata,
          )
        : []),
      ...(partialState.images
        ? [
            ...Object.keys(partialState.images.collection.byProject).map(
              resourceKeys.imagesCollection,
            ),
            ...Object.keys(partialState.images.items).map(
              resourceKeys.imageMetadata,
            ),
          ]
        : []),
      ...(partialState.networks
        ? [
            ...Object.keys(partialState.networks.collection.byProject).map(
              resourceKeys.networksCollection,
            ),
            ...Object.keys(partialState.networks.items).map(
              resourceKeys.networkMetadata,
            ),
          ]
        : []),
      ...(partialState.networkZones
        ? [
            resourceKeys.networkZonesCollection,
            ...Object.keys(partialState.networkZones.items).map(
              resourceKeys.networkZoneMetadata,
            ),
          ]
        : []),
      ...(partialState.networkIntegrations
        ? [
            resourceKeys.networkIntegrationsCollection,
            ...Object.keys(partialState.networkIntegrations.items).map(
              resourceKeys.networkIntegrationMetadata,
            ),
          ]
        : []),
      ...(partialState.clusterGroups
        ? [
            resourceKeys.clusterGroupsCollection,
            ...Object.keys(partialState.clusterGroups.items).map(
              resourceKeys.clusterGroupMetadata,
            ),
          ]
        : []),
      ...(partialState.projects
        ? [
            resourceKeys.projectsCollection,
            ...Object.keys(partialState.projects.items).map(
              resourceKeys.projectMetadata,
            ),
          ]
        : []),
      ...(partialState.profiles
        ? Object.keys(partialState.profiles.items).map(
            resourceKeys.profileMetadata,
          )
        : []),
      ...(partialState.operations
        ? [
            resourceKeys.operationsCollection,
            ...Object.keys(partialState.operations.items).map(
              resourceKeys.operationMetadata,
            ),
          ]
        : []),
      ...(partialState.instances
        ? Object.keys(partialState.instances.items).flatMap((key) => [
            resourceKeys.instanceMetadata(key),
            resourceKeys.instanceState(key),
            resourceKeys.instanceAccess(key),
            resourceKeys.instanceBackupsCollection(key),
            resourceKeys.instanceLogsCollection(key),
            ...Object.keys(
              partialState.instances?.items[key]?.backups.items ?? {},
            ).map((backup) => resourceKeys.instanceBackupMetadata(key, backup)),
            ...Object.keys(
              partialState.instances?.items[key]?.logs.items ?? {},
            ).flatMap((log) => [
              resourceKeys.instanceLogMetadata(key, log),
              resourceKeys.instanceLogContent(key, log),
            ]),
            ...Object.keys(
              partialState.instances?.items[key]?.files.items ?? {},
            ).flatMap((path) => [
              resourceKeys.instanceFileMetadata(key, path),
              resourceKeys.instanceFileChildren(key, path),
            ]),
          ])
        : []),
    ]);
  }

  ensureStoragePool(name: string) {
    const existing = this.state.storagePools.items[name];
    if (existing) return existing;
    const next = createStoragePoolItem();
    this.state.storagePools.items[name] = next;
    return next;
  }

  ensureProject(name: string) {
    const existing = this.state.projects.items[name];
    if (existing) return existing;
    const next = createProjectItem();
    this.state.projects.items[name] = next;
    return next;
  }

  ensureProfile(key: string) {
    const existing = this.state.profiles.items[key];
    if (existing) return existing;
    const next = createProfileItem();
    this.state.profiles.items[key] = next;
    return next;
  }

  ensureOperation(id: string) {
    const existing = this.state.operations.items[id];
    if (existing) return existing;
    const next = createOperationItem();
    this.state.operations.items[id] = next;
    return next;
  }

  ensureCertificate(fingerprint: string) {
    const existing = this.state.certificates.items[fingerprint];
    if (existing) return existing;
    const next = createNamedMetadataItem<Certificate>();
    this.state.certificates.items[fingerprint] = next;
    return next;
  }

  ensureImage(key: string) {
    const existing = this.state.images.items[key];
    if (existing) return existing;
    const next = createImageItem();
    this.state.images.items[key] = next;
    return next;
  }

  ensureNetwork(key: string) {
    const existing = this.state.networks.items[key];
    if (existing) return existing;
    const next = createNetworkItem();
    this.state.networks.items[key] = next;
    return next;
  }

  ensureNetworkZone(name: string) {
    const existing = this.state.networkZones.items[name];
    if (existing) return existing;
    const next = createNamedMetadataItem<NetworkZone>();
    this.state.networkZones.items[name] = next;
    return next;
  }

  ensureNetworkIntegration(name: string) {
    const existing = this.state.networkIntegrations.items[name];
    if (existing) return existing;
    const next = createNamedMetadataItem<NetworkIntegration>();
    this.state.networkIntegrations.items[name] = next;
    return next;
  }

  ensureClusterGroup(name: string) {
    const existing = this.state.clusterGroups.items[name];
    if (existing) return existing;
    const next = createNamedMetadataItem<ClusterGroup>();
    this.state.clusterGroups.items[name] = next;
    return next;
  }

  ensureInstance(key: string) {
    const existing = this.state.instances.items[key];
    if (existing) return existing;
    const next = createInstanceItem();
    this.state.instances.items[key] = next;
    return next;
  }

  ensureInstanceFile(key: string, path: string) {
    const instance = this.ensureInstance(key);
    const existing = instance.files.items[path];
    if (existing) return existing;
    const next = { metadata: missingCached<InstanceFileMetadata>() };
    instance.files.items[path] = next;
    return next;
  }

  ensureStorageVolume(poolName: string, key: string) {
    const pool = this.ensureStoragePool(poolName);
    const existing = pool.volumes.items[key];
    if (existing) return existing;
    const next = createStorageVolumeItem();
    pool.volumes.items[key] = next;
    return next;
  }

  ensureStorageBucket(poolName: string, key: string) {
    const pool = this.ensureStoragePool(poolName);
    const existing = pool.buckets.items[key];
    if (existing) return existing;
    const next = createStorageBucketItem();
    pool.buckets.items[key] = next;
    return next;
  }

  setEventsStatus(status: IncusStoreState['events']['status']) {
    this.update((state) => {
      state.events.status = status;
    }, [resourceKeys.events]);
  }

  markStoragePoolsStatus(status: CacheStatus, error?: string) {
    this.update((state) => {
      state.storagePools.collection = { status, error };
    }, [resourceKeys.storagePoolsCollection]);
  }

  removeStoragePool(name: string) {
    this.update((state) => {
      delete state.storagePools.items[name];
    }, [
      resourceKeys.storagePoolsCollection,
      resourceKeys.storagePoolMetadata(name),
      resourceKeys.storagePoolResources(name),
    ]);
  }

  removeInstance(key: string) {
    const [project = 'default'] = key.split('/').map(decodeURIComponent);
    this.update((state) => {
      delete state.instances.items[key];
    }, [
      resourceKeys.instancesCollection(project),
      resourceKeys.instanceMetadata(key),
      resourceKeys.instanceState(key),
      resourceKeys.instanceAccess(key),
      resourceKeys.instanceBackupsCollection(key),
      resourceKeys.instanceLogsCollection(key),
    ]);
  }

  removeOperation(id: string) {
    this.update((state) => {
      delete state.operations.items[id];
      if (state.operations.collection.status === 'ready') {
        state.operations.collection.status = 'stale';
      }
    }, [
      resourceKeys.operationsCollection,
      resourceKeys.operationMetadata(id),
    ]);
  }
}
