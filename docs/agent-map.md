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
| How do coding agents install and invoke Vetryn?            | Root `llms.txt` and onboarding docs after V1-09           |

`ROADMAP.md` is a human summary. Chat history, ignored files, local prompts, and generated progress never grant
task scope, capabilities, acceptance, review, or merge authority. Neither do consumer-facing `llms.txt` or agent
onboarding docs: those surfaces explain how to invoke Vetryn but cannot override repository policy or reviewed
delivery truth.

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
| `.factory/`                       | Portable Factory adapter, policy, and task-bound semantic-risk evidence             | Keep Factory optional and external to the product; write only packet targets     |
| `.factoryd/`                      | Transient Factory execution state                                                   | Ignored; never a source of repository truth                                      |
| `.github/`                        | CI, security, contribution, and later composite Action workflows                    | Preserve least privilege and pin third-party Actions                             |

Packages are staged. A planned directory is not permission to create an empty abstraction before its milestone
or compiled task authorizes it.

## Starting any task

1. Read `AGENTS.md`, `WORKFLOW.md`, the product contract, and relevant ADRs.
2. Run `pnpm plan:check` and `pnpm --silent task:next`.
3. Select one legal task and run `pnpm --silent task:compile -- TASK-ID`.
4. Treat the packet's paths, capabilities, invariants, gates, and stop conditions as hard boundaries.
5. For medium- or high-risk work, author the ignored semantic-risk draft and run
   `pnpm --silent semantic-risk:design -- TASK-ID` from a clean candidate snapshot. Prefer doing this before
   product edits; never interpret the repository-owned integrity marker as independent authority or chronology.
6. Route the work through the applicable skill below.

If no legal task covers the requested work, do not borrow scope from a future task. Propose a narrow plan or
process change for maintainer review. A planning or product-contract amendment remains a proposal until it is
reviewed and merged to `main`; resync and compile downstream implementation from that canonical state.

## Current skill routing

| Situation                                                                          | Skill                                     | Authority boundary                                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Implement one ready or in-progress compiled task                                   | `vetryn-implement-task`                   | Produces one exact ProductCandidate; cannot accept its work                                                 |
| Verify an exact ProductCandidate                                                   | `vetryn-verify-task`                      | Recommended independent check; cannot repair or promote the candidate                                       |
| Promote locally validated work                                                     | `vetryn-promote-task`                     | Produces one canonical promotion-only DeliveryHead; cannot change product bytes                             |
| Build or review the V1-02 offline golden repository                                | `vetryn-golden-scenario`                  | Offline synthetic fixtures and semantic assertions only; cannot accept or merge                             |
| Review V1-06+ evaluation, recommendation, or patch trust semantics                 | `vetryn-trust-review`                     | Candidate-bound adversarial review only; cannot implement, promote, or merge                                |
| Continue the sole active or next-legal task without a supplied task ID             | `vetryn-continue-next`                    | Routes through protected merge, post-merge verification, and next-task reporting when explicitly authorized |
| Execute, validate, review, commit, push, or release through generic infrastructure | The corresponding installed Factory skill | Factory is a trusted local development tool; packet gates and current authority apply                       |

An agent must not use a skill name as authority for an action the compiled packet, repository policy, or human
authorization does not permit.

## Planned domain and operations skills

A planned skill is a lifecycle marker, not an installed capability. Create it only when its activation condition
and prerequisites are satisfied.

| Planned skill or operation          | Activation condition                                                                                                           | Required boundary                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vetryn-field-eval`                 | After `V1-09` is accepted and the complete offline scenario and pack gates are dependable on `main`, before `V1-10` field work | Require explicit customer consent, credentials, provider and GitHub authority, spend and timeout budgets, redaction, attribution, and stop-on-regression behavior   |
| Factory `cut-release`               | After offline evidence is dependable and npm publication has an approved release task and package preflight                    | Reuse Factory's release automation; Vetryn supplies repository-specific version, changelog, pack, provenance, and post-publish checks rather than cloning the skill |
| Design-partner field-gate reporting | When an authorized `V1-10` engagement begins                                                                                   | Start with a versioned, compact, redacted report schema and template; count only qualified evidence-backed recommendations                                          |

`vetryn-trust-review` was activated by `M0-06` before V1-06. Use it whenever a compiled packet declares
`QG-TRUST-REVIEW`; named reviewer records remain advisory under ADR 0009, while the packet's semantic and command
gates remain required. The skill cannot implement findings or supply acceptance.

The current `V1-10` product packet does not authorize `.agents/**`. When the field-skill trigger is reached,
create or approve a narrow process task that permits the skill path before starting field work. Do not smuggle
process infrastructure into product scope.

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
| Consumer coding-agent install and invocation guidance   | Root `llms.txt` and Markdown docs                       |
| Machine-specific preference or transient execution note | User-level Codex configuration or ignored runtime state |

Add a committed nested `AGENTS.md` only when a subtree has durable rules that genuinely differ from or refine
the root guidance. Keep it short, link back to the authoritative contracts, and never use it to broaden plan
scope. Ignored agent files may hold personal notes, but they are non-authoritative and the repository must remain
safe and understandable without them.
