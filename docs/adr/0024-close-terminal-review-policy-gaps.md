# ADR 0024: Close terminal review policy gaps

Status: Accepted

## Context

Vetryn promotes a validated ProductCandidate with one promotion-only DeliveryHead. The workflow needs an
executable check that the tail contains only canonical task state, ledger, evidence, lifecycle reports, and
generated progress. Its lifecycle artifacts must not ambiguously name zero or multiple candidates.

Future planning also needs to classify approval, evidence, persistence, credential, security-control, and release
policy changes as high risk. Exact-path checks are insufficient because repository scopes normally use patterns
such as `scripts/**` or `product/plans/**`.

## Decision

`pnpm --silent task:promotion-tail -- TASK-ID PRODUCT-CANDIDATE DELIVERY-HEAD` is the canonical promotion-tail
gate. It requires a single promotion commit, task-scoped canonical artifacts, immutable prior evidence, generated
progress, passing candidate-bound lifecycle reports, and exactly one candidate identity across every identity
present in each lifecycle artifact. A work-proof marker therefore cannot combine a `git_sha` and authorized task
bindings that resolve to different commits.

Plan validation compares every new unaccepted task's allowed and deliverable scope patterns with a fixed set of
protected policy paths. Any matching task must be high risk. Accepted historical tasks remain unchanged.

## Consequences

- Promotion evidence inheritance is reproducible and fails closed on ambiguous candidate identity.
- Broad task scopes cannot evade high-risk review by using a benign domain label.
- The classifier remains deliberately small: it supports the repository's existing glob vocabulary and fixed
  protected paths rather than introducing a general policy framework.
- M0-13 may resume only after this task is accepted; its separate repair-generation policy is not reset.
