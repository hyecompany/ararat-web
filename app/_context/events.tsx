'use client';

import React, { createContext, useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';

// Shared client-side event target for broadcasting Incus operation events
// to consumers (e.g., file manager revalidation). Guarded for SSR safety.
export const incusEventTarget =
  typeof window !== 'undefined' ? new EventTarget() : null;

type EventType = 'operation' | 'logging' | 'lifecycle';

interface IncusEvent {
  type: EventType;
  timestamp: string;
  metadata: unknown;
}

interface LifecycleMetadata {
  action: string;
  source: string;
  context?: Record<string, any>;
  requestor?: {
    protocol: string;
    username: string;
  };
}

interface OperationMetadata {
  id: string;
  class: string;
  description: string;
  created_at: string;
  updated_at: string;
  status: string;
  status_code: number;
  resources: Record<string, string[]>;
  metadata: {
    download_progress?: string;
    percent?: number;
    [key: string]: unknown;
  } | null; // specific operation metadata (e.g. progress)
  may_cancel: boolean;
  err: string;
  location: string;
}

type EventEmitterContextValue = {
  isConnected: boolean;
  socket: WebSocket | null;
};

const EventEmitterContext = createContext<EventEmitterContextValue>({
  isConnected: false,
  socket: null,
});

export default EventEmitterContext;

// Initial reconnect delay in milliseconds
const INITIAL_RECONNECT_DELAY_MS = 3000;
// Maximum reconnect delay in milliseconds
const MAX_RECONNECT_DELAY_MS = 30000;

export function EventEmitterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Track operations we are already showing toasts for to avoid duplicates/spam
  const activeOperations = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let reconnectAttempts = 0;
    let reconnectTimeout: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${protocol}://${window.location.host}/1.0/events?type=operation,lifecycle,logging`;

      console.log('Connecting to events:', url);
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setSocket(ws);

      ws.onopen = () => {
        console.log('Events WebSocket connected');
        setIsConnected(true);
        reconnectAttempts = 0;
        // Clear activeOperations on reconnect to avoid memory leaks
        activeOperations.current.clear();
      };

      ws.onclose = () => {
        console.log('Events WebSocket disconnected');
        setIsConnected(false);
        wsRef.current = null;
        setSocket(null);

        // Reconnect with exponential backoff starting from the initial delay
        const reconnectDelay = Math.min(
          INITIAL_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
          MAX_RECONNECT_DELAY_MS,
        );
        reconnectAttempts++;
        reconnectTimeout = window.setTimeout(connect, reconnectDelay);
      };

      ws.onerror = (error) => {
        console.error('Events WebSocket error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as IncusEvent;

          // Broadcast to shared event target so consumers can react to all events
          if (incusEventTarget) {
            incusEventTarget.dispatchEvent(
              new CustomEvent('incus-event', { detail: data }),
            );
          }

          if (data.type === 'operation') {
            handleOperationEvent(data.metadata as OperationMetadata);
          }
        } catch (e) {
          console.error('Failed to parse event data:', e);
        }
      };
    };

    const handleOperationEvent = (op: OperationMetadata) => {
      // status: Pending, Running, Success, Failure, Cancelled

      const toastId = op.id;
      const description = op.description || 'Operation';

      // If it's a new operation we haven't seen, or an update to one we are tracking
      if (op.status === 'Pending' || op.status === 'Running') {
        activeOperations.current.add(toastId);

        let progressDetails = '';
        if (op.metadata) {
          // Try to extract progress info
          // Common patterns: metadata: { download_progress: "12%" } or { percent: 42 }
          if (op.metadata.download_progress) {
            progressDetails = `Downloading: ${op.metadata.download_progress}`;
          } else if (op.metadata.percent) {
            progressDetails = `${op.metadata.percent}%`;
          }
        }

        toast.loading(description, {
          id: toastId,
          description: progressDetails || op.status,
        });
      } else if (op.status === 'Success') {
        // Always show a toast for terminal states, even if not previously tracked
        toast.success(description, {
          id: toastId,
          description: 'Completed successfully',
        });
        activeOperations.current.delete(toastId);
      } else if (op.status === 'Failure') {
        toast.error(description, {
          id: toastId,
          description: op.err || 'Operation failed',
        });
        activeOperations.current.delete(toastId);
      } else if (op.status === 'Cancelled') {
        toast.info(description, {
          id: toastId,
          description: 'Cancelled',
        });
        activeOperations.current.delete(toastId);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      activeOperations.current.clear();
    };
  }, []);

  return (
    <EventEmitterContext.Provider value={{ isConnected, socket }}>
      {children}
    </EventEmitterContext.Provider>
  );
}
