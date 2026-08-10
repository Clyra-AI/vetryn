# ADR 0006: Bootstrap merge governance

- **Status:** Accepted
- **Date:** 2026-08-10

## Context

The protected `main` branch requires one approving CODEOWNER review. During the repository's single-maintainer
bootstrap phase, the sole CODEOWNER is also the authenticated author of agent-created pull requests. GitHub
prohibits authors from approving their own pull requests, so the protection rule creates a governance deadlock
even after independent agent verification, required CI, CodeQL, dependency review, and passive Codex review
succeed.

Using the repository administrator bypass without documenting the operating mode would make the effective merge
policy differ from `AGENTS.md`, `WORKFLOW.md`, and branch protection. Treating maintainer chat authorization or an
agent verification as authenticated task review evidence would also weaken ADRs 0003 and 0004.

## Decision

- Enter a temporary single-maintainer bootstrap mode for branch merging.
- Configure protected `main` to require zero approving reviews and no CODEOWNER review. Keep `CODEOWNERS`
  committed as ownership documentation and for voluntary review routing.
- Continue to require green latest-head CI, CodeQL, dependency review, terminal latest-head passive Codex
  approval or thumbs-up, resolution of implemented review threads, and explicit maintainer authorization for the
  exact task or pull request before merge.
- Do not treat bootstrap merge authorization, agent verification, Codex settlement, or the merge itself as a
  substitute for any review role declared by the canonical task. Task acceptance and promotion continue to
  require their existing authenticated evidence and reviewer separation.
- Do not enable automatic merge authority, provider access, or broader GitHub capabilities through this mode.
- Exit bootstrap mode when at least two active maintainers can routinely review the repository and at least one
  eligible CODEOWNER is distinct from the typical pull-request author. At that point, restore at least one
  approving review and required CODEOWNER review before merging further product changes.

## Consequences

- A sole maintainer can land independently checked repository work without an undocumented administrator bypass.
- Branch merge readiness remains materially protected by required automation and explicit maintainer intent, but
  it temporarily lacks independent human approval.
- Merged work can remain unaccepted in the canonical task DAG until its declared review evidence exists; merge
  and product-task acceptance are deliberately separate states.
- `CODEOWNERS` remains useful but does not enforce approval during bootstrap mode.
- The temporary policy is visible, reviewable, and has an objective reinstatement trigger instead of becoming an
  accidental permanent weakening.
