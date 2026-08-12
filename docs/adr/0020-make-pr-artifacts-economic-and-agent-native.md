# ADR 0020: Make PR artifacts economic and agent-native

## Status

Accepted for OSS V1 planning. Implementation remains assigned to V1-07, V1-09, and V1-10.

## Context

The migration pull request is Vetryn's smallest valuable product artifact. Reviewers need to understand the exact
evaluation, evidence freshness, gate decisions, and likely economic effect without opening a separate dashboard.
The existing representative token profile supports model ranking and unit-cost comparisons, but it cannot support a
defensible monthly claim without workload volume and provenance.

The same artifact is also the natural activation surface for coding agents and additional internal adoption.
Agent-specific instructions can drift into different behavior, while generic growth prompts can overstate scanner
coverage or contaminate recommendation evidence. V1 therefore needs one machine contract and a strict separation
between decision evidence and presentation-layer next actions.

## Decision

- A call site may carry a human-reviewed workload-volume profile with monthly request count, provenance, and an
  observation time or window. Freshness is derived under explicit policy; a producer-supplied freshness claim is not
  trusted.
- When that profile is valid and policy-current, reports derive estimated current and proposed monthly cost, monthly
  and annual savings, and savings percentage from it, the reviewed representative token profile, and bound catalog
  pricing. All projections are labeled estimates. Observed evaluation spend and optional runtime corroboration stay
  separate.
- When workload-volume evidence is absent, invalid, or stale, reports show per-request or per-1,000-request economics
  and explain why monthly and annual claims are unavailable. Missing volume evidence does not become invented
  precision.
- Recommendation PRs and abstention reports show exact evaluation provenance, freshness inputs, every configured
  gate with its outcome and reason, and finite limitations or abstention reasons. Abstentions never produce a patch.
- `vetryn assess` is the documented orchestration command after repository-owned manifest and eval setup. The
  composite Action invokes the same path and adds draft-PR creation only in an explicit GitHub-enabled mode. The
  lower-level commands remain available for reproduction and diagnosis.
- Root `llms.txt`, Markdown-first onboarding, stable JSON output, and documented exit semantics form one
  provider-neutral contract for Codex, Claude, and other coding agents. Agent-specific pages may restate that
  contract but cannot define different behavior or authority.
- A report presentation envelope includes a next-assessment section derived only from the reconciled assessed-surface
  funnel. It renders an exact action when another eligible call site or repository target exists and explicitly
  reports none otherwise. It is not part of recommendation eligibility, confidence, gate outcomes, or patch
  authorization.
- OSS V1 adds no mandatory telemetry. Field validation may record sanitized, consented attribution from qualified PR
  reviewers to follow-on call-site or repository assessments with explicit denominators and exclusions.

## Consequences

V1-06 remains focused on trustworthy bounded evaluation and is not delayed by the optional volume profile. V1-07
owns the versioned economic and freshness report contract. V1-09 owns orchestration, `llms.txt`, agent onboarding,
stable machine semantics, and contextual next actions. V1-10 measures whether the artifact drives attributable
follow-on assessment.

The report becomes more economically useful while remaining honest when traffic evidence is unavailable. Coding
agents receive one stable interface rather than bespoke integrations. Reviewers can discover the next eligible
assessment without a dashboard, hosted control plane, complete-runtime-inventory claim, automatic merge, or hidden
growth tracking.
