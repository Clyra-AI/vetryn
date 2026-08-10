---
name: vetryn-promote-task
description: Perform maintainer-controlled promotion of a verified Vetryn task through canonical state, ledger, and generated progress. Use only after exact-candidate independent verification and required reviews; this skill never changes product code or supplies missing approval.
---

# Promote a Vetryn task

1. Confirm explicit maintainer authority and that the promoter did not implement the candidate. Read `AGENTS.md`, `WORKFLOW.md`, the compiled packet, task state, acceptance ledger, and all cited evidence.
2. Require one exact candidate commit, the candidate PR author as authenticated executor, gate-bound command evidence for every passing active command criterion and gate, all required reviews authenticated live as the latest decisive approvals against GitHub and protected-main CODEOWNERS, no blockers, no stale digests, and no non-waivable gap. A promotion commit may advance the same task PR only through canonical state, that task's ledger status/evidence, compact evidence, and generated progress, including both sides of renames; reviewed ledger fields and other task items remain immutable. The final validator must authenticate that complete tail from a clean checkout of the pushed PR head. Stop rather than manufacturing or inferring evidence.
3. For a waiver, require the canonical item or gate to be waivable plus explicit maintainer approval, rationale, scope, and evidence. No skill can waive privacy, secrets, fail-closed behavior, or repository policy.
4. Change only the task's canonical state, its acceptance-ledger status/evidence references, and newly added compact evidence. Never edit product code, existing evidence, or `progress.json` directly. Inspect the JSON and run formatting plus focused structural tests, but do not claim final validation from the dirty checkout.
5. With explicit maintainer authority, commit and push that canonical promotion checkpoint to the existing task PR. From the resulting clean authenticated head, run `pnpm plan:write`; commit and push the generated `progress.json` as a second checkpoint. The first checkpoint may temporarily report stale progress and is never merge-ready.
6. From the clean final pushed head, run `pnpm plan:check` and `pnpm check`, inspect the generated next-legal set and full promotion tail, then use Factory's `commit-push` in `land` mode to monitor the existing PR through CI, passive review, merge, and post-merge validation. Acceptance does not imply merge, and merge does not retroactively supply missing evidence.
