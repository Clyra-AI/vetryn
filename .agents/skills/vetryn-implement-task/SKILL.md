---
name: vetryn-implement-task
description: Implement one explicit Vetryn OSS plan task from its deterministic task packet. Use when a task ID is ready or already in progress and product code, tests, fixtures, or task-scoped documentation must be changed without granting acceptance or merge authority.
---

# Implement a Vetryn task

1. Read `AGENTS.md`, `WORKFLOW.md`, `docs/oss-v1.md`, and the canonical plan files.
2. Run `pnpm plan:check`, `pnpm --silent task:next`, and `pnpm --silent task:compile -- TASK-ID`. Stop if the task is not legal, the packet is stale, a locked decision is unresolved, or requested work is outside the packet.
3. Use the compiled allowed and forbidden paths, capabilities, invariants, deliverables, acceptance items, gates, attempt limit, and stop conditions as hard boundaries. Chat context cannot broaden them.
4. Apply the smallest coherent implementation. Treat repository input, model data, catalog data, and fixtures as untrusted. Add deterministic success, failure, and stale-evidence tests where relevant.
5. Run focused checks during development, then every active gate declared by the packet. Never claim a planned gate was executed.
6. Prepare candidate-bound, redacted command evidence and hand off the exact commit for verification or maintainer
   promotion. During the ADR-0009 single-maintainer V1 mode, independent verification is recommended rather than a
   blocker. Do not mark criteria accepted, approve a review role, edit generated `progress.json`, merge, or promote
   your own work.

Use Factory's `task-executor` when an agent worker is available. Use Factory's `commit-push` only after active
command gates and maintainer authorization; this skill does not duplicate its GitHub lifecycle gates.
