'use client';

import React from 'react';
import { addTransitionType, startTransition } from 'react';
import EventEmitterContext from '@/app/_context/events';
import { getBrowserIncusClient, type IncusClient } from './client';

const IncusClientContext = React.createContext<IncusClient | null>(null);

export function IncusProvider({ children }: { children: React.ReactNode }) {
  const { isConnected, lastEvent } = React.use(EventEmitterContext);
  const clientRef = React.useRef<IncusClient | null>(null);
  const wasConnectedRef = React.useRef(false);

  if (!clientRef.current) {
    clientRef.current = getBrowserIncusClient();
  }

  React.useEffect(() => {
    // Persisted Incus data is restored after hydration, not during the first
    // client render. That keeps server and client markup identical while still
    // letting cached stale data replace skeletons immediately after the page is
    // interactive.
    startTransition(() => {
      addTransitionType('loadable-swap');
      clientRef.current?.restorePersistedState();
    });
  }, []);

  React.useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      clientRef.current?.store.setEventsStatus('connected');
      return;
    }

    if (wasConnectedRef.current) {
      clientRef.current?.markAllEventManagedDataStale();
      return;
    }

    clientRef.current?.store.setEventsStatus('connecting');
  }, [isConnected]);

  React.useEffect(() => {
    if (!lastEvent) return;

    // The legacy event provider owns the single websocket connection. This
    // provider consumes the same event stream and translates relevant events into
    // normalized cache updates for the new Incus store.
    clientRef.current?.applyEvent(lastEvent);
  }, [lastEvent]);

  return (
    <IncusClientContext value={clientRef.current}>
      {children}
    </IncusClientContext>
  );
}

export function IncusProjectScopeSync({ project }: { project: string }) {
  const client = useIncusClient();

  React.useEffect(() => {
    client.setProject(project);
  }, [client, project]);

  return null;
}

export function useIncusClient() {
  const client = React.use(IncusClientContext);
  if (!client) {
    throw new Error('useIncusClient must be used inside IncusProvider.');
  }
  return client;
}
