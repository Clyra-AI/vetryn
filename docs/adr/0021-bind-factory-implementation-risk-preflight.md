# ADR 0021: Bind Factory implementation-risk preflight

- Status: Accepted
- Date: 2026-08-13

## Context

Vetryn's compiled task packets already classify task risk and require validation, high-risk local review, and
domain trust review. The portable Factory profile did not yet carry Factory's executable implementation-risk
policy, and medium- or high-risk packets did not declare a writable semantic-risk report target. An executor could
therefore begin product edits without first making artifact lifecycles, authority boundaries, adversarial
guarantees, external effects, and persistence threats explicit.

## Decision

The portable `.factory/profile.yaml` vendors the canonical Vetryn `implementation_risk` overlay and pins the exact
Factory source commit, canonical profile digest, semantic-risk schema path, and schema digest.

Task-packet schema version 1.1 requires every medium- and high-risk packet to declare exact
`semantic_risk_report_ref` and `semantic_risk_baseline_marker_ref` targets under
`.factory/artifacts/task-runs/<task-id>/`. The compiler appends only those targets to runner `allowed_paths` and
leaves the embedded canonical product scope unchanged. The portable Factory profile and a byte-identical vendored
semantic-risk schema join the product contract, plan, and lockfile in the packet digest map, so policy or schema
drift requires recompilation.
This is an additive extension to Vetryn's lean Factory adapter contract; it does not claim that Vetryn packets
implement Factory's larger universal task-packet v1.2 runtime schema.

`pnpm --silent semantic-risk:preflight -- TASK-ID` is the repo-native producer. It consumes an ignored draft,
requires a clean Git baseline, derives task/risk/profile/source metadata, validates the pinned schema, and writes
the report plus a content- and source-bound runner marker atomically per file. An incomplete pair is non-actionable.
Bound-candidate packet validation reads and verifies both artifacts; a target string alone is never evidence. This local adapter is intentionally narrower
than Factory's universal runtime contract and avoids a hosted or sibling-repository dependency.

Validation reads the report and marker from the exact candidate commit. The repo-native V1 adapter rejects every
`authorized` external action because a repository-authored grant cannot authenticate human or provider authority.
Offline tasks must classify each action as `blocked` or `not_applicable`; live authority is deferred to a separately
reviewed field-operation contract. Working-tree-only evidence and generic repository files cannot authorize the
candidate.

The semantic-risk report is pre-implementation evidence. It does not replace deterministic tests, validation,
candidate-bound code review, Vetryn trust review, CI, or maintainer promotion. Lifecycle artifacts remain outside
executor scope.

## Consequences

- V1-06 and later medium- or high-risk work must make lifecycle and authority assumptions reviewable before code.
- Operational evidence gains two exact committed paths without broadening product implementation scope.
- Updating the portable Factory profile invalidates active packets and requires recompilation.
- Factory remains an external development tool rather than a Vetryn product dependency.
