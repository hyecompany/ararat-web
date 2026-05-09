'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import {
  collectionStatusKey,
  resolveProjectResourceScope,
  type IncusProjectSelection,
} from '../../scope';
import { deriveResourceStatus, resourceStatusFlags } from '../../status';
import type { Image } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

export function useImagesResource(project?: string | null) {
  const client = useIncusClient();
  const selectedProject: IncusProjectSelection =
    project === undefined ? client.getProject() : project ?? 'default';
  const projectKeys = React.useMemo(() => {
    const keys = [resourceKeys.projectsCollection];
    if (selectedProject !== 'all' && selectedProject !== 'default') {
      keys.push(resourceKeys.projectMetadata(selectedProject));
    }
    return keys;
  }, [selectedProject]);
  const projectKeySignature = projectKeys.join('|');
  const projectSnapshot = client.store.getSnapshotForKeys(projectKeys);
  const effectiveProject = resolveProjectResourceScope(
    projectSnapshot.state,
    selectedProject,
    'images',
  );
  const collectionKey = collectionStatusKey(effectiveProject);
  const knownKeys = Object.keys(client.store.getSnapshot().state.images.items);
  const knownSignature = knownKeys.join('|');
  const subscriptionKeys = React.useMemo(
    () => [
      ...projectKeys,
      resourceKeys.imagesCollection(collectionKey),
      ...knownKeys.map(resourceKeys.imageMetadata),
    ],
    [collectionKey, knownSignature, projectKeySignature],
  );
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    subscriptionKeys,
  );
  const collection =
    snapshot.state.images.collection.byProject[collectionKey] ??
    snapshot.state.images.collection.all;

  React.useEffect(() => {
    void client.images.ensure(selectedProject);
  }, [client, selectedProject, collection.status, snapshot.version]);

  const data = Object.entries(snapshot.state.images.items)
    .map(([, item]) => item.metadata.data)
    .filter((image): image is Image => Boolean(image))
    .filter((image) => {
      if (collectionKey === 'all') return true;
      return (image.project ?? collectionKey) === collectionKey;
    });
  const status = deriveResourceStatus({
    storedStatus: collection.status,
    hasData: data.length > 0,
    inFlight: hasInFlight(resourceKeys.imagesCollection(collectionKey)),
  });
  const flags = resourceStatusFlags(status);

  return {
    data,
    error:
      collection.status === 'error'
        ? new Error(collection.error ?? 'Unable to load images.')
        : null,
    status,
    isLoading: flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}
