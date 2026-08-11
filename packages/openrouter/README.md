# `@vetryn/openrouter`

This package turns untrusted OpenRouter model metadata into immutable Vetryn catalog snapshots and
resolves a deterministic, policy-filtered candidate shortlist from a reviewed call-site manifest.

Catalog refreshes are explicit. Each observation binds its acquisition mode to either OpenRouter's fixed
public models endpoint or a repository-captured response. A successful refresh stores a content-addressed
snapshot plus a unique observation record; unchanged content reuses the snapshot but still records the new
observation. A failed refresh records only failure evidence and never identifies an older snapshot as current.
Tests inject `fetch`; CI never calls a live provider.

Candidate resolution excludes incomplete catalog entries, the baseline model, retired models, blocked
providers, and models missing required capabilities before ranking. The default and maximum candidate
limit is five. A repository may choose a lower limit. Ranking is exact-decimal projected cost ascending,
context window descending, then canonical model ID ascending.

```ts
import { FileCatalogStore, refreshOpenRouterCatalog, resolveCandidates } from "@vetryn/openrouter";

const refresh = await refreshOpenRouterCatalog({
  acquisition: "live-api",
  observedAt: new Date().toISOString(),
  refreshId: crypto.randomUUID(),
  store: new FileCatalogStore(".vetryn/catalog"),
});

if (refresh.status === "success") {
  const shortlist = resolveCandidates({ callSite, snapshot: refresh.snapshot });
}
```

Reproducible evaluation must consume the stored snapshot, never ambient live catalog state.
