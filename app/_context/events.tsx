'use client';

import React, { createContext, useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';

type EventType = 'operation' | 'logging' | 'lifecycle';

interface IncusEvent {
  type: EventType;
  timestamp: string;
  metadata: any;
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
  metadata: any; // specific operation metadata (e.g. progress)
  may_cancel: boolean;
  err: string;
  location: string;
}

type EventEmitterContextValue = {
  isConnected: boolean;
};

const EventEmitterContext = createContext<EventEmitterContextValue>({
  isConnected: false,
});

export default EventEmitterContext;

export function EventEmitterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // Track operations we are already showing toasts for to avoid duplicates/spam
  const activeOperations = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${protocol}://${window.location.host}/1.0/events?type=operation,lifecycle,logging`;

      console.log('Connecting to events:', url);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Events WebSocket connected');
        setIsConnected(true);
      };

      ws.onclose = () => {
        console.log('Events WebSocket disconnected');
        setIsConnected(false);
        // Optional: Implement reconnection logic here if needed
        // setTimeout(connect, 1000);
      };

      ws.onerror = (error) => {
        console.error('Events WebSocket error:', error);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as IncusEvent;

          if (data.type === 'operation') {
            handleOperationEvent(data.metadata as OperationMetadata);
          }
        } catch (e) {
          console.error('Failed to parse event data:', e);
        }
      };
    };

    const handleOperationEvent = (op: OperationMetadata) => {
      // We only care about task operations usually, but let's handle all for now
      // status: Pending, Running, Success, Failure, Cancelled

      const toastId = op.id;
      const description = op.description || 'Operation';

      // If it's a new operation we haven't seen, or an update to one we are tracking
      if (op.status === 'Pending' || op.status === 'Running') {
        activeOperations.current.add(toastId);

        let progressDetails = '';
        if (op.metadata) {
          // Try to extract progress info
          // Common patterns: metadata: { download_progress: "12%" } or similar
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
        if (activeOperations.current.has(toastId)) {
          toast.success(description, {
            id: toastId,
            description: 'Completed successfully',
          });
          activeOperations.current.delete(toastId);
        }
      } else if (op.status === 'Failure') {
        if (activeOperations.current.has(toastId)) {
          toast.error(description, {
            id: toastId,
            description: op.err || 'Operation failed',
          });
          activeOperations.current.delete(toastId);
        }
      } else if (op.status === 'Cancelled') {
        if (activeOperations.current.has(toastId)) {
          toast.info(description, {
            id: toastId,
            description: 'Cancelled',
          });
          activeOperations.current.delete(toastId);
        }
      }
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <EventEmitterContext.Provider value={{ isConnected }}>
      {children}
    </EventEmitterContext.Provider>
  );
}
