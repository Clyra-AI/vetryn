# ADR 0009: Use proportional single-maintainer delivery for OSS V1

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Vetryn is a small OSS project with one active maintainer. The bootstrap review protocol required remote GitHub
identity, protected-main `CODEOWNERS`, exact issue comments, and current plan and lockfile digests before a task
could be accepted. That created a circular dependency: a task needed a pushed pull request to validate, while the
local plan could not validate before the pull request existed. It also let an unrelated planning change invalidate
otherwise sound, candidate-bound historical command evidence.

The project still needs strong product safeguards: deterministic tests, strict artifact schemas, fail-closed
recommendations, redaction, provider opt-in, and normal CI security checks. Those safeguards are independent of
multi-party review mechanics.

## Decision

- Until the maintainer explicitly replaces this ADR, OSS V1 uses a single-maintainer delivery mode.
- A task is eligible for acceptance when its exact candidate has passing, compact, redacted evidence for every
  active command criterion and gate. Field gates remain mandatory when a task declares them.
- Named review roles, `CODEOWNERS`, and reviewer-evidence records are advisory. They may document useful feedback
  but do not block task promotion or shipping.
- Evidence remains immutable historical provenance. It must bind to the exact candidate and declared gate; its plan
  and lockfile digests record the observed inputs but are not revalidated against later unrelated plan changes.
- The maintainer retains acceptance and merge authority. Work still lands through a branch and pull request after
  local `pnpm check`; repository CI, CodeQL, dependency review, and actionable review feedback remain part of the
  normal delivery loop.
- Provider access remains explicit and task-scoped. No policy change permits ambient secrets, automatic live-model
  calls, direct `main` pushes, or automated product merges.

## Consequences

- The command path can progress without a second maintainer or a remote-review bootstrap ritual.
- The plan validator remains strict about schemas, exact candidate binding, gate-command binding, redaction,
  dependency order, and generated progress.
- ADR 0006's bootstrap owner-comment protocol is superseded for OSS V1 delivery. It remains historical context and
  can be reintroduced only with a new decision if multi-maintainer review is restored.
- Before a larger team, paid product, or high-risk live operation, revisit this policy and decide which independent
  review controls should return.
