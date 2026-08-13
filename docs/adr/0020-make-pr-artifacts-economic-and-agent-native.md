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
  RFC 3339 UTC observation time or window. The repository-owned reviewed recommendation policy must declare
  `workloadVolumeMaxAgeDays` as an integer from 1 through 31 and must be bound into the report by digest. At the report's
  trusted `generatedAt`, the effective observation time is the window end when a window exists and `observedAt`
  otherwise. It is current only when it is within the five-minute future-skew allowance and its age is no greater
  than the declared bound; absent policy, malformed or reversed windows, out-of-skew future times, and older
  observations forbid monthly and annual claims. A producer-supplied freshness claim is not trusted.
- The same digest-bound policy declares `catalogMaxAgeHours` from 1 through 168, `evaluationMaxAgeHours` from 1
  through 24, and `reportMaxAgeHours` from 1 through 24. The report generator derives `generatedAt` from its injected
  trusted invocation clock and never accepts it from report input, a CLI flag, or an Action input. Production uses
  the Vetryn runtime clock; deterministic tests and offline replay may substitute a reviewed fixed clock at the
  orchestration boundary. Recommendation and patch authorization use their own fresh trusted clock, allow at most
  five minutes of future skew, and re-evaluate report, catalog/pricing, evaluation, and workload ages. The source
  fingerprint, fixture digest or revision, evaluator version and build, catalog identity, and pricing row must
  exactly match the currently authorized inputs. Missing, stale, future, or identity-mismatched evidence abstains
  and cannot authorize a patch.
- When that profile is valid and policy-current, reports derive estimated current and proposed monthly cost, monthly
  and annual savings, and savings percentage from it, the reviewed representative token profile, and bound catalog
  pricing. All projections are labeled estimates. Observed evaluation spend and optional runtime corroboration stay
  separate. For projected workload economics only, this supersedes ADR 0019's earlier shorthand that recommendation
  savings use observed evaluation cost: observed evaluation spend describes the bounded eval run, while realized
  field value requires later billing or runtime corroboration.
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
  reviewers to follow-on call-site or repository assessments under a predeclared 30-day matching and deduplication
  policy. Evidence binds the qualified PR, an authenticated non-bot reviewer event that explicitly identifies the
  follow-on target, and the assessment identity. The event's normalized repository or call-site target must exactly
  equal the normalized target bound into the assessment. The assessment must begin at or after the event and within
  30 days; duplicates select the earliest event time and then canonical event ID. Target-mismatched, unmatched,
  self-authored, bot, duplicate, or out-of-window records are excluded.

## Consequences

V1-06 remains focused on trustworthy bounded evaluation and is not delayed by the optional volume profile. V1-07
owns the versioned economic and freshness report contract. V1-09 owns orchestration, `llms.txt`, agent onboarding,
stable machine semantics, and contextual next actions. V1-10 measures whether the artifact drives attributable
follow-on assessment.

The report becomes more economically useful while remaining honest when traffic evidence is unavailable. Coding
agents receive one stable interface rather than bespoke integrations. Reviewers can discover the next eligible
assessment without a dashboard, hosted control plane, complete-runtime-inventory claim, automatic merge, or hidden
growth tracking.
