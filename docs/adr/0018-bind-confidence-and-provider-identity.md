# ADR 0018: Bind confidence and provider identity to candidate evidence

> Partially superseded by ADR 0019. The confidence decision remains active; model-ID namespaces now bind
> `modelAuthor`, not execution-provider identity.

## Context

Recommendation confidence and catalog provider metadata are untrusted artifact inputs. A producer could otherwise
set a high recommendation confidence without support from candidate-run results, or relabel an `openai/...` model
as an approved provider while recomputing the catalog content digest.

## Decision

- For a recommend outcome, confidence cannot exceed the lowest cited complete candidate run's variance-adjusted
  pass-rate lower bound: `passedCases / caseCount - passRateStdDev`, clamped to `[0, 1]`. The comparison admits
  only a four-`Number.EPSILON` absolute tolerance to preserve an exact mathematical boundary across IEEE-754
  representation noise.
- A catalog model's `provider` must equal the provider segment before the first slash in its canonical model ID.

## Consequences

Confidence is a conservative, deterministic claim tied to durable candidate evidence. Catalog provider policy is
evaluated against a canonical model identity rather than independently supplied metadata. More expressive confidence
models require a later, explicitly versioned evaluator and artifact-contract change.
