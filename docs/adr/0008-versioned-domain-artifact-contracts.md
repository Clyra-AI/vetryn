# ADR 0008: Version V1 domain artifacts

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

V1 needs a stable provider-neutral boundary before scanner, catalog, evaluator, and patcher packages are
implemented. The initial core package validates only a call-site stub, which cannot preserve the provenance,
privacy, and abstention semantics required by a reviewable upgrade recommendation.

## Decision

- Define strict `1.0.0` core contracts and a canonical JSON serializer for call-site manifests, eval suites,
  catalog snapshots, candidate runs, recommendations, and patch plans. Each artifact declares its type and
  schema version; unrecognized versions, fields, and logically incompatible states fail closed.
- Keep source bindings, model IDs, opaque digests, aggregate measurements, safe case identifiers, and enumerated
  diagnostics. Exclude credentials, raw prompts, raw model outputs, unbounded provider errors, and source diffs
  from durable core artifacts.
- Require failed-case identifiers to be unique. A recommendation may use a completed candidate run only when its
  call site, baseline model, catalog snapshot, candidate model, and evaluation-input digest all match the proposed
  model change.
- Keep call-site identity human-owned in the manifest. Artifact identifiers are deterministic from a declared
  artifact type and stable identifier parts; the core does not infer semantic identity from source locations.
- Keep `@vetryn/core` pure. It exposes validation, deterministic identity, canonical serialization, and digest
  freshness checks, while filesystem, network, provider, AST, and GitHub behavior remain in outer packages.

## Consequences

- Later packages can exchange durable evidence without importing provider, filesystem, network, AST, or GitHub
  behavior into `@vetryn/core`.
- The core artifact boundary is intentionally data-minimal: raw fixture content and execution output remain local
  execution inputs rather than report fields.
- Every future reader must reject an unknown artifact version rather than guessing at migration behavior.
