/**
 * Ararat is served by the Incus web server. The Incus web server, regardless of the URL path, always serves index.html.
 * Next.js conflicts with Incus's approach, as it generates an HTML file for each route rather than serving an SPA from a single index.html.
 * This component uses the Next.js client-side router to re-push the current path on the first render, ensuring that the correct route is loaded.
 * When Next.js serves a route that doesn't exist, it reloads the page. If not implemented carefully, this can lead to an infinite reload loop.
 * The dev proxy does not simulate this behavior
 * @file Router component to accomodate divergence between Next.js static output and Incus's SPA serving approach
 * @author Joseph Maldjian <joseph.maldjian@hyecompany.com>
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

interface RouteMap {
  basePath?: string;
  routes?: string[];
}

const ROUTE_MAP_URL = '/ui/route-map.json';
let routeMapPromise: Promise<RouteMap | null> | null = null;

function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split('?')[0]?.split('#')[0] ?? '/';
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/');

  if (collapsed === '' || collapsed === '/') {
    return '/';
  }

  const trimmed = collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath || basePath === '/') {
    return pathname;
  }

  if (pathname === basePath) {
    return '/';
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length);
  }

  return pathname;
}

async function loadRouteMap(): Promise<RouteMap | null> {
  if (!routeMapPromise) {
    routeMapPromise = fetch(ROUTE_MAP_URL)
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as RouteMap;
        if (!payload.routes || payload.routes.length === 0) {
          return null;
        }

        return payload;
      })
      .catch(() => null);
  }

  return routeMapPromise;
}

function NotFoundFallback() {
  return (
    <div
      style={{
        fontFamily:
          'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
        height: '100vh',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div>
        <h1
          style={{
            display: 'inline-block',
            margin: '0 20px 0 0',
            padding: '0 23px 0 0',
            fontSize: 24,
            fontWeight: 500,
            verticalAlign: 'top',
            lineHeight: '49px',
            borderRight: '1px solid rgba(0,0,0,.3)',
          }}
        >
          404
        </h1>
        <div style={{ display: 'inline-block' }}>
          <h2 style={{ fontSize: 14, fontWeight: 400, lineHeight: '49px', margin: 0 }}>
            This page could not be found.
          </h2>
        </div>
      </div>
    </div>
  );
}

export default function Router({ children }: { children: React.ReactNode }) {
  const runRef = useRef(false);
  const [isNotFound, setIsNotFound] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (typeof window === 'undefined' || runRef.current) {
      return;
    }

    runRef.current = true;
    let cancelled = false;

    const bootstrapRoute = async () => {
      const routeMap = await loadRouteMap();
      if (!routeMap) {
        return;
      }

      const basePath = routeMap.basePath ?? '/ui';
      const browserPathname = normalizePath(window.location.pathname);
      const targetPathname = normalizePath(stripBasePath(browserPathname, basePath));
      const knownRoutes = new Set((routeMap.routes ?? []).map((route) => normalizePath(route)));

      if (!knownRoutes.has(targetPathname)) {
        if (!cancelled) {
          setIsNotFound(true);
        }
        return;
      }

      if (targetPathname !== '/') {
        const search = window.location.search;
        const targetPath = search ? `${targetPathname}${search}` : targetPathname;
        router.push(targetPath);
      }
    };

    void bootstrapRoute();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (isNotFound) {
    return <NotFoundFallback />;
  }

  return <>{children}</>;
}
