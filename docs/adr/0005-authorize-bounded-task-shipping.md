# ADR 0005: Authorize bounded task shipping

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

Vetryn task packets default network, credentials, provider access, and GitHub writes to disabled. V1-00 must be
published as a pull request before GitHub can provide the authenticated, role-bound review evidence required by
ADRs 0003 and 0004. Shipping also requires reading remote branch state and using the operator's stored GitHub
authentication. Leaving all three capabilities disabled therefore makes the required review and merge lifecycle
unreachable.

The current task schema represents these capabilities as booleans. It cannot express a narrower GitHub-only,
post-verification lifecycle grant, so enabling the flags without additional constraints would authorize more
than the shipping operation requires.

## Decision

- Enable network, stored credentials, and GitHub writes for V1-00 only. Keep provider access disabled.
- Activate those capabilities only after an independent verifier passes the exact candidate commit and a
  maintainer explicitly authorizes shipping.
- Limit network and credential use to GitHub operations required by the Factory `commit-push` lifecycle:
  synchronizing protected `main`, pushing the V1-00 branch, creating or updating its pull request, reading and
  resolving its review and CI state, merging only after every gate passes, and monitoring post-merge `main`.
- Continue to require latest-head CI, passive Codex review settlement, authenticated role separation, protected
  `main` CODEOWNERS, and the promotion provenance rules in ADRs 0003 and 0004. The capability does not grant
  acceptance, review, promotion, or merge readiness by itself.
- Treat provider calls, package-registry access, unrelated network requests, other repositories, other pull
  requests, and pre-verification writes as forbidden. Encountering one is a task stop condition.
- Do not inherit this authorization into another task. Any later shipping or live operation must declare its own
  capability, scope, human authorization, and evidence requirements.

## Consequences

- V1-00 can reach the GitHub review evidence and protected-branch lifecycle that its acceptance policy already
  requires.
- The compiled packet exposes broader boolean capabilities than the operation consumes. The task invariant,
  stop condition, Factory profile, exact-candidate verification, and GitHub audit trail provide the narrower
  enforcement boundary.
- The operator's stored GitHub credential is used only through the approved lifecycle and is never committed or
  copied into evidence.
- A candidate change invalidates prior verification and restarts latest-head CI and review settlement.
- If multiple tasks need the same exception, the task capability schema should gain a first-class scoped
  lifecycle grant instead of copying this decision.
