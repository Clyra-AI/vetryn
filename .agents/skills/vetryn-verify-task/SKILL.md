---
name: vetryn-verify-task
description: Independently verify one exact Vetryn task candidate against its compiled packet, active gates, acceptance items, trust invariants, and evidence. Use after implementation and before maintainer promotion; never use as the implementing agent's self-approval path.
---

# Verify a Vetryn task

1. Confirm whether the verifier is independent of the executor. Read `AGENTS.md`, `WORKFLOW.md`, `docs/oss-v1.md`,
   and the candidate's compiled packet. Independence is recommended during the ADR-0009 single-maintainer V1 mode.
2. Check out or inspect the exact ProductCandidate commit. Recompile the task and compare source digests, scope, capabilities, acceptance items, gates, and attempt count. Stop on drift or an unclean candidate.
3. Inspect the full candidate diff for forbidden paths, broadened scope, secrets, raw protected inputs, fail-open behavior, and weakened abstention, privacy, evidence, or patch-safety semantics. For high-risk work, review the adversarial surface matrix and actively probe override order, mutation, concurrency, provenance, trust-boundary, and partial-failure cases instead of relying only on the happy-path diff.
4. Rerun every active required gate independently. Exercise deterministic success, failure, ambiguity, and stale-evidence paths appropriate to the task. Planned gates remain recorded gaps and can never be marked pass. When `QG-TRUST-REVIEW` is active, use `$vetryn-trust-review` for its semantic review.
5. Validate that evidence is candidate-bound, successful, compact, and redacted. Command evidence must bind the exact
   gate ID and canonical command. Its recorded plan and lockfile digests document the original inputs; later plan
   evolution does not invalidate an otherwise exact-candidate record. Reviewer records are advisory during
   ADR-0009. A summary, snapshot, or LLM judgment does not replace the declared deterministic assertion.
6. When the packet sets `code_review_required`, require a candidate-bound Factory `review_report` that cites the
   exact validation report and has no unresolved blockers. Record pass or changes-requested evidence for maintainer review. A later promotion-only DeliveryHead may inherit this result only when the deterministic tail check proves no product, contract, test, fixture, or task-scoped documentation byte changed; do not rerun verification solely for that valid tail. Do not change product code
   while acting as verifier, accept the task, edit generated `progress.json`, or merge.

Use Factory's `validation-gate` for generic exact-head validation and artifact checks. Apply Vetryn's trust review whenever `QG-TRUST-REVIEW` is required.
