# ADR 0004: Authenticate promotion provenance

- **Status:** Accepted
- **Date:** 2026-08-10
- **Supersedes:** The current-head approval wording in ADR 0003

## Context

ADR 0003 required an approval on the current pull-request head. Persisting that approval and accepted task
state necessarily creates a later promotion commit, making the evidence self-referential. Allowing a promotion
tail by path alone introduced two further trust gaps: the checkout under validation could be unrelated to the
approved PR, and the shared acceptance ledger could carry unreviewed changes for another task. Candidate executor
identity also remained editable branch text, so it could not prove reviewer independence.

## Decision

- Treat the candidate pull-request author returned by GitHub as the authenticated executor. Review evidence must
  name that actor, and the approving reviewer must be a different GitHub account case-insensitively.
- Bind approval to the exact candidate commit and require it to remain the reviewer's latest decisive review on
  that commit.
- Permit the same task PR to advance only through a complete GitHub-authenticated promotion tail whose candidate
  is the merge base. Restrict both source and destination paths for renames.
- Restrict acceptance-ledger promotion changes semantically: only `status` and `evidenceRefs` may change, and only
  for items owned by the promoted task. Reviewed fields, ledger metadata, membership, ordering, and other tasks'
  items remain immutable.
- Require final validation from a clean committed checkout equal to the authenticated open-PR head. After merge,
  durable evidence remains valid only in a checkout that contains the PR's authenticated merge commit.
- Use Node's built-in HTTPS implementation for GitHub data and absolute system Git with fixed arguments for local
  checkout identity. Network, history, comparison, checkout, and parsing failures fail closed.

## Consequences

- Promotion evidence can be committed without approving the promotion commit as if it were product code.
- Copying authentic evidence into an unrelated branch or inventing a different executor cannot satisfy review
  separation.
- Promotion cannot rewrite reviewed acceptance semantics or affect another task through the shared ledger.
- CI must check out the exact PR head with full history, and final promotion validation occurs only after that
  canonical promotion head is committed and pushed.
- Squash-merged evidence remains durable because later branches contain GitHub's authenticated merge commit even
  when they do not contain the original candidate commit.
