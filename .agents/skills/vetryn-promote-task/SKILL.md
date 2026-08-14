---
name: vetryn-promote-task
description: Perform maintainer-controlled promotion of a locally validated Vetryn task through canonical state, ledger, and generated progress. This skill never changes product code or supplies missing approval.
---

# Promote a Vetryn task

1. Confirm explicit maintainer authority. Read `AGENTS.md`, `WORKFLOW.md`, the compiled packet, task state, acceptance
   ledger, and all cited evidence.
2. Require one exact **ProductCandidate** commit, gate-bound passing command evidence for every active command criterion and
   gate, no blockers, and no non-waivable gap. If the packet sets `code_review_required`, also require a passing
   candidate-bound Factory `review_report` produced after validation with no unresolved blocker. In ADR-0009
   single-maintainer V1 mode, named human reviewer records are advisory and recorded input digests remain
   historical provenance. Stop rather than manufacturing or inferring evidence.
3. For a waiver, require the canonical item or gate to be waivable plus explicit maintainer approval, rationale, scope, and evidence. No skill can waive privacy, secrets, fail-closed behavior, or repository policy.
4. Change only the task's canonical state, its acceptance-ledger status/evidence references, newly added compact
   lifecycle evidence, and generated progress. Run `pnpm plan:write`; never edit `progress.json` directly. Commit
   these changes together as one promotion-only **DeliveryHead** on the existing task branch.
5. Run formatting, `pnpm plan:check`, the focused plan/task structural tests, and
   `pnpm --silent task:promotion-tail -- TASK-ID PRODUCT-CANDIDATE DELIVERY-HEAD`. The executable gate must pass
   on the exact two full commit SHAs. Prove every path in the `ProductCandidate..DeliveryHead` diff is canonical state, that task's ledger entries, compact
   lifecycle evidence, generated progress, or another packet-declared promotion artifact. Do not rerun the full
   product or domain-review suite merely because this valid tail exists. A product, contract, test, fixture, or
   task-scoped documentation change invalidates inheritance and must return to implementation.
6. With explicit maintainer authority, push the DeliveryHead once and use Factory's `commit-push` in `land` mode to
   monitor required CI, one remote finding batch, merge, and one post-merge audit. The task lifecycle has one repair
   generation total; a new ProductCandidate or re-entry does not reset it. After that repair, the entire new batch is
   terminal: any P0/P1 or non-waivable finding blocks and routes to explicit corrective work, while at most one
   eligible standalone P2 may be recorded as delivery debt through ADR-0009 maintainer classification. Acceptance does not imply merge,
   and merge does not retroactively supply missing evidence.
