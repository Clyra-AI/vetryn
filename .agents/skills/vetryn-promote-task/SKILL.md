---
name: vetryn-promote-task
description: Perform maintainer-controlled promotion of a locally validated Vetryn task through canonical state, ledger, and generated progress. This skill never changes product code or supplies missing approval.
---

# Promote a Vetryn task

1. Confirm explicit maintainer authority. Read `AGENTS.md`, `WORKFLOW.md`, the compiled packet, task state, acceptance
   ledger, and all cited evidence.
2. Require one exact candidate commit, gate-bound passing command evidence for every active command criterion and
   gate, no blockers, and no non-waivable gap. In ADR-0009 single-maintainer V1 mode, reviewer records are advisory
   and recorded input digests remain historical provenance. A promotion commit may change only canonical state, that
   task's ledger status/evidence, compact new evidence, and generated progress. Stop rather than manufacturing or
   inferring evidence.
3. For a waiver, require the canonical item or gate to be waivable plus explicit maintainer approval, rationale, scope, and evidence. No skill can waive privacy, secrets, fail-closed behavior, or repository policy.
4. Change only the task's canonical state, its acceptance-ledger status/evidence references, and newly added compact evidence. Never edit product code, existing evidence, or `progress.json` directly. Inspect the JSON and run formatting plus focused structural tests, but do not claim final validation from the dirty checkout.
5. With explicit maintainer authority, commit and push that canonical promotion checkpoint to the existing task PR. From the resulting clean authenticated head, run `pnpm plan:write`; commit and push the generated `progress.json` as a second checkpoint. The first checkpoint may temporarily report stale progress and is never merge-ready.
6. From the clean final pushed head, run `pnpm plan:check` and `pnpm check`, inspect the generated next-legal set and full promotion tail, then use Factory's `commit-push` in `land` mode to monitor the existing PR through CI, passive review, merge, and post-merge validation. Acceptance does not imply merge, and merge does not retroactively supply missing evidence.
