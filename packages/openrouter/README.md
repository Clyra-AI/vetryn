# `@vetryn/openrouter`

This package turns untrusted OpenRouter model metadata into immutable Vetryn catalog snapshots and
resolves a deterministic, policy-filtered candidate shortlist from a reviewed call-site manifest.

Catalog refreshes are explicit. Each observation binds its acquisition mode to either OpenRouter's fixed
public models endpoint or a repository-captured response. A successful refresh stores a content-addressed
snapshot plus a unique observation record; unchanged content reuses the snapshot but still records the new
observation. A failed refresh records only failure evidence and never identifies an older snapshot as current.
Live observations derive their timestamp from the acquisition clock; captured responses require an explicit
repository timestamp and reject values more than five minutes ahead of the trusted clock. Existing same-digest snapshots are reused only when their OpenRouter identity and temporal
provenance are compatible. Duplicate model IDs are retained only when every row normalizes identically; conflicting
or invalid duplicate rows exclude that model ID. Replay requires the canonical
digest-derived OpenRouter snapshot identity. Successful refresh persistence records the immutable observation before
publishing a new snapshot and rolls the observation back if snapshot publication fails, so a failed refresh cannot
leave a directly replayable orphan snapshot. File-backed stores reject symbolic-link components and verify resolved
write destinations remain beneath the configured store root. Catalog acquisition and body consumption share a
30-second abort deadline; expiration records explicit failure evidence. Tool-call compatibility requires explicit
`tools` parameter support rather than `tool_choice` alone. Tests inject `fetch`; CI never calls a live provider.

Candidate resolution excludes incomplete catalog entries, the baseline model, retired models, blocked
providers, and models missing required capabilities before ranking. The default and maximum candidate
limit is five. A repository may choose a lower limit. Ranking is exact-decimal projected cost ascending,
context window descending, then canonical model ID ascending.

```ts
import { FileCatalogStore, refreshOpenRouterCatalog, resolveCandidates } from "@vetryn/openrouter";

const refresh = await refreshOpenRouterCatalog({
  acquisition: "live-api",
  refreshId: crypto.randomUUID(),
  store: new FileCatalogStore(".vetryn/catalog"),
});

if (refresh.status === "success") {
  const shortlist = resolveCandidates({ callSite, snapshot: refresh.snapshot });
}
```

Reproducible evaluation must consume the stored snapshot, never ambient live catalog state.
