# File Manager Notes

The file manager intentionally loads directory names and file metadata in two
separate phases.

- Directory listings (`children.names`) are the data that controls whether the
  table has rows. If names are cached or fetched, render rows immediately.
- When no listing names exist yet, show the full table skeleton for that cold
  listing load.
- Per-entry metadata (`type`, `size`, `mode`, `uid`, `gid`) is virtualized and
  fetched with bounded HEAD requests for visible rows. Do not block initial row
  render on metadata.
- Avoid reintroducing the full table skeleton when a listing already has names,
  even if metadata is stale, missing, or still loading. Metadata may show row-level
  pending UI instead.
- Keep cache invalidation in `app/_incus` resource/event helpers where possible;
  route UI should not hand-maintain Incus cache freshness for file mutations.
- UI code should consume semantic flags from `_incus` hooks. Do not branch on
  raw cache pairs such as `missing/loading` or `stale/refreshing` in route code.
