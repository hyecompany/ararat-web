# Repository Guidelines

## Project Structure & Module Organization

This is a Bun-managed Next.js 16 App Router project. Route files, layouts, contexts, hooks, and feature modules live in `app/`; grouped routes such as `app/(main)/instances` keep feature-specific `_components`, `_hooks`, and `_lib` beside their pages. Shared shadcn UI primitives live in `components/ui`, global hooks in `hooks`, and shared utilities in `lib`. Static assets are in `public`, currently `public/images`; build helpers are in `scripts`.

## Build, Test, and Development Commands

- `bun run dev`: starts the Next.js dev server and local proxy together.
- `bun run dev:next`: runs only `next dev`.
- `bun run dev:proxy`: runs `devProxy.ts`.
- `bun run build`: creates the production Next.js build.
- `bun run build:route-map`: regenerates route metadata from `scripts/generate-route-map.ts`.
- `bun run lint`: runs ESLint with Next.js core web vitals and TypeScript rules.
- `bun run format` / `bun run format:check`: writes or checks Prettier formatting.
- `bun run ci`: runs lint and build.

Use `bun install` when dependencies change so `bun.lock` stays authoritative.

## Coding Style & Naming Conventions

Write TypeScript and TSX with strict TypeScript enabled. Prettier enforces 2-space indentation, semicolons, single quotes in TypeScript, double quotes in JSX, trailing commas, and a 100-column print width. Tailwind classes are sorted by `prettier-plugin-tailwindcss`.

Use PascalCase for React components, camelCase for functions and variables, and kebab-case for route folders. Prefer configured aliases (@/*) when they improve readability.

## Testing Guidelines

No dedicated test runner is configured yet. Validate changes with `bun run lint` and `bun run build`; use `bun run ci` before opening a pull request. If you add tests, place them close to the code they cover and use clear names such as `instance-units.test.ts` or `create-dialog.spec.tsx`. Add the test command to `package.json` in the same change.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects and occasional Conventional Commit prefixes, for example `feat: add bug reporting issue template`. Keep commits focused. For pull requests, include a summary, validation commands, linked issue when applicable, and screenshots or recordings for visible UI changes. Note proxy, certificate, or Incus environment assumptions reviewers need.

## Security & Configuration Tips

Do not commit local secrets or new certificate material. Existing development certificate files are environment-specific. Be careful with `bun run build:copy`, which writes to `/opt/incus/ui` using `sudo` and should only run intentionally on a target machine.
