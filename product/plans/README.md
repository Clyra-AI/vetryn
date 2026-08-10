# Implementation plans

This directory contains reviewed, machine-readable delivery contracts. Product truth remains in
[`docs/oss-v1.md`](../../docs/oss-v1.md); plans define how that product contract is implemented and
verified.

Rules:

- `plan.json` and `acceptance-ledger.json` change only through reviewed planning work.
- One task owns one state file to reduce concurrent-agent conflicts.
- Evidence is immutable and bound to an exact commit and input digests.
- Executors may add candidate evidence but cannot broaden scope, rewrite criteria, or accept their own
  task.
- `progress.json` is generated with `pnpm plan:write` and verified with `pnpm plan:check`.
- Transient claims, prompts, raw command output, worktrees, credentials, and grants are never committed.

Factory-compatible runtime packets may be generated from these lean artifacts at dispatch time. They
are not the product-domain schemas used by Vetryn itself.
