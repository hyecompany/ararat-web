# Gemini Project Context: Hye Ararat Web Client

## Project Overview
Hye Ararat Web Client is a modern, high-performance web interface for managing **Incus** infrastructure. It is built using **Next.js 16 (React 19)** and **Bun**, utilizing a static export strategy to be served directly by the Incus web server.

### Core Stack
- **Framework:** Next.js 16 (App Router)
- **Runtime:** Bun
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 (Alpha/Beta), Radix UI (shadcn/ui), Lucide & Tabler Icons
- **Data Fetching:** SWR (Stale-While-Revalidate)
- **Infrastructure:** Designed for deployment to `/opt/incus/ui` on Incus hosts.

## Architecture & Design Patterns

### Static Export & SPA Routing
The project uses `output: 'export'` with a `basePath: '/ui'`. Because Incus serves the same `index.html` for all sub-paths, a custom `Router` component (`app/router.tsx`) is used to reconcile Next.js static pages with client-side routing and prevent infinite reload loops.

### Development Proxy
A custom development proxy (`devProxy.ts`) is used to:
- Proxy API requests to the Incus backend (defaulting to `https://localhost:8443`).
- Handle TLS certificates and PFX-based client authentication.
- Simulate the production environment where the UI is served under the `/ui` prefix.

### State Management
The application is heavily reliant on **React Context** for global state:
- `AuthenticationProvider`: Manages session state (TLS vs OIDC) and redirects.
- `ThemeProvider`: Handles Dark/Light/System themes.
- `EventEmitterProvider`: Facilitates cross-component communication.
- `UserProvider` & `ProjectsProvider`: Manage domain-specific data.

### UI Components
Components are based on **shadcn/ui** and are located in `components/ui/`. They are aliased as `ui-web/components/*` via `tsconfig.json`.

## Key Commands

| Command | Description |
| :--- | :--- |
| `bun run dev` | Starts Next.js dev server and the `devProxy.ts` (Primary dev entry point). |
| `bun run build` | Generates the static export in the `out/` directory. |
| `bun run build-install` | Full pipeline: Build -> Generate Route Map -> Copy to `/opt/incus/ui`. |
| `bun run lint` | Runs ESLint for code quality. |
| `bun run format` | Formats the codebase using Prettier. |
| `bun run dev:proxy` | Runs only the TLS/API proxy. |

## Development Conventions

### Routing
- Add new routes in the `app/` directory as usual.
- During the build process, `scripts/generate-route-map.ts` scans the `app` directory to generate `route-map.json`, which the `Router` component uses to validate client-side transitions.

### Path Aliases
- `@/*`: Maps to the project root.
- `ui-web/components/*`: Maps to `components/ui/*`.
- `ui-web/hooks/*`: Maps to `hooks/*`.
- `ui-web/lib/*`: Maps to `lib/*`.

### Authentication
The app supports both **TLS (Certificate)** and **OIDC** authentication. The `AuthenticationProvider` automatically handles redirects to `/authentication/login` if the user is "untrusted".

### TLS in Development
To run the development proxy, you must have `server.crt` and `server.key` (usually from your Incus host) in the project root. If using PFX authentication, configure the `DEV_PROXY_UPSTREAM_CLIENT_PFX` environment variables in `.env`.
