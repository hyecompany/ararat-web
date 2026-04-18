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

## Build, Test, and Development Commands
- `bun run dev` starts the development server on :3001, with the UI accesible on `/ui`.
- `bun run lint`: runs `eslint .`.
- `bun run typecheck` runs `tsc --noEmit`.
- `bun run ci`: runs lint, typecheck, and build in sequence