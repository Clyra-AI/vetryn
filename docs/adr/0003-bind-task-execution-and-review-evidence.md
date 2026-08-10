# ADR 0003: Bind task execution and review evidence

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

Vetryn's reviewed JSON plan is intentionally lean, while Factory's generic workers require one bounded task
packet. The original validator bound successful evidence to a task and candidate commit but did not verify the
reviewed plan and lockfile digests. It also allowed command evidence to be reused as a maintainer or trust
approval, and repository-authored reviewer identity fields could be fabricated, so the executor/verifier
boundary was descriptive rather than enforced.

## Decision

- Compile one deterministic task packet from the canonical plan, acceptance ledger, task state, and lockfile.
- Include the product contract in the packet's required digest set so documentation drift invalidates handoff.
- Reject packet compilation when the plan is stale or the task is not legal to execute.
- Record the candidate executor in task state.
- Require every non-baseline passing evidence record to match the current reviewed plan and lockfile digests.
- Bind command evidence to one canonical gate ID and command, and compare both with the reviewed gate catalog.
- Require approval evidence to be `review` evidence with a role, the candidate executor as its subject, a
  distinct reviewing actor, and a repository GitHub pull-request review attestation. Validation re-fetches that
  review from GitHub's public API and compares the approved state, actor, eligible author association, review ID,
  pull request, URL, and observed candidate commit. It separately fetches CODEOWNERS from protected `main` and
  requires the actor to own the protected surface mapped to the expected role. Branch-authored evidence and role
  text are not authority.
- Preserve the already accepted imported baseline as explicit `baseline-verification` evidence. That narrow
  compatibility case cannot be used by later V1 tasks.

## Consequences

- Executors cannot unlock dependent work by attaching their command output to review records.
- One successful command cannot be replayed across unrelated quality gates.
- Fabricated or unavailable GitHub approval claims fail closed, including during maintainer promotion.
- Product-contract drift changes the packet even when the plan, state, ledger, and lockfile are unchanged.
- Plan or dependency drift invalidates old passing evidence instead of silently carrying it forward.
- External agents can consume a stable task packet without making Factory a runtime or git-submodule
  dependency.
- Promotion requires slightly richer evidence and candidate metadata, but the validator can now enforce the
  role separation promised by the workflow.
