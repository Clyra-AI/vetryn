# ADR 0009: Use proportional maintainer-led delivery for OSS V1

- **Status:** Accepted
- **Date:** 2026-08-10
- **Amended:** 2026-08-14

## Context

Vetryn began as a small OSS project with one active maintainer. The bootstrap review protocol required remote GitHub
identity, protected-main `CODEOWNERS`, exact issue comments, and current plan and lockfile digests before a task
could be accepted. That created a circular dependency: a task needed a pushed pull request to validate, while the
local plan could not validate before the pull request existed. It also let an unrelated planning change invalidate
otherwise sound, candidate-bound historical command evidence.

The project still needs strong product safeguards: deterministic tests, strict artifact schemas, fail-closed
recommendations, redaction, provider opt-in, and normal CI security checks. Those safeguards are independent of
multi-party review mechanics.

The active roster now contains two maintainers. Adding a second maintainer should make repository work and explicit
authorization portable across the team without reintroducing a mandatory two-person approval ritual for every V1
change.

## Decision

- Until a maintainer replaces this ADR, OSS V1 uses maintainer-led delivery. `MAINTAINERS.md` is the reviewed active
  roster, and `.github/CODEOWNERS` mirrors it for advisory ownership routing.
- A task is eligible for acceptance when its exact candidate has passing, compact, redacted evidence for every
  active command criterion and gate. Field gates remain mandatory when a task declares them.
- Named review roles, `CODEOWNERS`, and reviewer-evidence records are advisory. They may document useful feedback
  but do not block task promotion or shipping.
- Evidence remains immutable historical provenance. It must bind to the exact candidate and declared gate; its plan
  and lockfile digests record the observed inputs but are not revalidated against later unrelated plan changes.
- Any listed maintainer with current GitHub write, maintain, or admin access may issue an explicit task- and
  run-scoped grant, accept an exact candidate, and merge it. Either maintainer may act independently; adding a
  second name does not make a second approval mandatory. Work still lands through a branch and pull request after
  local `pnpm check`; repository CI, CodeQL, dependency review, and actionable review feedback remain part of the
  normal delivery loop.
- The roster, `CODEOWNERS`, a skill, a task packet, and prior chat are not standing authorization. The current run
  must carry explicit maintainer authority for branch, promotion, GitHub, provider, credential, or merge effects
  that need it.
- Provider access remains explicit and task-scoped. No policy change permits ambient secrets, automatic live-model
  calls, direct `main` pushes, or automated product merges.
- Validation and required reviews bind the ProductCandidate, defined as the final product, contract, test, fixture,
  or task-scoped documentation commit. A deterministic promotion-only DeliveryHead may inherit that evidence when
  its tail contains only canonical state, ledger, compact lifecycle evidence, generated progress, and other
  packet-declared promotion artifacts.
- Automated findings are batched once per ProductCandidate. P0/P1 and non-waivable findings block. After one
  completed repair generation, a maintainer may explicitly record one newly surfaced standalone P2 as delivery
  debt and merge without another product-review generation; this never applies to privacy, fail-closed,
  provider-safety, evidence-integrity, or another non-waivable requirement.

## Consequences

- The command path can progress without requiring a second maintainer's approval or a remote-review bootstrap
  ritual, while either active maintainer can operate it.
- The plan validator remains strict about schemas, exact candidate binding, gate-command binding, redaction,
  dependency order, and generated progress.
- ADR 0006's bootstrap owner-comment protocol is superseded for OSS V1 delivery. It remains historical context and
  can be reintroduced only with a new decision if multi-maintainer review is restored.
- Before a larger team, paid product, or high-risk live operation, revisit this policy and decide which mandatory
  multi-party review controls should return.
