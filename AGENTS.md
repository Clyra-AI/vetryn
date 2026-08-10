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
- Passing review records require role-bound GitHub review evidence, the exact candidate executor, and
  a reviewer distinct from that executor. Non-baseline evidence must match the reviewed plan and lockfile
  digests.
- `product/plans/oss-v1/progress.json` is generated. Update task state and evidence through the plan
  tooling rather than editing the roll-up directly.
- Keep Factory-compatible planning artifacts separate from Vetryn product-domain schemas. Transient
  claims, worktrees, prompts, raw logs, credentials, and grants belong in ignored `.factoryd/` state.
- Run `pnpm check` before declaring work complete.
