# ADR 0012: Derive recommendation gates from bound evidence

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Candidate-run artifacts contain producer-supplied gate labels and an opaque catalog snapshot reference. Those fields
are not sufficient to authorize a patch: a producer could label failing metrics as passing, or name an unavailable
candidate model without proving it exists in the referenced snapshot.

## Decision

- The core derives measurable quality, cost-savings, and latency outcomes from the candidate and baseline metrics
  against the bound call-site policy. A complete run's recorded outcomes must exactly match those derived values.
- Recommendation validation receives the bound call site and catalog snapshot. It verifies the recommendation's
  source binding, baseline, confidence floor, and snapshot identity against the call-site evidence.
- A recommended candidate must be present and non-retired in that snapshot, support V1 text generation, and have a
  context window at least as large as the reviewed representative usage.
- Context and privacy remain explicit hard outcomes because their complete requirements are resolved by later
  scanner/provider policy layers; they must pass but are not fabricated from absent policy inputs.

## Consequences

- A recommendation cannot rely on self-reported quality, cost, or latency labels to authorize a patch.
- Core callers must supply the parsed call-site and catalog artifacts when validating recommendation evidence.
- The pure core continues to use only local, versioned artifacts and deterministic arithmetic; provider calls and
  raw inputs remain outside the package.
