# Vetryn delivery workflow

This is the repository operating contract for humans, coding agents, and external Factory tooling. Product truth is
`docs/oss-v1.md`; delivery truth is the reviewed JSON in `product/plans/oss-v1/`.

## OSS V1 maintainer-led mode

ADR 0009 keeps the V1 build moving with the small active roster in `MAINTAINERS.md`. Passing active command gates,
`pnpm check`, and normal repository CI are required. Named reviewer records and `CODEOWNERS` are useful feedback
channels, not acceptance or merge blockers. Any listed maintainer with current GitHub write authority may grant
explicit per-run permissions and owns task acceptance and PR merge decisions for that run. The roster, a skill,
or a prior conversation never supplies standing authority.

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

For medium- and high-risk tasks, the packet declares exact report and integrity-marker targets under
`.factory/artifacts/task-runs/<task-id>/`. Author the report body as the ignored
`.factory/tmp/task-runs/<task-id>/semantic-risk-report.draft.json`, then run
`pnpm --silent semantic-risk:design -- TASK-ID` from a clean candidate snapshot, preferably before product edits.
The repo-native command validates the pinned-schema report and writes a content- and source-bound integrity marker;
it does not authenticate chronology, independent review, approval, or execution authority. Bound-candidate packet
validation rechecks schema, digests, task/risk/profile identity, source ancestry, and convergence. The V1 adapter rejects
`authorized` external actions; offline work records them only as `blocked` or `not_applicable`. The compiler adds
only those two operational paths without changing canonical product scope.

Planning and product-contract changes on a feature branch are proposals, not implementation authority. Merge them
through review to `main`, resync the downstream branch, and compile the task from canonical `main` before relying
on new scope, gates, or acceptance criteria.

Factory's `task-executor`, `validation-gate`, `code-review`, and `commit-push` skills provide generic execution,
validation, structured local review, and GitHub delivery behavior. Factory is an external development tool, not a
product dependency, git submodule, or sibling-checkout requirement. Invoke an installed Factory skill by name and
specialize it from the compiled packet and repository policy. The local developer runtime and installed skills are
trusted development inputs; Vetryn does not attempt to sandbox the host or authenticate installed worker bytes.

`$vetryn-continue-next` is a convenience wrapper over this workflow. Its read-only preflight discovers exactly one
active or next-legal task, compiles the packet, and reports the required routing. The result grants no branch,
mutation, promotion, GitHub, merge, credential, or provider authority; those remain explicit current-run grants.

## Evidence and promotion

During implementation, add deterministic success, failure, ambiguity, and stale-input tests that match the task.
Run focused checks, then every active command gate in the packet. Do not claim planned gates as passing.

Evidence is compact, redacted, and bound to the exact candidate and command gate it proves. Recorded plan,
lockfile, and portable Factory-profile digests preserve the policy inputs observed at execution time. A changed
Factory profile invalidates the active packet and requires recompilation; unrelated plan edits may preserve a
frozen task's evidence under the packet validator's existing rules. For high-risk work, freeze the candidate after
command validation and run Factory `code-review` before promotion or the first push. The review report must bind that exact
candidate and validation report. Re-run both validation and local review after any product- or contract-bearing
candidate change.

With explicit approval from an active maintainer, promotion changes only that task's state, ledger status/evidence, new compact
evidence, and generated progress. First commit the reviewed candidate and its evidence, then run `pnpm plan:write`
and commit the generated progress. Inspect the full promotion tail before shipping; if it contains product or
contract-bearing bytes, invalidate the review and return to implementation. Never edit `progress.json` directly.

## Pull requests and shipping

Use one task per branch and pull request. Before shipping, run `pnpm check` from a clean candidate commit. The PR
describes the bounded change, validation, risks, and any provider or submodule notes. Use Factory `commit-push` in
`land` mode to push, monitor required CI, address concrete actionable findings, merge with maintainer authority,
and monitor `main` afterward.

Review feedback remains valuable. Address P0/P1 and concrete correctness, security, privacy, data-loss, or
contract issues. Remote Codex is a separate latest-head residual gate and does not satisfy the local structured
review. A maintainer may use the Factory standalone-P2 disposition only when its documented conditions are met.
Do not delay a small V1 task for speculative, duplicative, or non-actionable review churn.

## Provider and field work

Network, credentials, provider calls, and GitHub writes require the compiled task capability and explicit
maintainer authorization. Provider credentials are scoped and never committed. Live-model work is an explicitly
budgeted field operation, not pull-request CI; it begins only at the field task and cannot be inferred from an
offline V1 task.

## Merge and post-merge

Merge only through the pull request after required latest-head CI is green. Synchronize `main` fast-forward after
merge and monitor default-branch CI. If a repository-owned failure appears, open a scoped hotfix PR; report
external or permission failures without weakening these constraints.
