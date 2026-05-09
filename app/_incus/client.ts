'use client';

import { routeIncusEventToStore } from './events';
import { markAllEventManagedDataStale } from './freshness';
import {
  loadPersistedIncusState,
  scheduleIncusStatePersistence,
} from './persistence';
import { RequestRegistry } from './requests';
import { createCertificatesResource } from './resources/certificates/ensure';
import { createClusterGroupsResource } from './resources/cluster-groups/ensure';
import { createImagesResource } from './resources/images/ensure';
import { createInstanceBackupsResource } from './resources/instances/backups/ensure';
import { createInstanceFilesResource } from './resources/instances/files/ensure';
import { createInstanceLogsResource } from './resources/instances/logs/ensure';
import { createInstanceSnapshotsResource } from './resources/instances/snapshots/ensure';
import { createInstanceActionsResource } from './resources/instances/actions';
import { createInstancesResource } from './resources/instances/ensure';
import { createNetworkIntegrationsResource } from './resources/network-integrations/ensure';
import { createNetworkZonesResource } from './resources/network-zones/ensure';
import { createNetworksResource } from './resources/networks/ensure';
import { createOperationsResource } from './resources/operations/ensure';
import { createProfilesResource } from './resources/profiles/ensure';
import { createProjectsResource } from './resources/projects/ensure';
import { createServerResource } from './resources/server/ensure';
import {
  ensureStoragePools,
  ensureStoragePoolVolumes,
  type UseStoragePoolsRequest,
} from './resources/storage-pools/ensure';
import { IncusStore } from './store';
import type { IncusEvent } from '@/app/_context/events';

export class IncusClient {
  readonly store = new IncusStore();
  readonly requestRegistry = new RequestRegistry();
  readonly server = createServerResource(this.store, this.requestRegistry);
  readonly certificates = createCertificatesResource(
    this.store,
    this.requestRegistry,
  );
  readonly images = createImagesResource(
    this.store,
    this.requestRegistry,
    () => this.project,
  );
  readonly networks = createNetworksResource(
    this.store,
    this.requestRegistry,
    () => this.project,
  );
  readonly networkZones = createNetworkZonesResource(
    this.store,
    this.requestRegistry,
  );
  readonly networkIntegrations = createNetworkIntegrationsResource(
    this.store,
    this.requestRegistry,
  );
  readonly clusterGroups = createClusterGroupsResource(
    this.store,
    this.requestRegistry,
  );
  readonly projects = createProjectsResource(this.store, this.requestRegistry);
  readonly profiles = createProfilesResource(
    this.store,
    this.requestRegistry,
    () => this.project,
  );
  readonly instances = {
    ...createInstancesResource(
      this.store,
      this.requestRegistry,
      () => this.project,
    ),
    ...createInstanceActionsResource(this.store, this.requestRegistry),
  };
  readonly operations = createOperationsResource(
    this.store,
    this.requestRegistry,
  );
  readonly instanceFiles = createInstanceFilesResource(
    this.store,
    this.requestRegistry,
  );
  readonly instanceBackups = createInstanceBackupsResource(
    this.store,
    this.requestRegistry,
  );
  readonly instanceLogs = createInstanceLogsResource(
    this.store,
    this.requestRegistry,
  );
  readonly instanceSnapshots = createInstanceSnapshotsResource(
    this.store,
    this.requestRegistry,
  );
  private project: string = 'all';
  private hasRestoredPersistedState = false;

  constructor() {
    this.store.subscribeAll(() => {
      scheduleIncusStatePersistence(this.store.getSnapshot().state);
    });
  }

  restorePersistedState() {
    if (this.hasRestoredPersistedState) return;
    this.hasRestoredPersistedState = true;

    const persistedState = loadPersistedIncusState();
    if (persistedState) {
      this.store.hydrate(persistedState);
    }
  }

  setProject(project: string) {
    this.project = project || 'all';
  }

  getProject() {
    return this.project;
  }

  async ensureStoragePools(request: UseStoragePoolsRequest = {}) {
    await ensureStoragePools(this.store, this.requestRegistry, request);
  }

  async ensureStoragePoolVolumes(poolName: string, project?: string) {
    await ensureStoragePoolVolumes(
      this.store,
      this.requestRegistry,
      poolName,
      project ?? this.project,
    );
  }

  applyEvent(event: IncusEvent) {
    routeIncusEventToStore(this.store, event);
  }

  markAllEventManagedDataStale() {
    markAllEventManagedDataStale(this.store);
  }
}

export function createIncusClient() {
  return new IncusClient();
}

let browserIncusClient: IncusClient | null = null;

export function getBrowserIncusClient() {
  // Client components can be rendered speculatively before React commits them,
  // especially around Suspense and slow-network testing. Keeping the Incus
  // client as a browser singleton prevents those discarded renders from
  // repeatedly hydrating localStorage and opening multiple logical caches.
  if (!browserIncusClient) {
    browserIncusClient = createIncusClient();
  }
  return browserIncusClient;
}
