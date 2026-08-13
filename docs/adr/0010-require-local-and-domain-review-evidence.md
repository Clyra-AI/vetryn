# ADR 0010: Require local and domain review evidence

- **Status:** Accepted
- **Date:** 2026-08-11

## Context

Vetryn's maintainer-led policy keeps named human reviewer records advisory, but high-risk implementation still
benefits from a frozen-candidate adversarial code review. Evaluation, recommendation, and patch tasks also need a
domain-specific trust review that checks abstention, provenance, privacy, compatibility, and hard limits. Treating
both checks as prose would let an executable task packet complete without producing the corresponding evidence.

## Decision

- High-risk task packets require Factory `code-review` after deterministic validation and before promotion or push.
- An active `QG-TRUST-REVIEW` separately emits `vetryn-trust-review` in `required_domain_review_chain`, sets
  `trust_review_required`, and requires a candidate-bound `trust_review_report`.
- Generic code review and domain trust review are independent. Neither replaces command evidence, repository CI,
  or remote latest-head Codex review.
- Product- or contract-bearing candidate changes invalidate local review evidence and require validation and the
  applicable reviews to run again.
- The added packet fields are additive. Consumers that enforce lifecycle completion must recognize the domain
  review chain and fail closed when a declared report is absent; readers that only inspect existing fields remain
  compatible.

## Consequences

- V1-06 and later tasks with `QG-TRUST-REVIEW` cannot appear lifecycle-complete after only generic code review.
- The repository skill remains bounded to review and cannot implement, promote, accept, push, or merge.
- Task-packet consumers need a small compatibility update before executing a packet that declares a domain review.
