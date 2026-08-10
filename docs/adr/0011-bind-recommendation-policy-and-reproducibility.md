# ADR 0011: Bind recommendation policy and reproducibility

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The V1 product loop requires a candidate to clear a confidence floor and every recommendation PR to expose the
inputs needed to reproduce its comparison. A confidence number without its policy cannot determine whether a
patch is eligible, and an evaluation-input digest alone cannot show the evaluator, sampling, retry, scorer, or
variance context that produced it. Free-form diagnostic strings also make durable abstention evidence ambiguous.

## Decision

- Every call-site policy declares `minRecommendationConfidence`, with a default of 0.8. Candidate runs and
  recommendations preserve that floor; recommend outcomes must meet it, and a core assertion binds a run to the
  call-site policy.
- Every candidate run records compact, non-sensitive provenance: evaluator version and build reference, sampling
  configuration and seed, scorer identity/version/configuration digest, attempt count, ordered timestamps, and
  aggregate variance.
- Recommendation reason codes come from a finite V1 vocabulary and are valid only for compatible recommendation
  outcomes. Duplicate reason codes fail closed.

## Consequences

- The recommendation engine and reports can prove the confidence policy and reproduce the comparison without
  storing raw prompts, outputs, credentials, provider errors, or unbounded configuration payloads.
- Call-site policy and candidate evidence must be relationally validated before a recommendation is accepted.
- New reason-code semantics require an intentional Vetryn schema update instead of accepting input-derived labels.
