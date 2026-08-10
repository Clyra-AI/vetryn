# ADR 0013: Bind recommendation evidence to reviewed eval suites

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

A candidate run can report an arbitrary case count while still matching an opaque evaluation-input digest. Without
the parsed reviewed eval suite, recommendation validation cannot prove which fixture was evaluated, whether it
belongs to the selected call site, or whether its reviewed case count supports the quality policy.

## Decision

- Candidate runs record the immutable eval-suite artifact ID and fixture digest alongside the evaluation-input
  digest.
- Recommendation validation receives the parsed eval suite and checks its call-site identity, the candidate run's
  suite and fixture bindings, and the exact baseline/candidate aggregate case counts for complete runs.

## Consequences

- An invented or unrelated case count cannot clear a quality gate and produce a patch.
- Core callers supply the parsed reviewed eval suite together with the call site and catalog snapshot when
  validating recommendation evidence.
- The durable contract continues to contain only identifiers, digests, aggregates, and bounded provenance—not raw
  eval inputs or model outputs.
