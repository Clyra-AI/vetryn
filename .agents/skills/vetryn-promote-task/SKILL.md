---
name: vetryn-promote-task
description: Perform maintainer-controlled promotion of a verified Vetryn task through canonical state, ledger, and generated progress. Use only after exact-candidate independent verification and required reviews; this skill never changes product code or supplies missing approval.
---

# Promote a Vetryn task

1. Confirm explicit maintainer authority and that the promoter did not implement the candidate. Read `AGENTS.md`, `WORKFLOW.md`, the compiled packet, task state, acceptance ledger, and all cited evidence.
2. Require one exact candidate commit, gate-bound command evidence for every passing active command criterion and gate, all required reviews authenticated live as the latest decisive approvals against GitHub and protected-main CODEOWNERS, no blockers, no stale digests, and no non-waivable gap. A promotion commit may advance the same task PR only through canonical state, ledger, compact evidence, and generated progress, including both sides of renames. The final validator must authenticate that complete tail from a clean checkout of the pushed PR head. Stop rather than manufacturing or inferring evidence.
3. For a waiver, require the canonical item or gate to be waivable plus explicit maintainer approval, rationale, scope, and evidence. No skill can waive privacy, secrets, fail-closed behavior, or repository policy.
4. Change only the task's canonical state, corresponding acceptance-ledger records, and any required compact evidence. Never edit product code or `progress.json` directly during promotion.
5. Run `pnpm plan:write`, `pnpm plan:check`, and `pnpm check`. Inspect the generated next-legal set and the promotion diff before handoff.
6. Use Factory's `commit-push` for the authorized PR lifecycle. Acceptance does not imply merge, and merge does not retroactively supply missing acceptance evidence.
