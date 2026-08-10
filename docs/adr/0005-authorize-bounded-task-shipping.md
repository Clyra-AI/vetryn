# ADR 0005: Authorize bounded task shipping

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Vetryn task packets default network, credentials, provider access, and GitHub writes to disabled. V1-00 must be
published as a pull request before GitHub can provide the authenticated, role-bound review evidence required by
ADRs 0003 and 0004. Shipping also requires reading remote branch state and using the operator's stored GitHub
authentication. Leaving all three capabilities disabled therefore makes the required review and merge lifecycle
unreachable.

The current task schema represents these capabilities as booleans. It cannot express a narrower staged,
GitHub-only publication and lifecycle grant, so enabling the flags without additional constraints would
authorize more than the shipping operation requires.

## Decision

- Enable network, stored credentials, and GitHub writes for V1-00 only. Keep provider access disabled.
- Before initial publication, require an independent verifier to pass an exact-candidate local preflight and a
  maintainer to explicitly authorize shipping. This local preflight authorizes only the first branch push and
  pull-request creation; it is not a passing canonical review gate.
- Limit network and credential use to GitHub operations required by the Factory `commit-push` lifecycle:
  synchronizing protected `main`, pushing the V1-00 branch, creating or updating its pull request, reading and
  resolving its review and CI state, merging only after every applicable branch merge gate passes, and
  monitoring post-merge `main`.
- Once the pull request exists, require `QG-INDEPENDENT-VERIFY`, `QG-TRUST-REVIEW`, and any other declared review
  gate to use the GitHub-authenticated evidence defined by ADRs 0003 and 0004 before task acceptance or
  promotion. The local preflight cannot satisfy or be recorded for those gates.
- Continue to require latest-head CI and passive Codex review settlement for branch merging. ADR 0006 governs
  temporary human-approval and CODEOWNER behavior; task acceptance and promotion always retain authenticated
  role separation and the provenance rules in ADRs 0003 and 0004. The capability does not grant acceptance,
  review, promotion, or merge readiness by itself.
- Treat provider calls, package-registry access, unrelated network requests, other repositories, other pull
  requests, and writes outside the staged authorization above as forbidden. Encountering one is a task stop
  condition.
- Do not inherit this authorization into another task. Any later shipping or live operation must declare its own
  capability, scope, human authorization, and evidence requirements.

## Consequences

- V1-00 can reach the GitHub review evidence and protected-branch lifecycle that its acceptance policy already
  requires.
- Initial publication is possible without claiming that a not-yet-created pull request already supplied review
  evidence.
- The compiled packet exposes broader boolean capabilities than the operation consumes. The task invariant,
  stop condition, Factory profile, staged exact-candidate verification, and GitHub audit trail provide the narrower
  enforcement boundary.
- The operator's stored GitHub credential is used only through the approved lifecycle and is never committed or
  copied into evidence.
- A candidate change invalidates prior verification and restarts latest-head CI and review settlement.
- If multiple tasks need the same exception, the task capability schema should gain a first-class scoped
  lifecycle grant instead of copying this decision.
