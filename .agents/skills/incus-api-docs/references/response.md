# Get Shared Response Type

Use the get-response script to retrieve the documentation for a reusable response type from the Incus API specification.

## Usage

```bash
bun run .agents/skills/incus-api-docs/scripts/get-response.ts <name>
```

- **`<name>`**: The exact name of the shared response (e.g., `BadRequest`, `SyncResponse`, `OperationResponse`).

## Example

- **Get the structure for the SyncResponse shared type**:
  `bun run .agents/skills/incus-api-docs/scripts/get-response.ts SyncResponse`

## When to use
Use this script whenever an endpoint refers to a shared response type via `$ref: "#/responses/SomeName"`. This is common for standard responses like success metadata, error codes, and background operation tokens.
