# ADR 0017: Derive privacy gates from approved provider policy

> Superseded by ADR 0019 for execution-provider identity and route evidence.

## Context

Catalog models expose their provider, while a candidate run's privacy outcome is producer-supplied. Without a
reviewed call-site provider policy, a model from an unapproved provider could retain a `privacy: "pass"` label and
authorize a recommendation.

## Decision

- Call-site specifications and manifests require an explicit nonempty `providerPolicy.allowedProviders` allowlist.
- Recommendation validation rejects candidate models outside that allowlist.
- For a complete run, the persisted privacy outcome must be `pass` only after the candidate meets that reviewed
  provider policy.

## Consequences

Provider choice becomes a durable, reviewable privacy input. V1 does not infer unrecorded geographic policy;
provider adapters and later policy work must extend the catalog and manifest deliberately before adding region
enforcement.
