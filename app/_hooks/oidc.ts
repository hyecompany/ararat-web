"use client";

import { useEffect, useRef, useState } from "react";
import type { OidcUserData } from "../_lib/oidc.d";
import {
  getOidcClaimsFromCookie,
  getOidcUserFromCookie,
  refreshOidcSession,
} from "../_lib/oidc";

// How early to refresh before token expiry (milliseconds)
const OIDC_REFRESH_SKEW_MS = 120_000; // 2 minutes early
// Fallback periodic check when we don't have exp (milliseconds)
const OIDC_FALLBACK_POLL_MS = 60_000; // 1 minute
// Minimum delay between refresh attempts (milliseconds)
const OIDC_MIN_REFRESH_INTERVAL_MS = 10_000; // avoid zero-delay thrash
// Backoff when refresh fails (milliseconds)
const OIDC_REFRESH_FAILURE_BACKOFF_MS = 60_000; // 1 minute cooldown after errors
// Small random jitter to avoid cross-tab stampedes (milliseconds)
const OIDC_JITTER_MS = 15_000; // up to 15s scatter
// Cross-tab refresh lock
const OIDC_LOCK_KEY = "oidc-refresh-lock";
const OIDC_LOCK_TTL_MS = 30_000; // refresh should complete quickly; TTL prevents deadlocks

/**
 * Hook to get OIDC user data from the oidc_id cookie
 * Returns user data if available, initial loading state, and refresh state.
 */
export function useOidcUser(enabled: boolean = true) {
  const [data, setData] = useState<OidcUserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(true);

  // Refs to avoid stale closures and overlapping refreshes
  const isMountedRef = useRef(true);
  const isRefreshingRef = useRef(false);
  const inFlightRefreshRef = useRef<Promise<void> | null>(null);
  const refreshBackoffMsRef = useRef<number>(0);
  const refreshDisabledRef = useRef<boolean>(false);
  const timerIdRef = useRef<number | null>(null);
  const prevUserJSONRef = useRef<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}-${Date.now()}`
  );

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    isMountedRef.current = true;

    // Setup a channel to notify other tabs when a refresh completes
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      channelRef.current = new BroadcastChannel("oidc-auth");
      channelRef.current.onmessage = (event) => {
        if (event?.data === "refreshed") {
          // Another tab refreshed; re-read user and reschedule
          readAndUpdateUser();
          scheduleNext();
        }
      };
    }

    function clearTimer() {
      if (timerIdRef.current !== null) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
    }

    function readAndUpdateUser() {
      const freshUser = getOidcUserFromCookie();
      const json = freshUser ? JSON.stringify(freshUser) : null;
      if (prevUserJSONRef.current !== json) {
        prevUserJSONRef.current = json;
        if (isMountedRef.current) setData(freshUser);
      }
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }

    function getNow() {
      return Date.now();
    }

    function tryAcquireCrossTabLock(): boolean {
      try {
        const now = getNow();
        const current = localStorage.getItem(OIDC_LOCK_KEY);
        if (current) {
          try {
            const parsed = JSON.parse(current) as { id: string; expiresAt: number };
            if (parsed.expiresAt > now) {
              return false; // lock held and not expired
            }
          } catch {
            // malformed; ignore and proceed to take lock
          }
        }
        const record = { id: tabIdRef.current, expiresAt: now + OIDC_LOCK_TTL_MS };
        localStorage.setItem(OIDC_LOCK_KEY, JSON.stringify(record));
        // verify we actually hold it
        const confirm = localStorage.getItem(OIDC_LOCK_KEY);
        if (!confirm) return false;
        const parsed = JSON.parse(confirm) as { id: string; expiresAt: number };
        return parsed.id === tabIdRef.current;
      } catch {
        // localStorage not available? fail open: no cross-tab lock
        return true;
      }
    }

    function releaseCrossTabLock() {
      try {
        const current = localStorage.getItem(OIDC_LOCK_KEY);
        if (!current) return;
        const parsed = JSON.parse(current) as { id: string; expiresAt: number };
        if (parsed.id === tabIdRef.current) {
          localStorage.removeItem(OIDC_LOCK_KEY);
        }
      } catch {
        // ignore
      }
    }

    function waitForCrossTabRefreshOrTimeout(timeoutMs: number) {
      return new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const onMessage = (event: MessageEvent) => {
          if (event?.data === "refreshed") {
            try { channelRef.current?.removeEventListener("message", onMessage as any); } catch { }
            done();
          }
        };
        try {
          channelRef.current?.addEventListener("message", onMessage as any);
        } catch { }
        window.setTimeout(() => {
          try { channelRef.current?.removeEventListener("message", onMessage as any); } catch { }
          done();
        }, timeoutMs);
        // Safety: clear timer on resolve to avoid leaks
      });
    }

    async function refreshDeduped() {
      if (isRefreshingRef.current) {
        // Await existing in-flight refresh
        try {
          await inFlightRefreshRef.current;
        } catch (err) {
          // Already logged by the original caller
        }
        return;
      }
      // Cross-tab: attempt to acquire lock. If not, wait for other tab.
      const haveLock = tryAcquireCrossTabLock();
      if (!haveLock) {
        await waitForCrossTabRefreshOrTimeout(OIDC_LOCK_TTL_MS + 5_000);
        return;
      }

      isRefreshingRef.current = true;
      setIsRefreshing(true);

      const promise = (async () => {
        try {
          await refreshOidcSession();
          refreshBackoffMsRef.current = 0;
          // Notify other tabs
          try {
            channelRef.current?.postMessage("refreshed");
          } catch { }
        } catch (err) {
          console.warn("OIDC refresh failed", err);
          refreshBackoffMsRef.current = OIDC_REFRESH_FAILURE_BACKOFF_MS;
          const status = (err as { status?: number })?.status;
          if (status === 404) {
            refreshDisabledRef.current = true;
          }
        } finally {
          releaseCrossTabLock();
          isRefreshingRef.current = false;
          inFlightRefreshRef.current = null;
          if (isMountedRef.current) setIsRefreshing(false);
        }
      })();

      inFlightRefreshRef.current = promise;
      await promise;
    }

    function scheduleNext() {
      clearTimer();
      const claims = getOidcClaimsFromCookie();
      const nowMs = Date.now();
      const expMs = claims?.exp ? claims.exp * 1000 : undefined;

      const delayMs = (() => {
        if (refreshDisabledRef.current) {
          return OIDC_FALLBACK_POLL_MS;
        }
        if (refreshBackoffMsRef.current) {
          return refreshBackoffMsRef.current;
        }
        if (!expMs) {
          // Unknown expiry; do a fallback periodic check
          return OIDC_FALLBACK_POLL_MS;
        }

        // Refresh slightly before expiry, add jitter to spread load
        const jitter = Math.floor(Math.random() * OIDC_JITTER_MS);
        const targetMs = expMs - nowMs - OIDC_REFRESH_SKEW_MS + jitter;
        return Math.max(OIDC_MIN_REFRESH_INTERVAL_MS, targetMs);
      })();

      timerIdRef.current = window.setTimeout(async () => {
        if (!isMountedRef.current) {
          return;
        }
        await maybeRefresh();
        if (!isMountedRef.current) {
          return;
        }
        scheduleNext();
      }, delayMs);

      // Reset backoff after scheduling so the next cycle uses the calculated delay
      refreshBackoffMsRef.current = 0;
    }

    async function maybeRefresh() {
      const claims = getOidcClaimsFromCookie();
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresIn = claims?.exp ? claims.exp - nowSec : undefined;
      const shouldRefresh =
        !claims ||
        expiresIn === undefined ||
        expiresIn <= Math.ceil(OIDC_REFRESH_SKEW_MS / 1000);

      // Refresh if missing token, expired, or inside skew window
      if (shouldRefresh && !refreshDisabledRef.current) {
        await refreshDeduped();
        // After refresh, re-read user data
        readAndUpdateUser();
        return;
      }

      // Either still valid or refresh is disabled; ensure we reflect latest cookie state
      readAndUpdateUser();
      if (isMountedRef.current) {
        setIsRefreshing(false);
      }
    }

    // Initial load: read current user and schedule next refresh
    (async () => {
      await maybeRefresh();
      if (isMountedRef.current) {
        scheduleNext();
      }
    })();

    // Wake up early when tab becomes visible
    const onVisibility = () => {
      if (!isMountedRef.current) return;
      if (document.visibilityState === "visible") {
        (async () => {
          await maybeRefresh();
          if (isMountedRef.current) {
            scheduleNext();
          }
        })();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
      try {
        channelRef.current?.close();
      } catch { }
      channelRef.current = null;
    };
  }, [enabled]);

  return {
    data,
    isLoading,
    isRefreshing,
  };
}
