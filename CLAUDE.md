# Next.js Knowledge & Tooling

At the start of every session working on this project, call the `init` tool from `next-devtools-mcp` first — before any code reading or editing. This sets up proper context and documentation requirements. Do this automatically without being asked.

# Incus

# Runtime & Package manager

Use **Bun** for all runtime & package operations (`bun add`, `bun remove`, etc.). Do not use npm or yarn.

# Dev proxy / authentication

In production, Incus serves the UI on `/ui`.

Development mode (`bun run dev`) simulates this, serving the Next.js development server on `/ui*`, and Incus routes on all others.

As this is a development proxy, TLS authentication works a little differently

- Leave `DEV_PROXY_UPSTREAM_CLIENT_PFX` **unset** to test OIDC authentication flow.
- Setting `DEV_PROXY_UPSTREAM_CLIENT_PFX=1` authenticates via TLS client cert auth (uses `./ararat.pfx`).

# Build output

Next.js is configured as a **static export** (`output: 'export'`) with `basePath: '/ui'`. Do not add server-side features (API routes, server components with dynamic data) that require a Node.js runtime.

# TypeScript path aliases

- `@/*` → project root
- `ui-web/*` → `components/ui`, `hooks`, `lib` (local shadcn/ui components)
