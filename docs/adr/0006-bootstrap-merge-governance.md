# ADR 0006: Bootstrap merge governance

- **Status:** Superseded for OSS V1 delivery by ADR 0009
- **Date:** 2026-08-10

## Context

The protected `main` branch requires one approving CODEOWNER review. During the repository's single-maintainer
bootstrap phase, the sole CODEOWNER is also the authenticated author of agent-created pull requests. GitHub
prohibits authors from approving their own pull requests, so the protection rule creates a governance deadlock
even after independent agent verification, required CI, CodeQL, dependency review, and passive Codex review
succeed.

Using the repository administrator bypass without documenting the operating mode would make the effective merge
policy differ from `AGENTS.md`, `WORKFLOW.md`, and branch protection. Treating maintainer chat authorization, CI,
Codex settlement, or an agent verification as authenticated task review evidence would also weaken ADRs 0003
and 0004. GitHub cannot record an approving PR review from its author, so bootstrap additionally needs a narrow,
public, exact-candidate owner attestation that the validator can authenticate without relaxing the normal path.
For comments in the organization-owned repository, the anonymous public API may report the sole repository owner
as `CONTRIBUTOR` when private organization membership is hidden, even when authenticated GitHub surfaces report
`MEMBER`. Public association is therefore exact provenance, not authorization. Protected-main CODEOWNERS remains
the role-authorization source.

## Decision

- Enter a temporary single-maintainer bootstrap mode for branch merging.
- Configure protected `main` to require zero approving reviews and no CODEOWNER review. Keep `CODEOWNERS`
  committed as ownership documentation and for voluntary review routing.
- Continue to require green latest-head CI, CodeQL, dependency review, terminal latest-head passive Codex
  approval or thumbs-up, resolution of implemented review threads, and explicit maintainer authorization for the
  exact task or pull request before merge.
- Preserve the normal task-review path: an authenticated exact-candidate GitHub `APPROVED` review from a
  CODEOWNER distinct from the PR author, still current in that reviewer's decisive history.
- Add one bootstrap-only alternative. A protected-main CODEOWNER may post the exact seven-line
  `vetryn-bootstrap-review:v1` PR issue-comment marker defined in `WORKFLOW.md`, naming this repository, PR, task,
  candidate SHA, `APPROVED` decision, and one or more roles. The evidence records the issue-comment ID, exact URL,
  exact body, and the anonymous public API association. Validation re-fetches the PR, comment, and protected-main
  CODEOWNERS and fails closed unless the current durable comment and every binding match. Public association must
  match the evidence and be `OWNER`, `MEMBER`, or `CONTRIBUTOR`; `NONE` and `COLLABORATOR` fail. The CODEOWNER may
  also be the authenticated PR author.
- Treat that comment only as evidence for roles it names. Bootstrap merge authorization, agent verification, CI,
  Codex settlement, and the merge itself remain separate and cannot substitute for the comment, task acceptance,
  or canonical promotion.
- Do not enable automatic merge authority, provider access, or broader GitHub capabilities through this mode.
- Exit bootstrap mode when at least two active maintainers can routinely review the repository and at least one
  eligible CODEOWNER is distinct from the typical pull-request author. At that point, restore at least one
  approving review and required CODEOWNER review, and disable the owner-comment review alternative, before
  merging further product changes.

## Consequences

- A sole maintainer can land independently checked repository work without an undocumented administrator bypass.
- Branch merge readiness remains materially protected by required automation and explicit maintainer intent, but
  its task review may temporarily be owner-authenticated rather than independent human approval.
- The same maintainer can author a PR and authorize named review roles only through the public, exact-candidate
  marker; deleted, edited, stale, malformed, mis-scoped, `COLLABORATOR`, `NONE`, mismatched-association, or
  non-CODEOWNER comments fail closed.
- Merged work can remain unaccepted in the canonical task DAG until all declared gates and canonical promotion
  evidence exist; merge and product-task acceptance remain deliberately separate states.
- Branch protection does not require CODEOWNER approval during bootstrap mode, but validation still uses
  protected-main `CODEOWNERS` as the authority for both normal reviewers and owner-comment roles; the public
  association is retained only as authenticated provenance.
- The temporary policy is visible, reviewable, and has an objective reinstatement trigger instead of becoming an
  accidental permanent weakening.
