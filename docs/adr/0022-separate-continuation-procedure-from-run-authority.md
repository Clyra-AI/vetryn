# ADR 0022: Separate continuation procedure from run authority

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

Vetryn has deterministic task selection, compilation, validation, review, promotion, and protected delivery
contracts, but a collaborator still had to reconstruct their ordering from repository documentation and prior
context. A reusable continuation skill can remove that friction only if it does not become standing authority or
introduce a machine-local Factory checkout dependency.

The dangerous boundary is not task discovery. It is interpreting a convenient prompt, installed skill, roster
entry, ambient credential, or locally edited profile as permission to mutate a repository or external system.
Offline preflight also cannot prove that a server-side ref or repository role remains current.

## Decision

- Add one explicitly invoked `vetryn-continue-next` skill. It stores reusable procedure and prohibitions, not a
  task ID, commit, username, absolute path, credential, grant, or product-specific copy of Factory behavior.
- Its first action is a shell-free, read-only preflight. The preflight discovers the Git root and profile-declared
  adapter, runs plan check, task selection, and dynamic task compilation twice, and selects exactly one active task
  or, when none is active, exactly one next-legal task.
- Preflight snapshots HEAD, branch, refs, index, tracked/untracked/ignored worktree content, local Git config,
  remotes, and canonical inputs before and after. Any dirty, stale, ambiguous, missing, non-deterministic, or
  changed state blocks without repair. Git replacement refs are rejected before canonical reads.
- `.factory/profile.yaml` becomes the self-contained repository-owned profile for the four portable Factory workers. It pins one immutable
  portable worker-pack source and every worker manifest. The Vetryn bootstrap verifies that the profile is a
  regular tracked file equal to `HEAD`, verifies each external manifest pin, authenticates the verifier bytes from
  the manifest, and only then runs the installed verifier over the complete pack set. A sibling checkout is never
  consulted.
- Portable pack-set v1 supports POSIX macOS and Linux with `/dev/fd`. Unsupported platforms return a typed blocker
  before installed-pack I/O; the bootstrap never falls back to reopening a named verifier path.
- A successful preflight emits strict, stable, path-redacted JSON with status `ready_for_authority`. That status is
  diagnostic only. It neither authenticates the caller nor authorizes mutation, network access, credentials,
  provider spend, promotion, GitHub writes, or merge.
- Before any later effect, the control plane or acting agent must authenticate a current listed maintainer who
  still has repository write authority and bind the grant to the current run, selected task, compiled packet, and
  exact actions. Roster membership, `CODEOWNERS`, skill invocation, chat history, self-asserted identity, and
  ambient GitHub credentials are explicitly insufficient.
- Effective permission is the intersection of the packet capability ceiling, the authenticated grant, and
  non-waivable repository policy. Direct default-branch pushes, automatic product merges, and waivers of privacy,
  fail-closed behavior, provider safety, or evidence integrity remain forbidden.
- Active continuation is deliberately narrower than selection: only `in_progress` state with no frozen candidate
  may resume, from an in-scope non-default descendant of synchronized main. Candidate-bound and later lifecycle
  states return `frozen_candidate_resume_unsupported` until a reviewed tail contract can distinguish valid
  lifecycle commits from arbitrary descendants without requiring a self-referential commit identifier.

## Consequences

- A maintainer can start from an arbitrary clean checkout and use one stable invocation without knowing the next
  task ID or maintaining a Factory sibling.
- Missing or tampered installed packs fail closed and require reinstalling the pinned set or landing a reviewed
  pin update; local rewrites cannot make them trusted.
- Two phases remain visible: offline readiness, then authenticated authority. Automation may connect them, but it
  must not collapse their evidence or infer the second from the first.
- Server freshness still requires a separately authorized remote read followed by another preflight when the
  operation needs it. The offline result reports that limitation rather than claiming global freshness.
- Repository adapters remain HEAD-owned, shell-free, repeated inputs surrounded by full snapshot checks. Preflight
  does not claim to defend against a malicious process with the same OS account that can rewrite and restore the
  checkout during execution; run it only on a trusted local host.
