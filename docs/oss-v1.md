# OSS V1 product specification

## Outcome

Vetryn's first complete outcome is:

> Connect a TypeScript repository and receive a tested draft pull request that reduces model cost
> without violating the repository's quality threshold.

The PR, not a dashboard or routing decision, is the product artifact. It must contain enough evidence
for an engineer to understand, reproduce, and safely reject or accept the change.

This document is the human-readable product contract for OSS V1. The reviewed execution plan and
item-level acceptance criteria live under [`product/plans/oss-v1/`](../product/plans/oss-v1/README.md).

## Beachhead ICP

The initial user is an AI-native software team that:

- has 10–100 stable LLM call sites in a TypeScript repository;
- spends at least $10,000 per month across externally hosted models;
- uses OpenAI's SDK through OpenRouter with statically pinned model IDs;
- already has fixtures, traces, or tests that can seed representative evals; and
- owns model selection inside an application engineering or AI platform team.

Teams with one or two prompts have too little recurring pain. Frontier-model training companies and
organizations requiring dynamic runtime routing are outside the beachhead.

## Personas and jobs to be done

| Persona                       | Job to be done                                                              | Evidence of success                                  |
| ----------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| Staff AI/application engineer | Keep many model pins current without manually re-benchmarking every release | A trustworthy, reviewable upgrade PR                 |
| AI platform lead              | Standardize how model migrations are evaluated across repositories          | Versioned manifests, gates, and reproducible reports |
| Engineering manager           | Reduce inference cost without creating regression incidents                 | Verified savings and no violated quality gate        |
| Security or privacy reviewer  | Know which data leaves the repository and which provider executes it        | Local/BYOK execution and explicit provider policy    |

## Supported golden path

V1 supports:

1. TypeScript on Node.js 22 or newer;
2. the `openai` SDK configured for OpenRouter;
3. direct model string literals that can be unambiguously bound to a source location;
4. text generation, structured JSON, and simple tool-call workloads;
5. checked-in JSONL eval cases reviewed by a human;
6. deterministic assertions; LLM-as-judge scoring is deferred beyond V1;
7. hard quality, latency, cost, context, and privacy gates;
8. local runs and GitHub Actions using repository secrets; and
9. one-model-literal draft PRs that never auto-merge.

Unsupported or ambiguous calls are reported as such. Vetryn must not rewrite a call site it cannot bind
confidently.

## Required product loop

1. `vetryn scan` discovers supported calls, source fingerprints, and proposed manifest bindings.
2. A developer confirms ownership, fixture location, and evaluation gates.
3. `vetryn eval` resolves a reproducible candidate set and runs the suite (`evaluate` may remain an
   alias, but artifacts and documentation use `eval`).
4. Vetryn abstains unless the candidate passes every hard gate and clears a confidence floor.
5. `vetryn recommend` creates a machine-readable and Markdown evidence report.
6. The GitHub workflow opens or updates a draft PR changing one verified model literal.

## PR evidence contract

Every recommendation PR must show:

- call-site ID and source binding;
- current and proposed canonical model IDs;
- catalog snapshot and pricing timestamp;
- fixture revision, evaluator version, seed, attempts, and sample count;
- quality, cost, latency, error, and variance deltas;
- failed or regressed cases with redaction controls;
- all configured gates and their outcomes;
- confidence and explicit limitations; and
- exact commands required to reproduce the result.

## Non-goals

OSS V1 is not a gateway, production proxy, dynamic router, prompt-management system, synthetic eval
generator, autonomous deployer, rollout manager, LLM-judge framework, or multi-language fleet
dashboard.

## Milestones

| Milestone            | Deliverable                                             | Exit condition                               |
| -------------------- | ------------------------------------------------------- | -------------------------------------------- |
| M0: foundation       | Schemas, CLI shell, governance, CI, security posture    | Reproducible green checks on `main`          |
| M1: contracts        | Domain artifacts, golden fixture, offline mock provider | Deterministic scenario suite                 |
| M2: inventory        | TypeScript/OpenAI scanner and manifest writer           | High precision on a public fixture corpus    |
| M3: evidence         | OpenRouter adapter, eval runner, gates, reports         | Reproducible current-vs-candidate decision   |
| M4: safe change loop | Verified patcher, GitHub Action, draft-PR lifecycle     | End-to-end golden-path demo in a sample repo |

## Validation targets

Before calling V1 dependable, the project should demonstrate:

- at least 95% precision for high-confidence supported call-site discovery;
- at least 80% recall within the explicitly supported syntax corpus;
- zero source rewrites outside the bound model literal in the fixture corpus;
- deterministic replay for deterministic scorers and stable semantic artifact digests;
- a clear `insufficient-evidence` outcome for undersized or contradictory suites;
- less than 30 minutes from installation to the first local comparison on the golden path.

Engineering completion and field validation are separate gates. Before expanding beyond V1, require at
least ten qualified recommendation PRs across three companies, at least a 40% merge rate, and zero
serious escaped regressions. Twenty safe rollouts remain a later confidence milestone rather than a
deterministic build gate.

## Locked implementation decisions

- Stable semantic call-site identity belongs to the human-reviewed manifest. Scanner output owns a
  structural discovery fingerprint, confidence, and patchability reason.
- JSON and Markdown are the required evidence formats. SARIF is deferred until a concrete code-scanning
  use is specified.
- New packages are extracted only when their milestone begins; empty placeholder packages are not
  created.
- `Rollout`, optional judges, Python, hosted execution, and production canaries are outside OSS V1.
- Unknown compatibility, insufficient evidence, ambiguous binding, stale source, or failed hard gates
  always produce a report without a patch.
