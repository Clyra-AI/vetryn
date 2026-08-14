---
name: vetryn-continue-next
description: Discover and continue Vetryn's sole active or next-legal repository task through its compiled implementation, validation, review, promotion, and protected-delivery workflow. Use when a maintainer asks Codex to continue the next Vetryn task without supplying a task ID or machine-specific paths.
---

# Continue the next Vetryn task

From anywhere inside the repository, run
`node "$(git rev-parse --show-toplevel)/.agents/skills/vetryn-continue-next/scripts/preflight.mjs"`.
Stop unless it returns `ready_for_authority`.

The preflight is read-only. It discovers the repository root, requires a clean checkout, runs the
existing plan check, selects exactly one active task or otherwise exactly one next-legal task, compiles
that task's packet, reports its routing requirements, and verifies that HEAD and worktree status did not
change. It does not authenticate the host or installed tools and grants no authority.

After a passing preflight:

1. Require an explicit grant for this run from a current maintainer. Intersect that grant with the
   compiled packet and repository policy; denial and non-waivable rules win.
2. Route from `selection.state` before invoking a worker. For `planned`, `ready`, `in_progress`, or
   `changes_requested`, continue through the packet's implementation skill and Factory `task-executor`.
   For `verification_pending`, preserve the frozen candidate and resume at validation. For
   `review_pending`, preserve the frozen candidate and resume at required reviews only after confirming
   its existing validation evidence still binds that candidate. Stop on any other state.
3. When routed through implementation, stay within `allowed_paths`; stop on every packet blocker, failed
   command, or forbidden capability.
4. Unless resuming at review, run every packet validation command and Factory `validation-gate` on the frozen
   ProductCandidate.
5. Run each packet-required local or domain review, including Factory `code-review` when declared.
   Collect the current review generation before editing and address its concrete findings in one bounded repair;
   ProductCandidate changes invalidate validation and review exactly once for the repaired candidate.
6. Invoke the packet's promotion skill only after required gates pass and the current-run grant includes
   maintainer promotion. That skill creates one canonical promotion-only DeliveryHead and owns the single handoff to Factory `commit-push`
   for protected landing; do not invoke the land lifecycle a second time. Delivery still requires the grant to
   include branch, PR, merge, and GitHub writes.
7. Require DeliveryHead CI and treat P0/P1 or non-waivable findings as blockers. After one completed repair
   generation, a new standalone P2 follows the explicit ADR-0009 maintainer delivery-debt disposition instead of
   automatically starting another implementation cycle.
8. After merge, resync the default branch, monitor default-branch CI, and rerun
   `pnpm --silent task:next`. The task is not complete until the protected merge is verified and the newly legal
   next task is reported.

Never infer positive authority from this skill, the packet, `MAINTAINERS.md`, `CODEOWNERS`, prior chat, or
ambient credentials. Never push directly to `main`, use live-provider access or credentials without a
separate eligible grant, or waive privacy, fail-closed, provider-safety, evidence-integrity, or another
non-waivable requirement.

Stop on zero or ambiguous task selection, dirty or changing repository state, command failure, scope
drift, missing current-run authority, or a genuine external blocker. Do not reimplement plan, evidence,
Factory worker, or shipping logic inside this skill.
