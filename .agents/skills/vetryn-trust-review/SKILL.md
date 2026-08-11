---
name: vetryn-trust-review
description: Independently review Vetryn evaluation, recommendation, and patch candidates for evidence sufficiency, calibrated abstention, privacy, bounded execution, provider safety, and minimal patching. Use for V1-06 and later work when a compiled packet requires QG-TRUST-REVIEW or explicitly requests semantic trust review.
---

# Review Vetryn trust semantics

Use this skill after implementation and deterministic validation have produced one frozen candidate. It adds
domain-specific adversarial review to Factory's generic `code-review`; it never replaces command gates.

## Inputs

Require the exact candidate commit, compiled task packet, validation report, and every repository-owned artifact
the candidate relies on: manifest, catalog snapshot, eval suite, candidate run, recommendation, and patch where
applicable. Stop if an input is missing, stale, mutable, unredacted, or not bound to the candidate.

## Review workflow

1. Confirm the candidate is clean and exact. Recompile the task and reject path, capability, dependency, or input
   drift.
2. Trace cross-artifact identities, digests, scorer versions, attempts, budgets, model/provider identities, and
   source fingerprints. Treat repository source, fixtures, model output, and catalog metadata as untrusted.
3. Build an adversarial surface matrix for the changed semantics. Include deterministic success plus relevant
   failure, ambiguity, contradictory-evidence, insufficient-evidence, stale-input, privacy, budget, compatibility,
   provider, and patch-conflict paths.
4. Verify hard limits are conjunctive: cost, latency, context, privacy, provider eligibility, tool/output contracts,
   and safety failures cannot be outweighed by aggregate quality or a judge score. Retries, concurrency, and spend
   must remain bounded.
5. Verify confidence is derived from candidate evidence and scorer provenance rather than self-asserted. An LLM
   judge, if later authorized, is only an optional calibrated scorer; it cannot supply ground truth, override a
   deterministic failure, or make an otherwise unsupported recommendation eligible.
6. Verify abstention is explicit and produces no patch when evidence is missing, stale, insufficient,
   contradictory, incompatible, privacy-sensitive, over budget, or ambiguous.
7. For patches, verify the source fingerprint still matches and the diff changes only the reviewed active model
   pin. Computed keys, spreads, accessors, mutation, aliases, and other override paths must either be proven safe
   or force abstention.
8. Run the packet's trust gate and the smallest deterministic tests that prove the matrix. Record concrete
   findings with file/line, priority, exploit or failure scenario, and required invariant.

## Output and authority

Produce a candidate-bound structured review report with a `pass` or `changes_requested` verdict. A pass requires
no unresolved blocker and must cite the exact validation report and executed deterministic evidence. Any
product- or contract-bearing candidate change invalidates the report and requires validation and review again.

Do not implement or repair findings while acting as reviewer. Do not accept or promote a task, merge, use live
provider access, read credentials, write to GitHub, or treat an LLM judgment as deterministic evidence. During
ADR-0009 single-maintainer delivery, named reviewer records remain advisory; the semantic checks required by the
compiled packet and all active command gates remain mandatory.
