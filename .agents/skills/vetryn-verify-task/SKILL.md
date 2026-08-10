---
name: vetryn-verify-task
description: Independently verify one exact Vetryn task candidate against its compiled packet, active gates, acceptance items, trust invariants, and evidence. Use after implementation and before maintainer promotion; never use as the implementing agent's self-approval path.
---

# Verify a Vetryn task

1. Confirm the verifier is not the executor. Read `AGENTS.md`, `WORKFLOW.md`, `docs/oss-v1.md`, and the candidate's compiled packet.
2. Check out or inspect the exact candidate commit. Recompile the task and compare source digests, scope, capabilities, acceptance items, gates, and attempt count. Stop on drift or an unclean candidate.
3. Inspect the full candidate diff for forbidden paths, broadened scope, secrets, raw protected inputs, fail-open behavior, and weakened abstention, privacy, evidence, or patch-safety semantics.
4. Rerun every active required gate independently. Exercise deterministic success, failure, ambiguity, and stale-evidence paths appropriate to the task. Planned gates remain recorded gaps and can never be marked pass.
5. Validate that evidence is candidate-bound, successful, compact, and redacted. Command evidence must bind the exact gate ID and canonical command. Review evidence must authenticate the candidate PR author as executor, differ from that actor, authenticate against GitHub's public API and protected-main CODEOWNERS for the role's protected surface, target the exact candidate commit, and remain the reviewer's latest decisive review on that commit. If a promotion commit advances the task PR, require GitHub to prove that the candidate is its ancestor and that the complete tail changes only canonical state, task-scoped ledger status/evidence, compact evidence, or generated progress, including both sides of renames. Reviewed ledger fields and other tasks remain immutable. Run final validation only from the clean authenticated PR head, or from a later checkout containing the authenticated merge commit; branch-authored actor, approval, or role text is not authority. A summary, snapshot, or LLM judgment does not replace the declared deterministic assertion.
6. Record pass or changes-requested evidence for maintainer review. Do not change product code while acting as verifier, accept the task, edit generated `progress.json`, or merge.

Use Factory's `validation-gate` for generic exact-head validation and artifact checks. Apply Vetryn's trust review whenever `QG-TRUST-REVIEW` is required.
