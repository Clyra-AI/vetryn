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

The **ProductCandidate** is the final commit containing product, contract, test, fixture, or task-scoped
documentation changes. Evidence is compact, redacted, and bound to that exact candidate and command gate it proves. Recorded plan,
lockfile, and portable Factory-profile digests preserve the policy inputs observed at execution time. A changed
Factory profile invalidates the active packet and requires recompilation; unrelated plan edits may preserve a
frozen task's evidence under the packet validator's existing rules. For high-risk work, freeze the candidate after
command validation and run Factory `code-review` before promotion or the first push. The review report must bind that exact
candidate and validation report. Re-run both validation and local review after any product- or contract-bearing
candidate change.

With explicit approval from an active maintainer, run `pnpm plan:write` and create one promotion-only
**DeliveryHead** containing only that task's canonical state, ledger status/evidence, compact lifecycle evidence,
generated progress, and other packet-declared promotion artifacts. Never edit `progress.json` directly. Run the
small plan/tail structural checks, not the full product or domain-review suite again. If the tail contains product,
contract, test, fixture, or task-scoped documentation bytes, invalidate inheritance and return to implementation.

## Pull requests and shipping

Use one task per branch and pull request. Run `pnpm check` on the clean ProductCandidate. The PR
describes the bounded change, validation, risks, and any provider or submodule notes. Use Factory `commit-push` in
`land` mode to push, monitor required CI, address concrete actionable findings, merge with maintainer authority,
and monitor `main` afterward.

Review feedback remains valuable. Collect findings visible for a ProductCandidate into one batch, make at most one
bounded repair pass, and rerun exact-candidate gates and required reviews once. P0/P1 and concrete correctness,
security, privacy, data-loss, contract, or other non-waivable issues block. Remote Codex does not replace local
structured review. After the completed repair generation, one new standalone P2 may use the Factory disposition
only with explicit ADR-0009 maintainer classification; it does not automatically start another product cycle.
Promotion-only bytes do not require another full local review generation. Do not delay a small V1 task for
speculative, duplicative, or non-actionable churn.

## Provider and field work

Network, credentials, provider calls, and GitHub writes require the compiled task capability and explicit
maintainer authorization. Provider credentials are scoped and never committed. Live-model work is an explicitly
budgeted field operation, not pull-request CI; it begins only at the field task and cannot be inferred from an
offline V1 task.

## Merge and post-merge

Merge only through the pull request after required latest-head CI is green. Synchronize `main` fast-forward after
merge and monitor default-branch CI. If a repository-owned failure appears, open a scoped hotfix PR; report
external or permission failures without weakening these constraints.
