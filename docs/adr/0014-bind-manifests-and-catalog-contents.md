# ADR 0014: Bind manifests to eval suites and catalog snapshots to content

## Context

A candidate run already named an eval-suite artifact and a catalog snapshot. That alone was not enough to
prove that the suite was the one declared by the call-site manifest or that a snapshot's model capabilities and
prices still matched the snapshot's declared content digest.

## Decision

- A call site declares an `eval-suite:*` artifact ID, and recommendation validation rejects a supplied suite that
  differs from that declaration.
- A catalog snapshot's `contentDigest` is the `sha256:` digest of canonical JSON for its normalized model list,
  sorted by canonical model ID. Schema validation recomputes and verifies that digest.
- The core uses Node's built-in cryptographic hash only for this pure deterministic integrity check; it still has
  no filesystem, network, provider, GitHub, or AST dependency.

## Consequences

Recommendation evidence cannot substitute a different reviewed fixture for the manifest's suite. A retained
snapshot ID and digest cannot make altered model metadata, pricing, capability, retirement, or context values
appear trustworthy. Provider adapters must calculate the digest after normalizing models and before persisting a
snapshot.
