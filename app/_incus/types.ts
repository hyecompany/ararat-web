import type { Instance, InstanceState } from '@/app/(main)/instances/_lib/instances.d';
import type { Image } from '@/app/(main)/images/_lib/images.d';
import type { Certificate } from '@/app/_lib/certificate.d';
import type {
  ConfigurableOptions,
  Server,
} from '@/app/_lib/server.d';
import type { ClusterGroup } from '@/app/(main)/_lib/clusters.d';
import type { NetworkIntegration } from '@/app/(main)/_lib/networkIntegrations.d';
import type { NetworkZone } from '@/app/(main)/_lib/networkZones.d';
import type { ResourcesMetadata } from '@/app/(main)/_lib/resources.d';
import type { Project } from '@/app/(main)/_lib/projects.d';
import type { Profile } from '@/app/(main)/_lib/profiles.d';
import type { components } from './generated/api-types';

type ApiStoragePool = components['schemas']['StoragePool'];
type ApiStorageVolume = components['schemas']['StorageVolume'];
type ApiOperation = components['schemas']['Operation'];

export type CacheStatus =
  | 'missing'
  | 'ready'
  | 'stale'
  | 'error';

export type ResourceStatus =
  | CacheStatus
  | 'loading'
  | 'refreshing';

export type Cached<T> = {
  status: CacheStatus;
  data?: T;
  error?: string;
};

export type CollectionStatus = {
  status: CacheStatus;
  error?: string;
};

export type ScopedCollection = {
  all: CollectionStatus;
  byProject: Record<string, CollectionStatus>;
};

// Generated Incus types are the baseline, but a few Swagger-derived schemas are
// intentionally refined for app usage. For example, generated maps can become
// `Record<string, never>` even though Incus returns string config values.
export type StoragePool = Omit<ApiStoragePool, 'config' | 'name'> & {
  config?: Record<string, string>;
  name: string;
};

export type StorageVolume = Omit<ApiStorageVolume, 'config' | 'name'> & {
  config?: Record<string, string>;
  name: string;
  project?: string;
};

export type IncusOperation = Omit<ApiOperation, 'id' | 'metadata'> & {
  id: string;
  metadata?: unknown;
};

export type ResourcesStoragePool = components['schemas']['ResourcesStoragePool'];

export type StorageVolumeState = {
  usage?: Record<string, unknown>;
};

export type StorageVolumeSnapshot = {
  name: string;
  created_at?: string;
  expires_at?: string;
  description?: string;
};

export type StorageVolumeBackup = {
  name: string;
  created_at?: string;
  expires_at?: string;
};

export type StorageBucket = {
  name: string;
  description?: string;
  config?: Record<string, string>;
  location?: string;
  project?: string;
  s3_url?: string;
};

export type StorageBucketKey = {
  name: string;
  description?: string;
  role?: string;
  access_key?: string;
};

export type StorageBucketBackup = {
  name: string;
  created_at?: string;
  expires_at?: string;
};

export type InstanceSnapshot = {
  name: string;
  created_at?: string;
  expires_at?: string;
  stateful?: boolean;
  size?: number;
  description?: string;
};

export type InstanceBackup = {
  name: string;
  created_at?: string;
  expires_at?: string;
  container_only?: boolean;
  instance_only?: boolean;
  optimized_storage?: boolean;
};

export type InstanceLogMetadata = {
  name: string;
  size?: number;
};

export type InstanceFileMetadata = {
  path: string;
  type?: 'file' | 'directory' | 'symlink' | string;
  size?: number;
  mode?: string;
  uid?: string;
  gid?: string;
};

export type StorageVolumeItem = {
  metadata: Cached<StorageVolume>;
  state: Cached<StorageVolumeState>;
  snapshots: {
    collection: CollectionStatus;
    items: Record<string, { metadata: Cached<StorageVolumeSnapshot> }>;
  };
  backups: {
    collection: CollectionStatus;
    items: Record<string, { metadata: Cached<StorageVolumeBackup> }>;
  };
};

export type StorageBucketItem = {
  metadata: Cached<StorageBucket>;
  keys: {
    collection: CollectionStatus;
    items: Record<string, { metadata: Cached<StorageBucketKey> }>;
  };
  backups: {
    collection: CollectionStatus;
    items: Record<string, { metadata: Cached<StorageBucketBackup> }>;
  };
};

export type StoragePoolItem = {
  metadata: Cached<StoragePool>;
  resources: Cached<ResourcesStoragePool>;
  volumes: {
    collection: ScopedCollection;
    items: Record<string, StorageVolumeItem>;
  };
  buckets: {
    collection: ScopedCollection;
    items: Record<string, StorageBucketItem>;
  };
};

export type InstanceItem = {
  metadata: Cached<Instance>;
  state: Cached<InstanceState>;
  access: Cached<string[]>;
  snapshots: {
    collection: CollectionStatus;
    items: Record<string, { metadata: Cached<InstanceSnapshot> }>;
  };
  backups: {
    collection: CollectionStatus;
    items: Record<string, { metadata: Cached<InstanceBackup> }>;
  };
  logs: {
    collection: CollectionStatus;
    items: Record<string, {
      metadata: Cached<InstanceLogMetadata>;
      content: Cached<string>;
    }>;
  };
  files: {
    items: Record<string, {
      metadata: Cached<InstanceFileMetadata>;
      children?: {
        status: CacheStatus;
        names: string[];
        error?: string;
      };
      content?: Cached<string | ArrayBuffer>;
    }>;
  };
};

export type ProjectItem = {
  metadata: Cached<Project>;
};

export type ProfileItem = {
  metadata: Cached<Profile>;
};

export type OperationItem = {
  metadata: Cached<IncusOperation>;
};

export type Network = {
  name: string;
  description: string;
  type: string;
  config: Record<string, string>;
  managed: boolean;
  status: string;
  locations?: string[];
  used_by?: string[];
  project?: string;
};

export type ImageItem = {
  metadata: Cached<Image>;
};

export type NetworkItem = {
  metadata: Cached<Network>;
};

export type NamedMetadataItem<T> = {
  metadata: Cached<T>;
};

export type IncusStoreState = {
  events: {
    status: 'connecting' | 'connected' | 'disconnected';
  };
  server: {
    configuration: Cached<Server>;
    configurableOptions: Cached<ConfigurableOptions>;
    resources: Cached<ResourcesMetadata>;
  };
  certificates: {
    items: Record<string, NamedMetadataItem<Certificate>>;
  };
  images: {
    collection: ScopedCollection;
    items: Record<string, ImageItem>;
  };
  networks: {
    collection: ScopedCollection;
    items: Record<string, NetworkItem>;
  };
  networkZones: {
    collection: CollectionStatus;
    items: Record<string, NamedMetadataItem<NetworkZone>>;
  };
  networkIntegrations: {
    collection: CollectionStatus;
    items: Record<string, NamedMetadataItem<NetworkIntegration>>;
  };
  clusterGroups: {
    collection: CollectionStatus;
    items: Record<string, NamedMetadataItem<ClusterGroup>>;
  };
  storagePools: {
    collection: CollectionStatus;
    items: Record<string, StoragePoolItem>;
  };
  projects: {
    collection: CollectionStatus;
    items: Record<string, ProjectItem>;
  };
  profiles: {
    collection: ScopedCollection;
    items: Record<string, ProfileItem>;
  };
  operations: {
    collection: CollectionStatus;
    items: Record<string, OperationItem>;
  };
  instances: {
    collection: ScopedCollection;
    items: Record<string, InstanceItem>;
  };
};

export type {
  Certificate,
  ClusterGroup,
  ConfigurableOptions,
  Image,
  Instance,
  InstanceState,
  NetworkIntegration,
  NetworkZone,
  Project,
  Profile,
  ResourcesMetadata,
  Server,
};
