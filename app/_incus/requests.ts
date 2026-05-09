export class RequestRegistry {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly keyCounts = new Map<string, number>();
  private readonly keyVersions = new Map<string, number>();
  private readonly keyListeners = new Map<string, Set<() => void>>();
  private readonly snapshotCache = new Map<string, { version: string }>();

  has(key: string) {
    return (this.keyCounts.get(key) ?? 0) > 0;
  }

  hasAny(keys: string[]) {
    return keys.some((key) => this.has(key));
  }

  subscribeKeys = (keys: string[], listener: () => void) => {
    for (const key of keys) {
      const listeners = this.keyListeners.get(key) ?? new Set<() => void>();
      listeners.add(listener);
      this.keyListeners.set(key, listeners);
    }
    queueMicrotask(listener);
    return () => {
      for (const key of keys) {
        this.keyListeners.get(key)?.delete(listener);
      }
    };
  };

  getSnapshotForKeys = (keys: string[]) => {
    const signature = keys
      .map((key) => `${key}:${this.keyVersions.get(key) ?? 0}`)
      .join('|');
    const cached = this.snapshotCache.get(signature);
    if (cached) return cached;
    const snapshot = { version: signature };
    this.snapshotCache.set(signature, snapshot);
    return snapshot;
  };

  private notify(keys: string[]) {
    for (const key of keys) {
      this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
    }
    this.snapshotCache.clear();

    const listeners = new Set<() => void>();
    for (const key of keys) {
      for (const listener of this.keyListeners.get(key) ?? []) {
        listeners.add(listener);
      }
    }
    for (const listener of listeners) listener();
  }

  private start(keys: string[]) {
    for (const key of keys) {
      this.keyCounts.set(key, (this.keyCounts.get(key) ?? 0) + 1);
    }
    this.notify(keys);
  }

  private finish(keys: string[]) {
    for (const key of keys) {
      const next = (this.keyCounts.get(key) ?? 0) - 1;
      if (next <= 0) {
        this.keyCounts.delete(key);
      } else {
        this.keyCounts.set(key, next);
      }
    }
    this.notify(keys);
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T>;
  run<T>(
    key: string,
    affectedKeys: string[],
    task: () => Promise<T>,
  ): Promise<T>;
  run<T>(
    key: string,
    affectedKeysOrTask: string[] | (() => Promise<T>),
    maybeTask?: () => Promise<T>,
  ) {
    const affectedKeys =
      typeof affectedKeysOrTask === 'function' ? [key] : affectedKeysOrTask;
    const task =
      typeof affectedKeysOrTask === 'function' ? affectedKeysOrTask : maybeTask;
    if (!task) {
      throw new Error('RequestRegistry.run requires a task.');
    }

    // React can ask for the same data more than once while rendering or when
    // tabs overlap. Sharing the promise makes "already fetching" a cache state
    // instead of a reason to start another HTTP request.
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    this.start(affectedKeys);
    const delayMs = getDebugRequestDelayMs();
    const promise = (delayMs > 0 ? wait(delayMs).then(task) : task()).finally(() => {
      this.inFlight.delete(key);
      this.finish(affectedKeys);
    });
    this.inFlight.set(key, promise);
    return promise;
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function getDebugRequestDelayMs() {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') {
    return 0;
  }

  // Development-only test hook. Add ?debug-incus-delay=1500 to a local UI URL
  // when you need the derived loading/refreshing states to stay visible long
  // enough to inspect shimmer and skeleton behavior. This must never affect
  // production builds or normal local sessions without the query param.
  const raw = new URLSearchParams(window.location.search).get(
    'debug-incus-delay',
  );
  if (!raw) return 0;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(5000, Math.max(0, parsed));
}
