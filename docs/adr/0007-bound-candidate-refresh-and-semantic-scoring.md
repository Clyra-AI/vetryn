# ADR 0007: Bound candidate refresh and gate semantic scoring

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

OpenRouter exposes a mutable catalog whose models, aliases, capabilities, availability, and prices can
change independently of a repository. Evaluating every compatible entry would create unbounded provider
spend and runtime. Enabling a recurring workflow by default would also make installation itself a billing
event. At the same time, V1's deterministic scorers cannot establish semantic non-inferiority for every
open-ended workload.

## Decision

- Treat OpenRouter as the V1 catalog universe, not as the candidate set.
- Apply hard compatibility and repository policy filters before selection.
- Select at most five candidates by default and permit repositories only to lower that bound. Use stable
  ordering and canonical model IDs as the final tie-breaker.
- Normalize live catalog content and compute a content digest. Reuse the immutable snapshot when the
  digest is unchanged; never mutate an existing snapshot.
- Report a live refresh failure explicitly. An older snapshot may be used for explicit historical replay
  but must not be represented as current.
- Make provider-backed assessment manual by default. Scheduling requires explicit repository opt-in.
- Bind an evaluation-input digest to the catalog, source, manifest, fixtures, scorer policy, and relevant
  execution configuration. When both catalog and evaluation inputs are unchanged, skip paid candidate
  execution and reuse the existing recommendation identity and evidence.
- Keep LLM judges outside OSS V1. Design an optional calibrated semantic-rubric scorer only after V1 field
  validation demonstrates that deterministic evaluation blocks valuable open-ended call sites.

## Consequences

- Candidate discovery remains broad while execution cost and latency remain bounded.
- Identical inputs produce stable shortlists and do not create duplicate snapshots, provider calls, or
  pull requests.
- Refresh and replay have distinct semantics, so stale provider state cannot silently support a current
  recommendation.
- Users opt into recurring spend rather than inheriting it from installation.
- A later semantic scorer requires a separate reviewed decision covering human calibration, judge-model
  provenance, bias controls, abstention, privacy, and spend. It supplements deterministic and hard gates;
  it does not replace them.
