# ADR 0020: Make PR artifacts economic and agent-native

## Status

Accepted for OSS V1 planning. Implementation is assigned across V1-06 through V1-10: trusted execution-time
evidence in V1-06, economic and freshness policy in V1-07, patch-time reauthorization in V1-08, agent-native PR
delivery in V1-09, and field attribution in V1-10.

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

- A call site may carry a human-reviewed workload-volume profile with `monthlyRequestCount` as an integer from 1
  through 1,000,000,000,000, provenance, and an RFC 3339 UTC observation time or window. Zero, negative,
  fractional, non-finite, unsafe, or oversized counts are invalid optional evidence and fall back to normalized
  unit economics. The repository-owned reviewed recommendation policy must declare
  `workloadVolumeMaxAgeDays` as an integer from 1 through 31 and must be bound into the report by digest. At the report's
  trusted `generatedAt`, the effective observation time is the window end when a window exists and `observedAt`
  otherwise. It is current only when it is within the five-minute future-skew allowance and its age is no greater
  than the declared bound; absent policy, malformed or reversed windows, out-of-skew future times, and older
  observations forbid monthly and annual claims. A producer-supplied freshness claim is not trusted.
- The same digest-bound policy declares `catalogMaxAgeHours` from 1 through 168, `evaluationMaxAgeHours` from 1
  through 24, and `reportMaxAgeHours` from 1 through 24. A recommendation report binds the policy digest, representative-usage
  profile digest, and workload-volume profile digest or a canonical absent marker. It also binds the immutable
  successful catalog-refresh observation whose ID, time, snapshot ID, and content digest commit the catalog and
  pricing evidence. It must be the terminal result of the current invocation's ordered refresh attempts; equivalent
  authenticated persisted provenance must commit the ordered attempt lineage and prove the cited success remains the
  latest terminal attempt at authorization time. A later failure always abstains, and omission of an attempt fails
  closed. An actionable authorization requires live acquisition whose time the Vetryn runtime derives at the
  acquisition boundary, a canonical persisted repository receipt, or equivalent authenticated external provenance;
  a caller-timestamped captured response is
  replay-only and cannot authorize a patch or PR. Each cited candidate run similarly binds an immutable execution
  record whose start and completion times come from the canonical runner's trusted clock, a canonical persisted
  repository receipt written by that runner, or authenticated external provenance. Arbitrarily imported or
  caller-restamped runs are replay-only. The report generator derives `generatedAt` from
  its injected trusted invocation clock and never accepts it from report input, a CLI flag, or an Action input.
  Production uses the Vetryn runtime clock; deterministic tests and offline replay may substitute a reviewed fixed
  clock at the orchestration boundary. Recommendation, patch, and PR authorization use their own fresh trusted
  clock, allow at most five minutes of future skew, and re-evaluate report, catalog/pricing, and evaluation ages. The
  source fingerprint, immutable fixture digest, evaluator version and build, every cited run's authenticated
  execution record and completion time, successful refresh observation, catalog content and pricing, policy digest,
  representative-usage profile digest, and original workload-volume profile digest or absent marker must match the
  recommendation inputs. An abstention report binds every available or rejected identity and records each
  unavailable required binding with a finite reason; it never invents missing provenance. Missing, stale, future, or
  identity-mismatched required decision evidence, including the recommendation policy itself, abstains and cannot authorize a patch. An
  absent, invalid, or stale optional workload profile suppresses only monthly and annual projections and uses
  normalized unit economics; it does not by itself make an otherwise valid recommendation abstain. The immutable
  recommendation is never rewritten. When an originally valid profile expires before patch or PR authorization,
  Vetryn emits a separately authenticated presentation revision that binds the recommendation digest, original
  profile digest, fresh authorization time, canonical rejection reason, and normalized economics. That revision may
  remove projections only; it cannot change the model decision, confidence, gates, or evidence. A different valid
  profile requires a new recommendation.
- Same-invocation evidence is actionable. For cross-invocation reuse, Vetryn authenticates every repository-log
  extension with a key outside repository-controlled content and atomically advances an exact-head per-repository
  anchor in the same locked transaction. Every entry must verify and the repository head must equal that anchor;
  append, deletion, truncation, fork, or rollback fails closed. A machine without the authenticated key and anchor
  treats historical receipts as replay-only. A fresh run starts a new externally anchored trust epoch containing
  only newly produced same-invocation receipts; it never makes the preceding unanchored history actionable.
  The generator first canonicalizes a receipt-free report payload and computes its digest. It then stores a detached
  report-generation receipt as a separate log entry binding that payload digest, generator identity, original
  generated time, and all decision inputs. The payload never embeds the receipt or its ID, so authentication is not
  self-referential and restamping cannot refresh a report. Other provenance requires a policy-allowlisted verifier
  that binds an exact anti-rollback head.
- When that profile is valid and policy-current, reports derive estimated current and proposed monthly cost, monthly
  and annual savings, and savings percentage from it, the reviewed representative token profile, and bound catalog
  pricing. JSON stores savings percentage as integer basis points from 0 through 10,000, computed from the exact
  rational `(current - proposed) / current` and rounded half up to the nearest basis point; Markdown renders the same
  integer as a fixed two-decimal percentage. A zero current cost or proposed cost above current makes percentage
  unavailable with `zero-current-cost` or `not-a-saving`, respectively. All projections are labeled estimates. Observed evaluation spend and optional runtime corroboration stay
  separate. For projected workload economics only, this supersedes M0-09's earlier shorthand that recommendation
  savings use observed evaluation cost: observed evaluation spend describes the bounded eval run, while realized
  field value requires later billing or runtime corroboration.
- When workload-volume evidence is absent, invalid, or stale, reports show per-request or per-1,000-request economics
  and explain why monthly and annual claims are unavailable. Missing volume evidence does not become invented
  precision.
- Recommendation PRs and abstention reports show exact evaluation provenance, freshness inputs, every configured
  gate with its outcome and reason, and finite limitations or abstention reasons. Abstentions never produce a patch.
- `vetryn assess` is the documented orchestration command after repository-owned manifest and eval setup. The
  composite Action invokes the same path and adds draft-PR creation only in an explicit GitHub-enabled mode. The
  lower-level commands remain available for reproduction and diagnosis. Both paths validate the required
  recommendation policy and other deterministic prerequisites before any provider call; missing or malformed
  required policy abstains with zero provider calls.
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
  equal the normalized target bound into the assessment. The assessment start time comes from the assessment's
  trusted invocation clock or authenticated external provenance, never an imported producer timestamp, and must be
  at or after the event and within 30 days. Duplicates select the earliest event time and then canonical event ID.
  Backdated, target-mismatched, unmatched, self-authored, bot, duplicate, or out-of-window records are excluded.

## Consequences

V1-06 remains focused on trustworthy bounded evaluation and is not delayed by the optional volume profile. V1-07
owns the versioned economic and freshness report contract. V1-09 owns orchestration, `llms.txt`, agent onboarding,
stable machine semantics, and contextual next actions. V1-10 measures whether the artifact drives attributable
follow-on assessment.

The report becomes more economically useful while remaining honest when traffic evidence is unavailable. Coding
agents receive one stable interface rather than bespoke integrations. Reviewers can discover the next eligible
assessment without a dashboard, hosted control plane, complete-runtime-inventory claim, automatic merge, or hidden
growth tracking.
