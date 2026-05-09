'use client';

import React from 'react';
import { profileKey } from '../../keys';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import {
  collectionStatusKey,
  resolveProjectResourceScope,
} from '../../scope';
import {
  deriveResourceStatus,
  resourceStatusFlags,
} from '../../status';
import type { Profile } from '../../types';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

export function useProfilesResource(names?: string[]) {
  const client = useIncusClient();
  const project = client.getProject();
  const effectiveProject = resolveProjectResourceScope(
    client.store.getSnapshot().state,
    project,
    'profiles',
  );
  const collectionKey = collectionStatusKey(effectiveProject);
  const requestKey = JSON.stringify(names ?? null);

  const keys = React.useMemo(() => {
    const base = [
      resourceKeys.projectsCollection,
      resourceKeys.profilesCollection(collectionKey),
    ];
    if (project !== 'all' && project !== 'default') {
      base.push(resourceKeys.projectMetadata(project));
    }
    if (names?.length) {
      base.push(
        ...names.map((name) =>
          resourceKeys.profileMetadata(profileKey(collectionKey, name)),
        ),
      );
    }
    return base;
  }, [collectionKey, project, requestKey]);

  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    keys,
  );

  React.useEffect(() => {
    void client.profiles.ensure({ names });
  }, [client, requestKey, snapshot.version]);

  return React.useMemo(() => {
    const collection =
      snapshot.state.profiles.collection.byProject[collectionKey] ??
      snapshot.state.profiles.collection.all;
    const requested = names?.length ? new Set(names) : null;
    const data = Object.entries(snapshot.state.profiles.items)
      .filter(([key]) => key.startsWith(`${encodeURIComponent(collectionKey)}/`))
      .map(([, item]) => item.metadata.data)
      .filter((profile): profile is Profile => Boolean(profile))
      .filter((profile) => !requested || requested.has(profile.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    const status = deriveResourceStatus({
      storedStatus: collection.status,
      hasData: data.length > 0,
      inFlight: hasInFlight(resourceKeys.profilesCollection(collectionKey)),
    });
    const flags = resourceStatusFlags(status);

    return {
      data,
      error: collection.status === 'error' ? new Error(collection.error ?? '') : null,
      status,
      isLoading: flags.isLoading,
      isStale: flags.isStale,
      isRefreshing: flags.isRefreshing,
    };
  }, [collectionKey, hasInFlight, names, snapshot]);
}
