# Implementation plans

This directory contains reviewed, machine-readable delivery contracts. Product truth remains in
[`docs/oss-v1.md`](../../docs/oss-v1.md); plans define how that product contract is implemented and
verified.

Rules:

- `plan.json` and `acceptance-ledger.json` change only through reviewed planning work.
- One task owns one state file to reduce concurrent-agent conflicts.
- Evidence is immutable and bound to an exact commit, the reviewed plan and lockfile digests, and—when it
  represents approval—an authenticated GitHub approval, eligible author association, review identity, and role
  whose actor differs case-insensitively from the candidate executor and whose observed commit matches the
  candidate. A later promotion head must descend from that commit and may change only canonical promotion files.
  Final validation binds a clean checkout to the authenticated open-PR head or a contained authenticated merge.
- Executors may add candidate evidence but cannot broaden scope, rewrite criteria, or accept their own
  task.
- `progress.json` is generated with `pnpm plan:write` and verified with `pnpm plan:check`.
- Transient claims, prompts, raw command output, worktrees, credentials, and grants are never committed.

Factory-compatible runtime packets are generated with `pnpm --silent task:compile -- TASK-ID`. They are
deterministic, source-digest-bound dispatch inputs, not the product-domain schemas used by Vetryn itself.
