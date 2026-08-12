# ADR 0019: Separate model author identity from execution-route evidence

## Context

OpenRouter model IDs use a namespace such as `openai/gpt-4o-mini`, but that namespace does not prove which
provider endpoint served a request. OpenRouter load-balances across providers by default and exposes request-level
controls through the `provider` object. Its router metadata separately reports the requested model, provider
attempts, and selected endpoint. Treating a model namespace as execution identity lets untrusted catalog metadata
stand in for privacy evidence.

The relevant upstream contracts are OpenRouter's
[provider-routing reference](https://openrouter.ai/docs/guides/routing/provider-selection) and
[router-metadata reference](https://openrouter.ai/docs/guides/features/router-metadata). Router metadata is opt-in,
is absent on cache hits, and can add optional fields, so Vetryn stores only a strict redacted projection needed for
decision evidence.

## Decision

- Catalog models expose `modelAuthor`, which must match the first segment of the canonical model ID. It is
  descriptive catalog metadata only.
- Every call site owns a strict V1 OpenRouter route policy: one provider slug, fallbacks disabled, all requested
  parameters required, data collection denied, and ZDR required.
- The OpenRouter adapter converts that policy to request provider preferences. Shortlists preserve the policy
  separately from candidate author metadata and label catalog-price calculations as estimates.
- A complete candidate run binds the exact route policy and a compact `openrouter-router-metadata` observation.
  The observation records every reported attempt and one selected provider/model. Exactly one successful attempt
  per request must reconcile with that selection, request and attempt ordinals must be complete, and the selected
  model must be the candidate model. Router attempts and evaluator repetitions remain separate units.
- Missing metadata, cache-hit responses without metadata, contradictory selections, or a route-policy mismatch
  cannot support a complete recommendation. Failed and incomplete runs may retain reconciled failed attempts with
  a null selection; a successful attempt without a selected provider fails validation. They always abstain.
- Privacy remains a hard gate, but catalog authorship can never satisfy it. V1-06 must derive it from the
  request-bound route policy and validated router observation.
- Scanner coverage is reported as a reconciled, explicitly scoped assessment funnel rather than an unqualified
  count of discovered AI usage.

## Consequences

This is an intentionally incompatible pre-release format change from `providerPolicy` to `routePolicy`, from
catalog `provider` to `modelAuthor`, and from projected to explicitly estimated shortlist costs. Existing checked-in
artifacts must be regenerated or migrated before evaluation. The change supersedes the provider-identity portion of
ADR 0017 and ADR 0018; their confidence and hard-gate decisions remain in force.

Observed provider billing and production traces remain distinct evidence tiers. V1 shortlist estimates are useful
for candidate ordering, while evaluation measurements and later production corroboration support realized-value
claims. No hosted control plane or automatic merge is introduced.
