# ADR 0010: Bind recommendations to comparative evidence

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

V1 recommendations must be reproducible, fail closed, and safe to turn into a one-literal patch. A candidate
measurement alone cannot show the current-versus-candidate delta, and an artifact reference without relational
checks could allow unrelated, failed, or stale evidence to support a recommendation or patch.

## Decision

- A complete candidate run records aggregate baseline and candidate metrics for the same evaluated case count,
  together with explicit pass/fail outcomes for the quality, cost, latency, context, and privacy hard gates.
- A recommend outcome accepts only complete candidate runs that match its call site, baseline model, catalog
  snapshot, candidate model, and evaluation-input digest, and whose hard-gate outcomes all pass.
- Abstention outcomes validate the same provenance bindings for every cited candidate run, while permitting
  incomplete or failed runs as bounded diagnostic evidence.
- Recommendations carry the bound source location and fingerprint. A patch plan is operationally valid only when
  its recommendation ID, call site, expected model, replacement model, and source binding exactly match that
  recommendation.

## Consequences

- V1 reports retain the baseline measurements needed to reproduce quality, cost, latency, and error deltas.
- Consumers must call the relational recommendation and patch-plan assertions before proposing a patch; parsing
  an individual strict artifact alone cannot establish cross-artifact truth.
- The core remains pure and stores only aggregate metrics, opaque digests, stable identifiers, and bounded gate
  results; it still excludes raw prompts, outputs, credentials, provider errors, and source diffs.
