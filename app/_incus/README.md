# Incus data client

The `_incus` folder is the new Incus-aware data layer. UI code asks for Incus
resources in domain terms, and this client decides how to fetch, cache, refresh,
and patch the data.

## Mental model

- Components use hooks such as `useStoragePools({ include: { resources: true } })`.
- Hooks subscribe to exact external-store resource keys with
  `useSyncExternalStore`. A storage-pool list listens to the collection key plus
  the visible rows' metadata/resources keys, not the entire Incus store. This
  gives React a narrow subscription surface while the Incus client remains the
  source of truth for persistence, fetch planning, and event updates.
- The store mirrors the Incus resource tree. For example, storage volumes live
  under storage pools, and project-scoped child resources include project in
  their item key.
- `include` describes desired data. It does not dictate recursion level or
  endpoint choice.
- Stale data remains visible. The client refreshes it in the background instead
  of blanking the UI.

## Cache statuses

- `missing`: nothing loaded and nothing in flight.
- `ready`: data is current.
- `stale`: data is usable but should refresh.
- `error`: the last request failed.

The store only persists durable cache statuses: `missing`, `ready`, `stale`,
and `error`. Request activity lives in `RequestRegistry`, so hooks derive UI
statuses instead of writing `loading` or `refreshing` into cached objects:

- `loading`: no usable data exists and a matching request is in flight.
- `refreshing`: stale/error data exists and a matching request is in flight.

This keeps fetch activity out of persisted state and makes duplicate request
dedupe the single source of truth for "in flight."

## Migration rule

New Incus API work should use this client. Do not add a second client-side
resource cache for Incus API data.
