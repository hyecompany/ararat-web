'use client';

import React from 'react';
import { useIncusClient } from '../../provider';
import { resourceKeys } from '../../resources';
import { deriveResourceStatus, resourceStatusFlags } from '../../status';
import { useIncusResourceSnapshot } from '../../use-resource-snapshot';

export function useCertificateResource(fingerprint: string | undefined) {
  const client = useIncusClient();
  const storeKey = fingerprint
    ? resourceKeys.certificateMetadata(fingerprint)
    : null;
  const { storeSnapshot: snapshot, hasInFlight } = useIncusResourceSnapshot(
    client,
    storeKey ? [storeKey] : [],
  );
  const cached = fingerprint
    ? snapshot.state.certificates.items[fingerprint]?.metadata
    : undefined;

  React.useEffect(() => {
    if (!fingerprint) return;
    void client.certificates.ensure(fingerprint);
  }, [client, fingerprint, cached?.status]);

  const status = deriveResourceStatus({
    storedStatus: cached?.status ?? 'missing',
    hasData: cached?.data !== undefined,
    inFlight: storeKey ? hasInFlight(storeKey) : false,
  });
  const flags = resourceStatusFlags(status);

  return {
    data: cached?.data,
    error:
      cached?.status === 'error'
        ? new Error(cached.error ?? 'Unable to load certificate.')
        : null,
    status,
    isLoading: Boolean(fingerprint) && flags.isLoading,
    isStale: flags.isStale,
    isRefreshing: flags.isRefreshing,
  };
}
