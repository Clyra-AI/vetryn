# Vetryn delivery workflow

This is the repository operating contract for humans, coding agents, and external Factory tooling. Product
truth remains in `docs/oss-v1.md`; delivery truth remains in the reviewed JSON under
`product/plans/oss-v1/`.

## Select and compile work

1. Run `pnpm plan:check` and `pnpm --silent task:next`.
2. Select one explicit task ID. Do not infer work from `ROADMAP.md` or chat history.
3. Run `pnpm --silent task:compile -- TASK-ID`. The compiler validates the canonical plan first, rejects work that
   is not legal to execute, and emits a deterministic packet bound to the product contract, plan, ledger, task
   state, and lockfile digests.
4. Use `$vetryn-implement-task` for implementation, `$vetryn-verify-task` for independent verification,
   and `$vetryn-promote-task` only for maintainer-controlled state promotion.

Factory's universal `task-executor`, `validation-gate`, and `commit-push` skills provide generic worker,
verification, and GitHub lifecycle behavior. Vetryn's skills add only repository-specific task semantics.
Factory is an external development tool, not a product dependency or git submodule.

## Roles and authority

- The executor may change only the compiled task's allowed paths and cannot accept the task.
- The verifier must be independent of the executor and must verify the exact candidate commit.
- The maintainer owns acceptance, allowed waivers, and merge authority.
- Generated `progress.json` is never edited directly.
- Network, credentials, provider calls, and GitHub writes require both task capability and explicit human
  authorization. No ambient credential or implied chat permission expands a packet.

## Verification and evidence

Run the smallest relevant checks during implementation and `pnpm check` before handoff or shipping. Tests
must cover deterministic success, failure, and stale-evidence behavior. Evidence is candidate-bound,
compact, and redacted; raw prompts, model output, credentials, private traces, and full logs are not committed.
Command evidence names the exact gate and canonical command it proves; evidence for one command cannot satisfy
another gate. Approval evidence is re-fetched from GitHub's public API during validation. The normal path must
match the repository, pull request, review ID, reviewer, eligible association, approved state, URL, and candidate
commit. The candidate executor is the candidate PR author authenticated by GitHub, not editable branch text. The
reviewer must differ from that actor, own the role's protected surface under CODEOWNERS fetched from protected
`main`, and remain the latest decisive reviewer on the exact candidate commit.

During ADR-0006 bootstrap, one alternative is allowed: a PR issue comment from a GitHub `OWNER` who owns the
requested role's protected-main CODEOWNERS surface. The authenticated current comment body must exactly use this
seven-line format, with no extra text or fields:

```text
<!-- vetryn-bootstrap-review:v1 -->
repository=Clyra-AI/vetryn
pull_request=<number>
task_id=<TASK-ID>
candidate_sha=<40-lowercase-hex-sha>
decision=APPROVED
roles=<comma-separated-role-names>
```

The durable evidence records the issue-comment ID, exact URL, and exact body. Validation re-fetches the comment
and requires its actor, `OWNER` association, body, repository, PR, task, candidate, decision, and requested role
to match. The owner may also be the authenticated PR author only on this path. The same task PR
may advance past that commit only for promotion: GitHub's comparison must prove that the candidate is an ancestor
and that the complete tail changes only the task's canonical state, acceptance ledger, compact evidence, or
generated progress. Within the shared ledger, only status and evidence references for that task may change;
reviewed fields and other tasks are immutable. Evidence files present at the candidate are immutable; promotion
may only add evidence whose contents and filename bind to that task. Rename source and destination paths are both
restricted. Validation must run from a clean committed checkout equal to the authenticated open-PR head or its
GitHub synthetic merge commit; later checkouts require GitHub-authenticated ancestry from the merged PR. Review
normal review records are authenticated from one bounded history fetch per PR, while bootstrap comments are
fetched once by globally unique issue-comment ID and cached, to stay within the public API budget. Editable
branch evidence and role fields are never sufficient on their own. Authentication uses Node's built-in HTTPS
fetch and absolute system Git, not a PATH-resolved repository executable; network, Git, or response failures fail
closed.

Promotion therefore uses two explicit maintainer-authorized checkpoints: first commit and push canonical state,
ledger, and new evidence; then run `pnpm plan:write` from that clean authenticated head and push generated
progress. Only the clean final pushed head may run and claim `pnpm plan:check` and `pnpm check`. The intermediate
stale-progress check is never merge-ready.

ADR 0005 permits an exact-candidate independent **local preflight** plus explicit maintainer authorization to
enable the initial branch push and pull-request creation. That preflight is publication safety evidence only; it
must not be recorded as a passing `QG-INDEPENDENT-VERIFY` or `QG-TRUST-REVIEW` gate. Once the pull request exists,
canonical review gates require their GitHub-authenticated evidence before acceptance or promotion.

The repository preserves these test levels as the product grows: static, unit, property, contract,
integration, end-to-end, acceptance, adversarial/hardening, chaos, performance/soak, scenario, and field.
Only gates marked active in the canonical plan may be claimed as run or pass; planned gates remain explicit gaps
even if an evidence record names their future command.

## Pull requests and review

Use one task per branch and pull request. Pull requests explain the problem, bounded changes, validation,
risks, and evidence. Required latest-head CI and passive Codex review must settle before merge, and all
implemented review threads must be resolved.

ADR 0006 defines a temporary single-maintainer bootstrap mode in which GitHub branch protection may require zero
approvals and no CODEOWNER review. A merge in that mode still requires explicit maintainer authorization for the
exact task or pull request, green latest-head CI, CodeQL, and dependency review, a terminal latest-head Codex
approval or thumbs-up, and no unresolved actionable findings. Bootstrap merge authorization is lifecycle-only
and cannot be recorded as task review evidence. A separate structured OWNER comment may satisfy only the roles
it names under the authenticated evidence rules above; it cannot supply acceptance or promotion by itself and
does not turn CI, Codex settlement, or local agent verification into review evidence. Restore at least one
independent approval and CODEOWNER review when the ADR's exit condition is met.

A profile may allow a **standalone P2 exception** only when all of the following are true: a human explicitly
authorizes that exact task or pull request; the finding is on the current head; exactly one classified P2 and
no other actionable or unclassified Codex finding remains; no P0, P1, `CHANGES_REQUESTED`, active `eyes`, or
pending review signal exists; required latest-head CI is green; all mandatory human review requirements are
satisfied; and the authorization plus finding is recorded in durable pull-request lifecycle evidence. The
exception never converts a pending review into permission and never applies to P0/P1, multiple P2s, or a P2
with a demonstrated correctness, security, privacy, data-loss, or contract break.

## Merge and post-merge

Maintainers normally squash-merge. After merge, synchronize `main` and monitor default-branch CI to a terminal
green result. An actionable repository failure uses a new hotfix pull request and the same review gates; an
external or permission failure is reported without weakening policy.
