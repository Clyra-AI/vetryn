---
name: vetryn-continue-next
description: Discover and continue Vetryn's sole active or next-legal repository task through its compiled implementation, validation, review, promotion, and protected-delivery workflow. Use when a maintainer asks Codex to continue the next Vetryn task without supplying a task ID or machine-specific paths.
---

# Continue the next Vetryn task

Run `node .agents/skills/vetryn-continue-next/scripts/preflight.mjs` from anywhere inside the
repository. Stop unless it returns `ready_for_authority`.

The preflight is read-only. It discovers the repository root, requires a clean checkout, runs the
existing plan check, selects exactly one active task or otherwise exactly one next-legal task, compiles
that task's packet, reports its routing requirements, and verifies that HEAD and worktree status did not
change. It does not authenticate the host or installed tools and grants no authority.

After a passing preflight:

1. Require an explicit grant for this run from a current maintainer. Intersect that grant with the
   compiled packet and repository policy; denial and non-waivable rules win.
2. Invoke the packet's implementation skill and Factory `task-executor` within `allowed_paths`; stop on
   every packet blocker, failed command, or forbidden capability.
3. Run every packet validation command and Factory `validation-gate` on the frozen candidate.
4. Run each packet-required local or domain review, including Factory `code-review` when declared.
   Candidate changes invalidate validation and review.
5. Invoke the packet's promotion skill only after required gates pass and the current-run grant includes
   maintainer promotion.
6. Invoke Factory `commit-push` in protected `land` mode only when the grant includes branch, PR, merge,
   and GitHub writes. Monitor latest-head CI, applicable review, merge, and post-merge main status.
7. Resync the default branch and rerun `pnpm --silent task:next` to report the newly legal task.

Never infer positive authority from this skill, the packet, `MAINTAINERS.md`, `CODEOWNERS`, prior chat, or
ambient credentials. Never push directly to `main`, use live-provider access or credentials without a
separate eligible grant, or waive privacy, fail-closed, provider-safety, evidence-integrity, or another
non-waivable requirement.

Stop on zero or ambiguous task selection, dirty or changing repository state, command failure, scope
drift, missing current-run authority, or a genuine external blocker. Do not reimplement plan, evidence,
Factory worker, or shipping logic inside this skill.
