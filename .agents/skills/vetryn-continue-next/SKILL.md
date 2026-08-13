---
name: vetryn-continue-next
description: Continue the sole legal Vetryn plan task from repository-owned state. Use when an explicitly authorized maintainer asks Codex to discover, implement, validate, review, promote, and ship whichever Vetryn task is currently active or next legal without relying on a task ID, machine-local path, sibling Factory checkout, or prior chat.
---

# Continue the next Vetryn task

Run the repository-owned preflight before any branch, file, credential, network, provider, GitHub, promotion, or
merge action:

```sh
node .agents/skills/vetryn-continue-next/scripts/preflight.mjs
```

Treat its JSON as diagnostic evidence, not authority. `ready_for_authority` means only that the local repository,
canonical task packet, worker-required profile fields, and installed Factory packs formed one mutation-free offline snapshot.
It does not authenticate the invoking user, prove the server is current, or authorize a later action.

## Continue safely

1. Stop on `blocked`, a nonzero exit, zero or multiple selected tasks, or any state change observed during preflight.
2. Authenticate a current-run grant from a maintainer listed in `MAINTAINERS.md` who still has repository write
   authority. Bind it to the emitted task ID, packet ID, and exact action set. Roster membership, `CODEOWNERS`, this
   skill, a prior conversation, self-asserted identity, and ambient GitHub credentials are not grants.
3. Intersect the grant with the packet's capabilities and repository prohibitions. Never waive privacy,
   fail-closed behavior, provider safety, evidence integrity, required gates, or protected-branch delivery. Never
   push directly to the default branch or use live-provider spend or credentials unless the packet and authenticated
   grant both allow them.
4. When server freshness is required and authorized, refresh the configured remote without changing worktree or
   plan state, then rerun preflight. Stop if the local and remote-tracking default refs no longer agree.
5. For a next-legal task, create one non-protected task branch. Resume only canonical `in_progress` work with no
   frozen candidate, on the clean in-scope descendant identified by preflight. Candidate-bound and later review
   phases stop until a separately reviewed lifecycle-tail contract exists. Compile the selected task again before
   editing.
6. Immediately before each installed Factory worker invocation, run
   `node .agents/skills/vetryn-continue-next/scripts/preflight.mjs --worker-packs-only` from a clean checkpoint.
   Require `workers_authenticated`, the same source and manifest digests as the full preflight, and no intervening
   pack mutation before invocation. Then use the repository implementation skill and `task-executor`. Stay inside
   the packet paths and capabilities. Do not accept, promote, or ship from the executor role.
7. Reauthenticate the worker packs the same way before `validation-gate` and, for high-risk work, `code-review`.
   Run every packet-declared command and required repository domain review. Any product- or contract-bearing change
   invalidates validation and review evidence.
8. Only after all non-waivable gates pass, use `vetryn-promote-task` with the authenticated maintainer grant. Inspect
   the promotion tail; it may contain only task state, ledger/evidence, and generated progress.
9. Reauthenticate once more immediately before using installed Factory `commit-push` in the packet's protected PR
   lifecycle. Respect current-head CI and review policy, merge only under the authenticated grant, monitor the
   default branch, then report the newly legal task.

Read `references/preflight-result.schema.json` when consuming or integrating the output contract. Do not copy
Factory worker logic into this skill; use only packs authenticated by the committed Vetryn profile and preflight.

## Stop conditions

Stop without repair or mutation when selection is ambiguous, a dependency or skill is missing, the profile or pack
trust chain fails, a command or review cannot be resolved, the branch/default refs drift, authority is absent or
stale, the platform cannot execute the pinned worker-pack contract safely, requested scope exceeds the packet, or
a non-waivable gate fails. Report the stable blocker code and the smallest operator action needed to restore
canonical state.
