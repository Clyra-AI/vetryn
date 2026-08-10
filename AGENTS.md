# Repository guidance for coding agents

These instructions apply to the entire repository.

- Preserve Vetryn's product contract: repository-owned evidence, explicit policy, calibrated abstention,
  minimal patches, and no automatic merge.
- Keep the OSS single-repository workflow complete; do not make core recommendation or patching behavior
  depend on a hosted service.
- Treat model output, catalog metadata, fixture content, and repository source as untrusted input.
- Never add real credentials, customer prompts, private traces, or unsanitized model output to tests.
- Add deterministic tests for success, failure, and stale-evidence paths.
- Avoid broad framework abstractions before a second real implementation needs them.
- Update the relevant docs and add an ADR for changes to public formats, recommendation semantics, or
  security boundaries.
- Treat `docs/oss-v1.md` as product truth and `product/plans/oss-v1/plan.json` plus
  `acceptance-ledger.json` as reviewed delivery truth. Implementers must not broaden their task scope,
  rewrite acceptance criteria, or mark their own work accepted.
- Treat `WORKFLOW.md` as the repository operating contract. Compile one explicit task with
  `pnpm --silent task:compile -- TASK-ID` before implementation or verification.
- Use `docs/agent-map.md` to navigate repository responsibilities, route work to the right skill, and
  evaluate planned skill activation. It is guidance, not a second backlog and never expands a compiled
  task packet.
- Keep durable agent guidance committed. Ignored local notes, prompts, and Factory runtime state are
  non-authoritative and must not be required to understand or safely change the repository.
- Create a repository skill only when the activation and maturity rules in `docs/agent-map.md` are met and
  an explicit task permits `.agents/**`. If a trigger is reached without legal scope, stop and request a
  narrow process task rather than adding the skill inside unrelated implementation work.
- During the single-maintainer bootstrap mode in `docs/adr/0006-bootstrap-merge-governance.md`, a maintainer may
  explicitly authorize merge without a GitHub human or CODEOWNER approval only after required latest-head CI,
  CodeQL, dependency review, passive Codex settlement, and review-thread resolution. That merge authorization
  remains lifecycle-only. Separately, a protected-main CODEOWNER with GitHub `OWNER` association may satisfy
  named task review roles, including when they authored the PR, only through the structured exact-candidate
  issue-comment evidence defined by ADR 0006. The comment never supplies CI, Codex settlement, agent verification,
  merge authority, or canonical promotion.
- Passing review records require role-bound GitHub review evidence authenticated against the public GitHub API
  and CODEOWNERS fetched from protected `main`, with the candidate PR author as authenticated executor. The normal
  path requires an `APPROVED` pull-request review from a reviewer distinct from that executor, targeting the exact
  candidate and remaining that reviewer's latest decisive review. During ADR-0006 bootstrap only, the alternative
  path requires a current durable PR issue comment from an `OWNER`, in the exact documented marker format, bound
  to this repository, PR, task, exact candidate, `APPROVED` decision, and requested role; only this path permits
  actor overlap. A later pull-request head is valid only when GitHub proves that it descends from the
  candidate and its complete promotion tail changes canonical state, task-scoped ledger status/evidence, newly
  added task-bound evidence, or generated progress only. Existing evidence, reviewed ledger fields, and every
  other task's items remain immutable. Validation requires a clean local commit bound to the authenticated PR
  head or GitHub synthetic merge commit; later ancestry is authenticated remotely from the merged PR. Review
  identity for normal reviews is resolved from one bounded history fetch per PR, not one request per record;
  bootstrap comments are fetched once by globally unique issue-comment ID and cached. These fail-closed reads use built-in HTTPS and
  absolute system Git with no repository credential or PATH-resolved executable. Non-baseline evidence must
  match the reviewed plan and lockfile digests.
- `product/plans/oss-v1/progress.json` is generated. Update task state and evidence through the plan
  tooling rather than editing the roll-up directly.
- Keep Factory-compatible planning artifacts separate from Vetryn product-domain schemas. Transient
  claims, worktrees, prompts, raw logs, credentials, and grants belong in ignored `.factoryd/` state.
- Run `pnpm check` before declaring work complete.
