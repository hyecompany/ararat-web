'use client';

import React from 'react';
import type { IncusClient } from './client';
import type {
  IncusScopedStoreSnapshot,
  IncusStoreSnapshot,
} from './store';

export function useIncusResourceSnapshot(
  client: IncusClient,
  keys: string[],
  serverSnapshot?: IncusScopedStoreSnapshot | IncusStoreSnapshot,
) {
  const signature = keys.join('|');

  const storeSnapshot = React.useSyncExternalStore(
    React.useCallback(
      (listener) => client.store.subscribeKeys(keys, listener),
      [client, signature],
    ),
    React.useCallback(
      () => client.store.getSnapshotForKeys(keys),
      [client, signature],
    ),
    () => serverSnapshot ?? client.store.getSnapshotForKeys(keys),
  );

  const requestSnapshot = React.useSyncExternalStore(
    React.useCallback(
      (listener) => client.requestRegistry.subscribeKeys(keys, listener),
      [client, signature],
    ),
    React.useCallback(
      () => client.requestRegistry.getSnapshotForKeys(keys),
      [client, signature],
    ),
    () => client.requestRegistry.getSnapshotForKeys(keys),
  );

  return {
    storeSnapshot,
    requestSnapshot,
    hasInFlight: React.useCallback(
      (key: string) => client.requestRegistry.has(key),
      [client, requestSnapshot.version],
    ),
    hasAnyInFlight: React.useCallback(
      (nextKeys: string[]) => client.requestRegistry.hasAny(nextKeys),
      [client, requestSnapshot.version],
    ),
  };
}
