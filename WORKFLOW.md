# Vetryn delivery workflow

This is the repository operating contract for humans, coding agents, and external Factory tooling. Product truth is
`docs/oss-v1.md`; delivery truth is the reviewed JSON in `product/plans/oss-v1/`.

## OSS V1 single-maintainer mode

ADR 0009 keeps the V1 build moving with one maintainer. Passing active command gates, `pnpm check`, and normal
repository CI are required. Named reviewer records and `CODEOWNERS` are useful feedback channels, not acceptance
or merge blockers. The maintainer explicitly owns task acceptance and PR merge decisions.

This is not a reduction in product safety: strict schemas, fail-closed recommendation behavior, redaction,
deterministic tests, CodeQL, dependency review, and explicit provider access remain required. Field work still
requires its declared field gate. No work may push directly to `main` or use ambient credentials or live-provider
access.

## Select and compile work

1. Run `pnpm plan:check` and `pnpm --silent task:next`.
2. Select one legal task and run `pnpm --silent task:compile -- TASK-ID`.
3. Treat the packet's paths, capabilities, invariants, gates, and stop conditions as hard boundaries.
4. Use `$vetryn-implement-task` for implementation. Use `$vetryn-verify-task` for an additional independent check
   when available, and `$vetryn-promote-task` for maintainer-controlled state promotion.

Factory's `task-executor`, `validation-gate`, and `commit-push` skills provide generic execution, validation, and
GitHub delivery behavior. Factory is an external development tool, not a product dependency or git submodule.

## Evidence and promotion

During implementation, add deterministic success, failure, ambiguity, and stale-input tests that match the task.
Run focused checks, then every active command gate in the packet. Do not claim planned gates as passing.

Evidence is compact, redacted, and bound to the exact candidate and command gate it proves. Recorded plan and
lockfile digests preserve the inputs observed at execution time; they are historical provenance, so a later
unrelated plan edit does not invalidate accepted evidence. Re-run active checks when the candidate changes.

With explicit maintainer approval, promotion changes only that task's state, ledger status/evidence, new compact
evidence, and generated progress. First commit the candidate and its evidence, then run `pnpm plan:write` and
commit the generated progress. Never edit `progress.json` directly.

## Pull requests and shipping

Use one task per branch and pull request. Before shipping, run `pnpm check` from a clean candidate commit. The PR
describes the bounded change, validation, risks, and any provider or submodule notes. Use Factory `commit-push` in
`land` mode to push, monitor required CI, address concrete actionable findings, merge with maintainer authority,
and monitor `main` afterward.

Review feedback remains valuable. Address P0/P1 and concrete correctness, security, privacy, data-loss, or
contract issues. A maintainer may use the Factory standalone-P2 disposition only when its documented conditions
are met. Do not delay a small V1 task for speculative, duplicative, or non-actionable review churn.

## Provider and field work

Network, credentials, provider calls, and GitHub writes require the compiled task capability and explicit
maintainer authorization. Provider credentials are scoped and never committed. Live-model work is an explicitly
budgeted field operation, not pull-request CI; it begins only at the field task and cannot be inferred from an
offline V1 task.

## Merge and post-merge

Merge only through the pull request after required latest-head CI is green. Synchronize `main` fast-forward after
merge and monitor default-branch CI. If a repository-owned failure appears, open a scoped hotfix PR; report
external or permission failures without weakening these constraints.
