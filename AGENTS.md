<!-- BEGIN:nextjs-agent-rules -->
 
# Next.js: ALWAYS read docs before coding
 
Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.
 
<!-- END:nextjs-agent-rules -->

# Repository Guidelines

**Next.js Initialization**: When starting work on a Next.js project, automatically
call the `init` tool from the next-devtools-mcp server FIRST. This establishes
proper context and ensures all Next.js queries use official documentation.

## Project Structure & Module Organization

Route files, layouts, contexts, hooks, and feature modules live in `app/`; grouped routes such as `app/(main)/instances` keep feature-specific `_components`, `_hooks`, and `_lib` beside their pages. Shared shadcn UI primitives live in `components/ui`, global hooks in `hooks`, and shared utilities in `lib`. Static assets are in `public`, currently `public/images`; build helpers are in `scripts`.

### Feature modules next to the route that owns them

Code that exists only for a specific route should live **under that route segment**, not in a parent `_hooks` / `_lib` folder unless it is shared across multiple routes under the same parent.

- **Example (instance file browser):** API clients, route-only hooks, and helpers such as remote move logic belong under `app/(main)/instance/files/`—e.g. `files/_hooks/`, `files/_lib/`—not in `instance/_hooks` or `instance/_lib` when nothing else imports them.
- **`app/(main)/_lib/files/`** (and similar) is for **cross-cutting** file UI concerns shared by multiple hosts (path normalization, open/download policy, etc.), not for Incus-instance-only API wrappers.

When adding a new feature, default to **colocating** `_hooks` and `_lib` with the `page.tsx` that uses them; lift to a parent folder only when two or more sibling routes need the same module.

## Build, Test, and Development Commands
- `bun run dev` starts the development server on :3001, with the UI accesible on `/ui`.
- `bun run lint`: runs `eslint .`.
- `bun run typecheck` runs `tsc --noEmit`.
- `bun run ci`: runs lint, typecheck, and build in sequence

## Local Verification

- For browser or manual verification, always use the proxied app URL on `http://localhost:3001/ui/...`.
- Do not use `http://localhost:3000` for normal UI testing. Port `3000` is the underlying Next.js server, while the user-facing local app is `:3001/ui`.

## Toast Policy

- Do not call `toast.*` directly from UI code (pages, components, hooks, or libs).
- The only allowed place to emit toast notifications is the event handler in `app/_context/events.tsx`.
- UI flows may set local state for inline rendering (e.g., alerts), but must not emit manual toast notifications.

## Incus Data Fetching

- New Incus API reads must use the Incus data client in `app/_incus` instead of adding ad hoc resource fetch hooks or direct data-loading `fetch` calls.
- New Incus API mutations must use shared transport helpers from `app/_incus/transport.ts` and must update or mark the Incus store so loaded UI stays consistent with the event-backed cache.
- Legacy Incus resource hooks have been migrated to the Incus data client; do not add a parallel client-side cache for Incus resources.
- Use Prisma-style `include` options for resource hooks. `include` describes what data is needed; the client decides the cheapest Incus transport strategy.
- Add comments for non-obvious data-layer logic, especially external-store subscriptions, cache statuses, scoped collections, include planning, filter batching, request dedupe, bounded concurrency, and event freshness.
