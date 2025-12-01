# Project Overview

This project (Hye Ararat) is a web app that allows users to manage system/app containers and VMs. It is built on Next.js and drives the Incus API.

## Build, Lint, and Format Commands

```bash
# Install dependencies
bun install

# Development server
bun run dev

# Production build
bun run build

# Start production server
bun run start

# Lint the codebase
bun run lint

# Format code with Prettier
bun run format

# Check formatting without modifying files
bun run format:check
```

## Folder Structure

- Files are in the nearest shared parent of all consumers.
- `_components`, `_utils`, `_lib`, `_hooks`, and `_context` are used at that level.
- Consumer-specific files remain in their respective consumer folders.
- Files shared across consumers are placed in the nearest appropriate parent folder.

### Component Organization

- **Instance-specific components**: Located in `app/(main)/instances/_components/`
  - Example: `app/(main)/instances/_components/devices.tsx` for instance device management
- **Shared components**: Located in `app/(main)/_components/`
  - Example: `app/(main)/_components/devices.tsx` for reusable device editor (used across instances and profiles)

### API Integration Pattern

When creating new API functionality, follow this structure based on the highest-level consumer:

1. **Identify the highest-level component** that uses the functionality
2. **Place files in the nearest shared parent** of all consumers
3. **Naming convention**: Name files based on their domain (e.g., `storagePools.ts` for storage pool APIs, not `server.ts`)

**Example Structure:**

- If `app/(main)/_components/devices.tsx` is the highest consumer:
  - Types: `app/(main)/_lib/storagePools.d.ts`
  - API functions: `app/(main)/_lib/storagePools.ts`
  - Hooks: `app/(main)/_hooks/storagePools.ts`

**Global APIs** (used across multiple top-level routes):

- Types: `app/_lib/server.d.ts`
- API functions: `app/_lib/server.ts`
- Hooks: `app/_hooks/server.ts`

## Libraries

- Tailwind CSS for the frontend
- shadcn/ui based components in `app/_components/ui`
- swr for data fetching
- zod for schema validation
- react-hook-form for form management

## Data Fetching Patterns

### API Functions

Use the `jsonFetcher` utility from `app/_lib/fetcher.ts` for all Incus API calls:

```typescript
import { jsonFetcher } from '@/app/_lib/fetcher';

export async function getResource() {
  return jsonFetcher('/1.0/resource').then(
    (data) => data.metadata as ResourceType,
  );
}
```

### SWR Hooks

Create custom hooks using SWR for data fetching with caching:

```typescript
import useSWR from 'swr';
import { getResource } from '../_lib/resource';

export function useResource() {
  return useSWR('/1.0/resource', getResource);
}
```

## Coding Conventions

- Use TypeScript for all new files
- Define types in separate `.d.ts` files alongside implementation files
- Use single quotes for strings (enforced by Prettier)
- Use semicolons (enforced by Prettier)
- Prefer named exports over default exports for API functions and hooks
- Use `@/` path alias for imports from the `app` directory
