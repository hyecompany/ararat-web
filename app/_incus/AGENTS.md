# Incus Data Client Instructions

## Events Documentation

Before changing event routing, resource-path parsing, cache invalidation, or event-backed Incus data behavior in this subtree, read the Incus events source documentation:

`http://localhost:3001/documentation/_sources/events.md.txt`

The OpenAPI spec does not fully describe event stream semantics. Treat the events documentation as the source of truth for `/1.0/events`, lifecycle events, operation events, and logging events.

## Event Routing Guardrails

- Route event-backed cache changes from documented event metadata and resource paths.
- Prefer parsing Incus resource paths into store identities over inferring targets from action strings alone.
- Keep cache updates aligned with the Incus store resource keys in `resources.ts`; when adding a new event-backed resource kind, define both parsing and `keysForResource` behavior.
