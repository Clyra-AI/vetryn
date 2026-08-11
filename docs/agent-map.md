# Agent operating map

This document helps humans and coding agents find the right source, workflow, and skill for a Vetryn change.
It is a committed navigation guide, not a second product specification or backlog. The canonical plan and a
compiled task packet always take precedence over this map.

## Authority map

| Question                                                   | Authoritative source                                      |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| What is OSS V1?                                            | `docs/oss-v1.md`                                          |
| Why is a product or trust boundary locked?                 | `docs/adr/`                                               |
| How is the system divided?                                 | `docs/architecture.md`                                    |
| What can execute next?                                     | `product/plans/oss-v1/plan.json` plus `state/*.json`      |
| What proves acceptance?                                    | `acceptance-ledger.json` plus immutable `evidence/*.json` |
| How is a task implemented, verified, promoted, and merged? | `WORKFLOW.md`                                             |
| Which repository skill applies?                            | This document and `.agents/skills/`                       |
| What is current progress?                                  | Generated `product/plans/oss-v1/progress.json`            |

`ROADMAP.md` is a human summary. Chat history, ignored files, local prompts, and generated progress never grant
task scope, capabilities, acceptance, review, or merge authority.

## Repository map

| Path                              | Responsibility                                                                      | Change discipline                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/core/`                  | Provider-neutral schemas, canonical artifacts, and decision primitives              | Keep free of filesystem, network, provider, GitHub, and AST dependencies         |
| `packages/typescript/`            | TypeScript discovery, source binding, fingerprints, and verified literal patching   | Extract only when its implementation milestone begins                            |
| `packages/openrouter/`            | Catalog normalization, compatibility, provider execution, pricing, and usage        | Treat catalog and provider data as untrusted and pin provenance                  |
| `packages/cli/`                   | Filesystem orchestration, commands, reports, and user-facing composition            | Compose inward-facing packages without moving domain rules into command handlers |
| `examples/openrouter-typescript/` | Golden repository, reviewed cases, mock provider, scenarios, and expected artifacts | Offline, deterministic, redacted, and semantically asserted                      |
| `product/plans/oss-v1/`           | Task DAG, state, acceptance, evidence, and generated progress                       | Change through the plan workflow; never edit generated progress directly         |
| `.agents/skills/`                 | Vetryn-specific reusable agent workflows                                            | Add only through the skill maturity and activation policy below                  |
| `.factory/`                       | Portable Factory adapter and policy summary                                         | Keep Factory optional and external to the product                                |
| `.factoryd/`                      | Transient Factory execution state                                                   | Ignored; never a source of repository truth                                      |
| `.github/`                        | CI, security, contribution, and later composite Action workflows                    | Preserve least privilege and pin third-party Actions                             |

Packages are staged. A planned directory is not permission to create an empty abstraction before its milestone
or compiled task authorizes it.

## Starting any task

1. Read `AGENTS.md`, `WORKFLOW.md`, the product contract, and relevant ADRs.
2. Run `pnpm plan:check` and `pnpm --silent task:next`.
3. Select one legal task and run `pnpm --silent task:compile -- TASK-ID`.
4. Treat the packet's paths, capabilities, invariants, gates, and stop conditions as hard boundaries.
5. Route the work through the applicable skill below.

If no legal task covers the requested work, do not borrow scope from a future task. Propose a narrow plan or
process change for maintainer review.

## Current skill routing

| Situation                                                                          | Skill                                    | Authority boundary                                                                   |
| ---------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| Implement one ready or in-progress compiled task                                   | `vetryn-implement-task`                  | May change only packet-authorized implementation paths; cannot accept its work       |
| Verify an exact candidate commit                                                   | `vetryn-verify-task`                     | Recommended independent check; cannot repair or promote the candidate                |
| Promote locally validated work                                                     | `vetryn-promote-task`                    | Maintainer-controlled canonical state, ledger, evidence, and generated progress only |
| Build or review the V1-02 offline golden repository                                | `vetryn-golden-scenario`                 | Offline synthetic fixtures and semantic assertions only; cannot accept or merge      |
| Execute, validate, review, commit, push, or release through generic infrastructure | The corresponding external Factory skill | Factory supplies delivery automation; active command gates remain required           |

An agent must not use a skill name as authority for an action the compiled packet, repository policy, or human
authorization does not permit.

## Planned domain and operations skills

A planned skill is a lifecycle marker, not an installed capability. Create it only when its activation condition
and prerequisites are satisfied.

| Planned skill or operation          | Activation condition                                                                                                           | Required boundary                                                                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vetryn-trust-review`               | Immediately before `V1-06` evaluation work begins; reuse through recommendation and patch work                                 | Independently review evidence sufficiency, contradictory outcomes, abstention, privacy, bounded execution, recommendation eligibility, and patch safety; never implement or self-approve the candidate |
| `vetryn-field-eval`                 | After `V1-09` is accepted and the complete offline scenario and pack gates are dependable on `main`, before `V1-10` field work | Require explicit customer consent, credentials, provider and GitHub authority, spend and timeout budgets, redaction, attribution, and stop-on-regression behavior                                      |
| Factory `cut-release`               | After offline evidence is dependable and npm publication has an approved release task and package preflight                    | Reuse Factory's release automation; Vetryn supplies repository-specific version, changelog, pack, provenance, and post-publish checks rather than cloning the skill                                    |
| Design-partner field-gate reporting | When an authorized `V1-10` engagement begins                                                                                   | Start with a versioned, compact, redacted report schema and template; count only qualified evidence-backed recommendations                                                                             |

The future `vetryn-trust-review` **skill** standardizes a semantic review once evaluation behavior exists. During
the OSS V1 single-maintainer mode, it is advisory; the absence of the skill never blocks a command-validated task.

The current `V1-06` and `V1-10` product packets do not authorize `.agents/**`. When one of these skill
triggers is reached, create or approve a narrow process task that permits the skill path before starting the
domain task. Do not smuggle process infrastructure into product scope.

Design-partner reporting should remain an output of `vetryn-field-eval` until repeated use demonstrates a
separate owner, approval flow, or transformation. Only then consider a dedicated `vetryn-field-report` skill.

## Skill maturity policy

Create a new Vetryn skill only when all of the following are true:

- its activation condition is observable from canonical task state or an explicit authorized operation;
- it has a distinct, stable workflow or trust boundary that existing skills cannot express clearly;
- its inputs, outputs, non-goals, permissions, and stop conditions can be stated precisely;
- deterministic validation or a well-defined independent review can prove that it behaves as intended;
- it avoids duplicating a Factory or platform skill; and
- a compiled task explicitly permits every file the skill creation changes.

When the conditions are met, the agent should:

1. propose a narrow skill task with its trigger, non-trigger, authority, artifacts, tests, and owner;
2. use Codex's `skill-creator` workflow when it is available;
3. keep the skill focused and link to existing repository contracts instead of copying them;
4. test positive, negative, stale-input, and authority-boundary behavior where applicable; and
5. send the exact candidate through an independent check when available and the active command gates before
   maintainer-controlled delivery.

Do not create a skill merely because a workflow may be useful later, a single prompt is lengthy, or a task is
difficult. Repeated but low-risk prose belongs in documentation; deterministic enforcement belongs in scripts,
schemas, CI, or hooks.

## Agent guidance placement

| Guidance type                                           | Location                                                |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Durable repository-wide invariants and routing          | Root `AGENTS.md`                                        |
| Detailed repository navigation and skill lifecycle      | This document                                           |
| Exact execution, evidence, review, and merge procedure  | `WORKFLOW.md`                                           |
| Reusable bounded workflow                               | `.agents/skills/<name>/SKILL.md`                        |
| Mechanically enforceable invariant                      | Schema, script, test, CI, or hook                       |
| Machine-specific preference or transient execution note | User-level Codex configuration or ignored runtime state |

Add a committed nested `AGENTS.md` only when a subtree has durable rules that genuinely differ from or refine
the root guidance. Keep it short, link back to the authoritative contracts, and never use it to broaden plan
scope. Ignored agent files may hold personal notes, but they are non-authoritative and the repository must remain
safe and understandable without them.
