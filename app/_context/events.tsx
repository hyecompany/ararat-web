'use client';

import React, { createContext, useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { useSWRConfig, type Cache } from 'swr';

type EventType = 'operation' | 'logging' | 'lifecycle';

interface IncusEvent {
  type: EventType;
  timestamp: string;
  metadata: unknown;
  project?: string;
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

interface LifecycleMetadata {
  action: string;
  source?: string;
  context?: Record<string, unknown>;
}

type EventEmitterContextValue = {
  isConnected: boolean;
};

const EventEmitterContext = createContext<EventEmitterContextValue>({
  isConnected: false,
});

export default EventEmitterContext;

// Initial reconnect delay in milliseconds
const INITIAL_RECONNECT_DELAY_MS = 3000;
// Maximum reconnect delay in milliseconds
const MAX_RECONNECT_DELAY_MS = 30000;

const TERMINAL_OPERATION_STATUSES = new Set(['Success', 'Failure', 'Cancelled']);
const INSTANCE_FILE_LIFECYCLE_ACTIONS = new Set(['instance-file-deleted', 'instance-file-pushed']);

function normalizePath(path: string) {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

function getPathname(value: string) {
  try {
    return normalizePath(new URL(value, window.location.origin).pathname);
  } catch {
    return normalizePath(value.split('?')[0] || '');
  }
}

function getParentPath(path: string) {
  const index = path.lastIndexOf('/');
  if (index <= 0) return null;
  return path.slice(0, index);
}

function getNestedInstanceDetailPath(path: string) {
  if (!isInstanceResourcePath(path)) return null;

  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 3) return null;

  return `/${segments.slice(0, 3).join('/')}`;
}

function getInstanceFilesPath(path: string, context?: Record<string, unknown>) {
  const instancePath = getNestedInstanceDetailPath(path) ?? path;
  if (!isInstanceResourcePath(instancePath)) return null;

  const filePath =
    typeof context?.path === 'string'
      ? context.path
      : typeof context?.file === 'string'
        ? context.file
        : typeof context?.['file-destination'] === 'string'
          ? context['file-destination']
          : typeof context?.['file-source'] === 'string'
            ? context['file-source']
            : null;

  if (!filePath) return null;

  const parentPath = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
  return `${instancePath}/files?path=${encodeURIComponent(parentPath)}`;
}

function isProjectMatch(params: URLSearchParams, project?: string) {
  if (params.get('all-projects') === 'true') return true;

  const keyProject = params.get('project');
  if (keyProject) {
    return Boolean(project) && keyProject === project;
  }

  return !project || project === 'default';
}

function parseCacheKey(key: unknown) {
  if (typeof key !== 'string') return null;

  try {
    const url = new URL(key, window.location.origin);
    return {
      pathname: normalizePath(url.pathname),
      params: url.searchParams,
    };
  } catch {
    return null;
  }
}

function isSameCacheKeyPath(key: unknown, target: string) {
  const parsedKey = parseCacheKey(key);
  const parsedTarget = parseCacheKey(target);

  return (
    parsedKey?.pathname === parsedTarget?.pathname &&
    parsedKey?.params.toString() === parsedTarget?.params.toString()
  );
}

function getResourcePaths(resources: OperationMetadata['resources']) {
  return Array.from(
    new Set(
      Object.values(resources)
        .flat()
        .map((resource) => getPathname(resource))
        .filter(Boolean),
    ),
  );
}

function isInstanceResourcePath(path: string) {
  return path.startsWith('/1.0/instances/');
}

function hasMatchingCollectionKey(cache: Cache, collectionPath: string, project?: string) {
  for (const key of cache.keys()) {
    const parsed = parseCacheKey(key);
    if (parsed?.pathname === collectionPath && isProjectMatch(parsed.params, project)) {
      return true;
    }
  }

  return false;
}

function getLifecycleToastMessage(action: string) {
  const messages: Record<string, string> = {
    'instance-file-deleted': 'File deleted',
    'instance-file-pushed': 'File saved',
    'instance-paused': 'Instance paused',
    'instance-restarted': 'Instance restarted',
    'instance-resumed': 'Instance resumed',
    'instance-shutdown': 'Instance shut down',
    'instance-started': 'Instance started',
    'instance-stopped': 'Instance stopped',
  };

  return messages[action];
}

export function EventEmitterProvider({ children }: { children: React.ReactNode }) {
  const { cache, mutate } = useSWRConfig();
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  // Track operations we are already showing toasts for to avoid duplicates/spam
  const activeOperations = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const activeOperationIds = activeOperations.current;
    let reconnectAttempts = 0;
    let reconnectTimeout: number | undefined;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${protocol}://${window.location.host}/1.0/events?type=operation,lifecycle,logging`;

      console.log('Connecting to events:', url);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Events WebSocket connected');
        setIsConnected(true);
        reconnectAttempts = 0;
        // Clear activeOperations on reconnect to avoid memory leaks
        activeOperationIds.clear();
      };

      ws.onclose = () => {
        console.log('Events WebSocket disconnected');
        setIsConnected(false);
        wsRef.current = null;

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

          if (data.type === 'operation') {
            handleOperationEvent(data.metadata as OperationMetadata, data.project);
          } else if (data.type === 'lifecycle') {
            handleLifecycleEvent(data.metadata as LifecycleMetadata, data.project);
          }
        } catch (e) {
          console.error('Failed to parse event data:', e);
        }
      };
    };

    const revalidateResourceCaches = (
      resources: OperationMetadata['resources'],
      project?: string,
    ) => {
      const resourcePaths = getResourcePaths(resources);
      if (!resourcePaths.length) return;

      const exactPaths = new Set<string>();
      const collectionPaths = new Set<string>();

      for (const resourcePath of resourcePaths) {
        const collectionPath = getParentPath(resourcePath);
        if (!collectionPath) continue;

        collectionPaths.add(collectionPath);

        const nestedInstanceDetailPath = getNestedInstanceDetailPath(resourcePath);
        if (nestedInstanceDetailPath) {
          exactPaths.add(nestedInstanceDetailPath);
        }

        if (isInstanceResourcePath(resourcePath)) {
          exactPaths.add(resourcePath);
        }

        if (
          !isInstanceResourcePath(resourcePath) ||
          !hasMatchingCollectionKey(cache, collectionPath, project)
        ) {
          exactPaths.add(resourcePath);
        }
      }

      for (const key of cache.keys()) {
        const parsed = parseCacheKey(key);
        if (!parsed || !isProjectMatch(parsed.params, project)) {
          continue;
        }

        if (collectionPaths.has(parsed.pathname) || exactPaths.has(parsed.pathname)) {
          void mutate(key);
        }
      }
    };

    const revalidateLifecycleCaches = (lifecycle: LifecycleMetadata, project?: string) => {
      if (!lifecycle.source) return;

      const sourcePath = getPathname(lifecycle.source);
      const filesPath = getInstanceFilesPath(sourcePath, lifecycle.context);
      if (INSTANCE_FILE_LIFECYCLE_ACTIONS.has(lifecycle.action)) {
        if (!filesPath) return;

        for (const key of cache.keys()) {
          const parsed = parseCacheKey(key);
          if (!parsed || !isProjectMatch(parsed.params, project)) {
            continue;
          }

          if (isSameCacheKeyPath(key, filesPath)) {
            void mutate(key);
          }
        }

        return;
      }

      const collectionPath = getParentPath(sourcePath);
      const nestedInstanceDetailPath = getNestedInstanceDetailPath(sourcePath);
      const exactPaths = new Set<string>([sourcePath]);
      const collectionPaths = new Set<string>();

      if (collectionPath) {
        collectionPaths.add(collectionPath);
      }

      if (nestedInstanceDetailPath) {
        exactPaths.add(nestedInstanceDetailPath);
      }

      for (const key of cache.keys()) {
        const parsed = parseCacheKey(key);
        if (!parsed || !isProjectMatch(parsed.params, project)) {
          continue;
        }

        const shouldRevalidate =
          (parsed.pathname === '/1.0/instances' && isInstanceResourcePath(sourcePath)) ||
          collectionPaths.has(parsed.pathname) ||
          exactPaths.has(parsed.pathname);

        if (shouldRevalidate) {
          void mutate(key);
        }
      }
    };

    const handleOperationEvent = (op: OperationMetadata, project?: string) => {
      // status: Pending, Running, Success, Failure, Cancelled

      const toastId = op.id;
      const description = op.description || 'Operation';
      const isTerminalStatus = TERMINAL_OPERATION_STATUSES.has(op.status);

      // If it's a new operation we haven't seen, or an update to one we are tracking
      if (op.status === 'Pending' || op.status === 'Running') {
        activeOperationIds.add(toastId);

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
        activeOperationIds.delete(toastId);
      } else if (op.status === 'Failure') {
        toast.error(description, {
          id: toastId,
          description: op.err || 'Operation failed',
        });
        activeOperationIds.delete(toastId);
      } else if (op.status === 'Cancelled') {
        toast.info(description, {
          id: toastId,
          description: 'Cancelled',
        });
        activeOperationIds.delete(toastId);
      }

      if (isTerminalStatus) {
        revalidateResourceCaches(op.resources, project);
      }
    };

    const handleLifecycleEvent = (lifecycle: LifecycleMetadata, project?: string) => {
      const message = getLifecycleToastMessage(lifecycle.action);
      if (message) {
        toast.success(message);
      }

      revalidateLifecycleCaches(lifecycle, project);
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
      activeOperationIds.clear();
    };
  }, [cache, mutate]);

  return (
    <EventEmitterContext.Provider value={{ isConnected }}>{children}</EventEmitterContext.Provider>
  );
}
