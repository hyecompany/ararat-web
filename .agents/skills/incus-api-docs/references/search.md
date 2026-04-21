# Search API Spec

Use the search script to discover available paths, definitions, or shared responses within the Incus API specification.

## Usage

```bash
bun run .agents/skills/incus-api-docs/scripts/search.ts <type> <query>
```

- **`<type>`**: Must be one of `paths`, `definitions`, or `responses`.
- **`<query>`**: The keyword to search for (case-insensitive for definitions and responses).

## Examples

- **Search for instance-related paths**:
  `bun run .agents/skills/incus-api-docs/scripts/search.ts paths instances`
- **Search for definitions containing "Instance"**:
  `bun run .agents/skills/incus-api-docs/scripts/search.ts definitions instance`
- **Search for shared responses containing "Sync"**:
  `bun run .agents/skills/incus-api-docs/scripts/search.ts responses sync`

## When to use
Use this script when you need to find the exact path for an operation or the correct name for a schema definition before fetching its full documentation.
