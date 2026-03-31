import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PrerenderManifest {
  routes?: Record<string, unknown>;
}

interface RoutesManifest {
  basePath?: string;
}

interface RouteMap {
  version: 1;
  generatedAt: string;
  basePath: string;
  routes: string[];
}

const INTERNAL_ROUTE_PATTERN = /^\/_/;
const FILE_LIKE_ROUTE_PATTERN = /\.[a-zA-Z0-9]+$/;

function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split('?')[0]?.split('#')[0] ?? '/';
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/');

  if (collapsed === '' || collapsed === '/') {
    return '/';
  }

  const trimmed = collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function isPublicAppRoute(pathname: string): boolean {
  if (pathname === '/') {
    return true;
  }

  if (INTERNAL_ROUTE_PATTERN.test(pathname)) {
    return false;
  }

  return !FILE_LIKE_ROUTE_PATTERN.test(pathname);
}

function loadJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function main() {
  const rootDir = process.cwd();
  const prerenderManifestPath = resolve(rootDir, '.next', 'prerender-manifest.json');
  const routesManifestPath = resolve(rootDir, '.next', 'routes-manifest.json');
  const outDir = resolve(rootDir, 'out');
  const routeMapPath = resolve(outDir, 'route-map.json');

  const prerenderManifest = loadJsonFile<PrerenderManifest>(prerenderManifestPath);
  const routesManifest = loadJsonFile<RoutesManifest>(routesManifestPath);

  const routes = new Set<string>();
  for (const route of Object.keys(prerenderManifest.routes ?? {})) {
    const normalized = normalizePath(route);
    if (isPublicAppRoute(normalized)) {
      routes.add(normalized);
    }
  }

  if (routes.size === 0) {
    throw new Error(
      `No public routes found in ${prerenderManifestPath}. Did next build run successfully?`,
    );
  }

  const routeMap: RouteMap = {
    version: 1,
    generatedAt: new Date().toISOString(),
    basePath: routesManifest.basePath ?? '/ui',
    routes: [...routes].sort((a, b) => a.localeCompare(b)),
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(routeMapPath, `${JSON.stringify(routeMap, null, 2)}\n`, 'utf8');

  console.log(`Generated route map with ${routeMap.routes.length} routes at ${routeMapPath}`);
}

main();
