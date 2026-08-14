# `@vetryn/openrouter`

This package turns untrusted OpenRouter model metadata into immutable Vetryn catalog snapshots and
resolves a deterministic candidate shortlist from a reviewed call-site manifest.

Catalog refreshes are explicit. Each observation binds its acquisition mode to either OpenRouter's fixed
public models endpoint or a repository-captured response. A successful refresh stores a content-addressed
snapshot plus a unique observation record; unchanged content reuses the snapshot but still records the new
observation. A failed refresh records only failure evidence and never identifies an older snapshot as current.
Live observations derive their timestamp from the acquisition clock; captured responses require an explicit
repository timestamp and reject values more than five minutes ahead of the trusted clock. Existing same-digest snapshots are reused only when their OpenRouter identity and temporal
provenance are compatible. Duplicate model IDs are retained only when every row normalizes identically; conflicting
or invalid duplicate rows exclude that model ID. Replay requires the canonical
digest-derived OpenRouter snapshot identity. Successful refresh persistence publishes a new snapshot before its
immutable observation, which acts as the commit record; if observation publication fails, the new snapshot is rolled
back. Completed snapshots and observations publish atomically from
same-directory temporary files without overwriting an existing immutable identity. Snapshot persistence is serialized
per content digest so concurrent refresh observations report whether they actually reused an existing snapshot. A stale
lock fails closed with an actionable error rather than changing evidence. File-backed stores reject symbolic-link components and verify resolved
write destinations remain beneath the configured store root. Catalog acquisition and body consumption share a
30-second abort deadline; expiration records explicit failure evidence. Tool-call compatibility requires explicit
`tools` parameter support rather than `tool_choice` alone. Tests inject `fetch`; CI never calls a live provider.

Candidate resolution excludes incomplete catalog entries, the baseline model, retired models, and models missing
required capabilities before ranking. OpenRouter's model-ID namespace is exposed as `modelAuthor`; it is not treated
as proof of the provider that executes a request. The shortlist separately carries the manifest's reviewed route
policy. The default and maximum candidate limit is five. A repository may choose a lower limit. Ranking is
exact-decimal estimated model-level cost ascending, context window descending, then canonical model ID ascending.
The estimate is a shortlist input, not observed provider billing.

Use `createOpenRouterRouteRequestPolicy(shortlist.routePolicy)` to build the exact provider preferences and opt-in
router-metadata header supplied with an evaluation request. V1 requires one reviewed provider slug, `allow_fallbacks: false`,
`require_parameters: true`, `data_collection: "deny"`, and `zdr: true`. Complete candidate-run evidence must later
bind this request policy to redacted OpenRouter router metadata; catalog authorship alone never satisfies privacy.

```ts
import { FileCatalogStore, refreshOpenRouterCatalog, resolveCandidates } from "@vetryn/openrouter";

const refresh = await refreshOpenRouterCatalog({
  acquisition: "live-api",
  refreshId: crypto.randomUUID(),
  store: new FileCatalogStore(".vetryn/catalog"),
});

if (refresh.status === "success") {
  const shortlist = resolveCandidates({
    callSite,
    observation: refresh.observation,
    snapshot: refresh.snapshot,
  });
}
```

Reproducible evaluation must consume the stored snapshot together with its successful refresh observation,
never ambient live catalog state. Candidate shortlists bind both evidence IDs and the authenticated observation time.

`evaluateOpenRouterCandidate` runs the reviewed baseline and candidate over the same cases with bounded concurrency,
requests, retries, timeout, and spend. Deterministic required-fact and output-shape checks combine with hard quality,
cost, latency, context, privacy, and route-evidence gates. Raw inputs and outputs remain transient. Partial, exhausted,
invalid-route, or missing-metadata runs are incomplete and cannot support a recommendation.

Actionable evaluation accepts only a `CurrentCatalogRefresh` created in memory by the canonical acquisition path.
Serialized or caller-labeled lineage cannot be substituted. The lineage is complete, ordinal, terminal-success
evidence and is later authenticated in the repository receipt chain. Tests inject an offline transport; production
uses `createOpenRouterEvaluationTransport` with an explicitly supplied key and applies the reviewed route policy at
the request boundary.
