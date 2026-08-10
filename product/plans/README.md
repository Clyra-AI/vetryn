# Implementation plans

This directory contains reviewed, machine-readable delivery contracts. Product truth remains in
[`docs/oss-v1.md`](../../docs/oss-v1.md); plans define how that product contract is implemented and
verified.

Rules:

- `plan.json` and `acceptance-ledger.json` change only through reviewed planning work.
- One task owns one state file to reduce concurrent-agent conflicts.
- Evidence is immutable and bound to an exact commit and command gate. Plan and lockfile digests record the inputs
  observed when it ran; later unrelated planning changes do not invalidate that historical provenance. During the
  ADR-0009 single-maintainer V1 mode, reviewer records are advisory. Promotion changes only the task's canonical
  state, its ledger status/evidence references, compact new task evidence, and generated progress.
- Executors may add candidate evidence but cannot broaden scope, rewrite criteria, or accept their own
  task.
- `progress.json` is generated with `pnpm plan:write` and verified with `pnpm plan:check`.
- Transient claims, prompts, raw command output, worktrees, credentials, and grants are never committed.

Factory-compatible runtime packets are generated with `pnpm --silent task:compile -- TASK-ID`. They are
deterministic, source-digest-bound dispatch inputs, not the product-domain schemas used by Vetryn itself.
