# ADR 0003: Bind task execution and review evidence

- **Status:** Partially superseded by ADR 0009 (review-evidence and current-digest requirements)
- **Date:** 2026-08-09

## Context

Vetryn's reviewed JSON plan is intentionally lean, while Factory's generic workers require one bounded task
packet. The original validator bound successful evidence to a task and candidate commit but did not verify the
reviewed plan and lockfile digests. It also allowed command evidence to be reused as a maintainer or trust
approval, and repository-authored reviewer identity fields could be fabricated, so the executor/verifier
boundary was descriptive rather than enforced.

## Decision

- Compile one deterministic task packet from the canonical plan, acceptance ledger, task state, and lockfile.
- Expose an additive runner-ready surface for Factory's `task-executor`: explicit task/risk identity, path
  policy, staged validation commands, worker chain, lifecycle gates, worker-versus-lifecycle evidence ownership,
  retry and runtime pins, compatibility and policy references, documentation/release intent, and item-level
  acceptance-result requirements. Preserve the existing Vetryn-native packet objects for repository tooling.
- Include the product contract in the packet's required digest set so documentation drift invalidates handoff.
- Reject packet compilation when the plan is stale or the task is not legal to execute.
- Record the candidate executor in task state.
- Require every non-baseline passing evidence record to match the current reviewed plan and lockfile digests.
- Bind command evidence to one canonical gate ID and command, and compare both with the reviewed gate catalog.
- Require approval evidence to be `review` evidence with a role, the candidate executor as its subject, a
  distinct reviewing actor, and a repository GitHub pull-request review attestation. Validation re-fetches that
  review from GitHub's public API and compares the approved state, actor, eligible author association, review ID,
  pull request, current head, URL, and observed candidate commit. The cited approval must remain the reviewer's
  latest decisive review on that commit. Validation separately fetches CODEOWNERS from protected `main` and
  requires the actor to own the protected surface mapped to the expected role. Branch-authored evidence and role
  text are not authority. All reads use Node's built-in HTTPS fetch so package-script PATH cannot substitute a
  repository-controlled collector.
- Reject `pass` for any gate whose reviewed catalog availability is not `active`.
- Preserve the already accepted imported baseline as explicit `baseline-verification` evidence. That narrow
  compatibility case cannot be used by later V1 tasks.

## Consequences

- Executors cannot unlock dependent work by attaching their command output to review records.
- One successful command cannot be replayed across unrelated quality gates.
- Fabricated or unavailable GitHub approval claims fail closed, including during maintainer promotion.
- Superseded approvals and evidence for future planned gates cannot unlock acceptance.
- Repository binaries cannot impersonate the GitHub evidence collector through package-script PATH.
- Product-contract drift changes the packet even when the plan, state, ledger, and lockfile are unchanged.
- Plan or dependency drift invalidates old passing evidence instead of silently carrying it forward.
- External agents can consume a stable task packet without making Factory a runtime or git-submodule
  dependency.
- Executors can start from the compiled packet without inferring missing runtime, validation, lifecycle, or
  acceptance-result policy from private chat. Reporting `implemented` remains a handoff result, not acceptance.
- Promotion requires slightly richer evidence and candidate metadata, but the validator can now enforce the
  role separation promised by the workflow.
