# ADR 0003: Bind task execution and review evidence

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

Vetryn's reviewed JSON plan is intentionally lean, while Factory's generic workers require one bounded task
packet. The original validator bound successful evidence to a task and candidate commit but did not verify the
reviewed plan and lockfile digests. It also allowed command evidence to be reused as a maintainer or trust
approval, so the executor/verifier boundary was descriptive rather than enforced.

## Decision

- Compile one deterministic task packet from the canonical plan, acceptance ledger, task state, and lockfile.
- Reject packet compilation when the plan is stale or the task is not legal to execute.
- Record the candidate executor in task state.
- Require every non-baseline passing evidence record to match the current reviewed plan and lockfile digests.
- Require approval evidence to be `review` evidence with a role, the candidate executor as its subject, a
  distinct reviewing actor, and a repository GitHub pull-request review attestation. The attestation binds the
  approved state, eligible author association, GitHub review ID and URL, and observed candidate commit.
- Preserve the already accepted imported baseline as explicit `baseline-verification` evidence. That narrow
  compatibility case cannot be used by later V1 tasks.

## Consequences

- Executors cannot unlock dependent work by attaching their command output to review records.
- Plan or dependency drift invalidates old passing evidence instead of silently carrying it forward.
- External agents can consume a stable task packet without making Factory a runtime or git-submodule
  dependency.
- Promotion requires slightly richer evidence and candidate metadata, but the validator can now enforce the
  role separation promised by the workflow.
