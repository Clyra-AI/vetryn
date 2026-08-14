# ADR 0022: Separate continuation procedure from run authority

- Status: Accepted
- Date: 2026-08-14

## Context

Vetryn's reviewed plan and task compiler already define what work is legal and how implementation, validation,
review, promotion, and protected delivery proceed. Maintainers want one portable invocation that discovers the
next task without copying task IDs, machine paths, or that workflow into chat prompts.

An earlier design attempted to turn the helper into a host sandbox and authenticate installed Factory packages.
That duplicated delivery controls, increased maintenance cost, and did not improve Vetryn product behavior.

## Decision

Add `$vetryn-continue-next` as a small repository-owned procedure. Its read-only preflight:

1. discovers the repository root;
2. requires a clean checkout;
3. runs the existing plan check;
4. selects exactly one active task, otherwise exactly one next-legal task;
5. compiles that task's packet and reports its scope, commands, skills, reviews, and lifecycle; and
6. rejects any change to HEAD or worktree status during the run.

The helper trusts the developer host, package installation, and installed skills. It does not authenticate worker
bytes, implement a sandbox, require a sibling Factory checkout, validate lifecycle evidence, or copy Factory's
shipping logic. Those concerns remain with the existing repository and installed-skill workflows.

The procedure never grants authority. Branch creation, repository mutation, promotion, GitHub writes, merge,
credentials, provider access, and spend require an explicit current-run grant from a current maintainer, bounded by
the compiled packet and repository policy. Direct pushes to `main` and waivers of non-waivable requirements remain
forbidden.

## Consequences

- A maintainer can invoke the full workflow without knowing the next task ID or local checkout path.
- Vetryn remains independent of a sibling Factory checkout and avoids maintaining a second workflow engine.
- A compromised developer host or installed tool remains capable of compromising local development; this helper
  is not a defense against that trusted-host threat model.
- A stale, dirty, ambiguous, failing, or mutating preflight stops before later work and requires correction rather
  than automatic repair.
