# ADR 0011: Bind new packages to workspace and release metadata

- **Status:** Accepted
- **Date:** 2026-08-11

## Context

V1-05 introduces `@vetryn/openrouter` and connects it to the CLI. A package-only task scope is incomplete in a
pnpm monorepo: a clean frozen install also requires the workspace importer in `pnpm-lock.yaml`, source resolution
for tests, dead-code analysis coverage, and a Changeset for publishable APIs. Omitting those files can create a
local green result that fails in CI or silently disappears from a release.

## Decision

- A task that creates or changes publishable packages explicitly authorizes `.changeset/**` and the exact root
  workspace files it needs; the task may not infer broader root scope.
- V1-05 may change only `.changeset/**`, `knip.json`, `package.json`, `pnpm-lock.yaml`, and `vitest.config.ts`
  outside its existing package and example paths.
- Compiled packets with `.changeset/**` scope require a minor Changeset marker, package versioning intent, and
  package plus golden-example documentation sync.
- Every compiled lifecycle evidence name maps one-to-one to a deterministic repository-relative JSON ref beneath
  `product/plans/oss-v1/evidence/lifecycle/<task-id>/<candidate-commit>/`. An unbound pre-candidate packet cannot
  supply lifecycle evidence. This makes high-risk `review_report` preflight immutable and executable while keeping
  lifecycle-owned artifacts outside executor write scope.
- Consumers replace the declared `{packet_path}` token and run
  `node scripts/task.mjs validate <packet-path>` before using lifecycle evidence. That validator authenticates the
  current product-contract, plan, and lockfile digests; re-derives security-relevant fields from canonical plan;
  binds the candidate to canonical state; and recomputes every ref from `task_id`, the candidate (or `unbound` only
  when null), and the artifact key. Ledger/status-only promotion tails may advance without invalidating the frozen
  candidate. JSON Schema shape and packet self-consistency are necessary but insufficient for this boundary.
- Publishable package documentation refs derive from the task's package deliverables and authorized example paths;
  they are never hard-coded to an unrelated provider package.
- The lockfile delta is limited to the new workspace importer, internal workspace links, and the already pinned
  toolchain. New third-party dependency versions require a separate reviewed scope change.

## Consequences

- V1-05 can be validated from a clean frozen install and included in future npm releases.
- Root configuration changes remain narrow, reviewable, and mechanically tied to the package task.
- Product behavior, provider authority, deterministic catalog policy, and high-risk review gates are unchanged.
