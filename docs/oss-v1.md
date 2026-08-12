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
| Security or privacy reviewer  | Know which data leaves the repository and which route actually executes it  | Local/BYOK execution and explicit route evidence     |

## Supported golden path

V1 supports:

1. TypeScript on Node.js 22 or newer;
2. the `openai` SDK configured for OpenRouter;
3. direct model string literals that can be unambiguously bound to a source location;
4. text generation, structured JSON, and simple tool-call workloads;
5. checked-in JSONL eval cases reviewed by a human;
6. deterministic assertions; LLM-as-judge scoring is deferred beyond V1;
7. a deterministic, compatibility-filtered OpenRouter shortlist of at most five candidates by default,
   configurable only to a lower bound;
8. hard quality, latency, cost, context, and privacy gates;
9. local runs and GitHub Actions using repository secrets; and
10. one-model-literal draft PRs that never auto-merge.

Unsupported or ambiguous calls are reported as such. Vetryn must not rewrite a call site it cannot bind
confidently.

## Required product loop

1. `vetryn scan` discovers supported calls, source fingerprints, and proposed manifest bindings.
2. A developer confirms ownership, fixture location, and evaluation gates.
3. `vetryn eval` resolves a reproducible, budget-bounded candidate set and runs the suite (`evaluate`
   may remain an alias, but artifacts and documentation use `eval`).
4. Vetryn abstains unless the candidate passes every hard gate and clears a confidence floor.
5. `vetryn recommend` creates a machine-readable and Markdown evidence report.
6. The GitHub workflow opens or updates a draft PR changing one verified model literal.

After a repository has a reviewed manifest and eval suite, one documented `vetryn assess` command orchestrates
evaluation, recommendation, reporting, and verified patch preparation. The composite GitHub Action invokes the same
path and may open the draft PR only in an explicit GitHub-enabled mode with the required permissions. The individual
commands remain available for inspection and replay.

## PR evidence contract

Every recommendation PR must show:

- call-site ID and source binding;
- current and proposed canonical model IDs;
- catalog snapshot, pricing timestamp, and model author namespace;
- requested OpenRouter route policy and the redacted router attempts that identify the selected execution provider;
- fixture revision, evaluator version, seed, attempts, and sample count;
- quality, cost, latency, error, and variance deltas;
- failed or regressed cases with redaction controls;
- estimated current and proposed monthly cost, monthly and annual savings, and savings percentage when reviewed
  workload-volume evidence is policy-current; otherwise normalized unit economics and the reason a monthly claim is
  unavailable;
- the reviewed workload volume and provenance used for any projection, plus the observed evaluation cost itself;
- freshness evidence comprising the source fingerprint, catalog/pricing observation time, fixture digest or
  revision, evaluator version and build, and evaluation completion time;
- all configured gates, their outcomes, and the evidence or reason supporting each outcome;
- confidence and explicit limitations;
- exact commands required to reproduce the result; and
- a next-assessment section derived from reconciled repository counts, with an exact action when another eligible
  target exists and an explicit none-available result otherwise, without implying complete runtime inventory.

Every abstention report carries the applicable provenance, economics, freshness, gate outcomes, and limitations
from the same contract, plus a finite reason for abstention and no patch plan.

## Domain artifact contract

V1 durable JSON uses strict, versioned artifacts with a deterministic ID and canonical serialization. The core
stores references, digests, aggregate measurements, model identifiers, and bounded diagnostic codes—not raw
prompts, model outputs, credentials, provider error bodies, or source diffs. Unknown versions and logically
incompatible states fail closed. A complete candidate run records both baseline and candidate aggregate metrics
for the same cases, explicit outcomes for the quality, cost, latency, context, and privacy hard gates, and compact
reproducibility provenance: evaluator version and build, deterministic scorer configuration digest, sampling and
seed, attempts, timestamps, and aggregate variance. Each call site has an explicit minimum recommendation
confidence (0.8 by default); the run and recommendation preserve that policy, and a recommendation cannot exceed
the candidate evidence's variance-adjusted quality lower bound, using only a representation-safe exact-boundary
comparison. Each call site also declares a strict OpenRouter execution-route policy: one reviewed provider slug,
fallbacks disabled, required-parameter enforcement enabled, data collection denied, and ZDR required. The segment
before the first slash in a canonical model ID is stored only as `modelAuthor`; it never proves which endpoint
executed a request. A complete candidate run must bind the exact route policy used for the request and compact,
redacted OpenRouter router metadata for every observed attempt with exactly one successful selected attempt.
Recommendation validation compares the run policy with the reviewed call-site policy and rejects missing,
contradictory, or unreconciled route evidence rather than trusting catalog identity or a producer privacy label.
Reason codes are finite and status-compatible. A recommendation can cite only matching, complete runs whose hard
gates all pass. The core derives quality, cost, and latency outcomes from the bound call-site policy and paired
metrics rather than trusting producer labels, and proves that a recommended model is present, active, satisfies the
call site's declared text-generation, structured-output, and tool-call requirements, and is sufficiently
context-capable in the bound catalog snapshot. Recommendation evidence also binds every cited
run to the call site's declared reviewed eval-suite artifact, that suite's call site, immutable fixture digest, and exact case count. Catalog snapshots validate their content digest against the canonical, model-ID-sorted model list, so a retained snapshot ID or digest cannot authorize altered capabilities or pricing. Abstentions still
validate the provenance of every cited run. A patch plan must exactly bind its call site, models, and source
fingerprint to its recommendation. Artifact definitions and pure validation live in `@vetryn/core`; filesystem,
provider, AST, and GitHub behavior stay outside that package.

Every recommendation also carries finite explicit limitation codes and one or more structured, allowlisted Vetryn
reproduction operations that the report renderer converts into exact commands. Candidate-run input lists reject duplicate artifact IDs; every durable repository path
rejects absolute, traversal, backslash, and Windows drive-qualified forms.

Economic projections require an optional human-reviewed workload-volume profile with a monthly request count,
provenance, and observation time or window. Vetryn derives freshness under explicit policy and combines a current
profile with the reviewed representative prompt/completion token weights and bound catalog pricing. These values
are labeled estimates rather than observed billing. Missing, invalid, or stale volume evidence permits per-request
or per-1,000-request comparisons but cannot produce a monthly or annual savings claim. Observed evaluation spend
remains a separate measurement.

The canonical recommendation and abstention remain decision artifacts. Agent-install guidance and contextual
expansion prompts are deterministic presentation-layer next actions; they cannot alter eligibility, confidence,
gate outcomes, or patch authorization.

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
- less than 30 minutes from installation to the first local comparison on the golden path; and
- one documented CLI orchestration command or composite Action invocation after the reviewed manifest and eval suite
  are configured, with stable JSON output and documented exit semantics.

Engineering completion and field validation are separate gates. Before expanding beyond V1, require at
least ten qualified recommendation PRs across three companies, at least a 40% merge rate, and zero
serious escaped regressions. Field evidence also records whether recommendation PR reviewers initiate or refer a
follow-on call-site or repository assessment, without adding mandatory telemetry. Twenty safe rollouts remain a
later confidence milestone rather than a deterministic build gate.

An optional calibrated semantic-rubric scorer may be designed only after that field work demonstrates
through separate sanitized evidence that deterministic evaluation blocks valuable open-ended call sites.
Those blocked call sites are not counted as qualified recommendations. The scorer remains supplementary
to hard gates, requires human calibration and explicit spend policy, and is not implied by V1 completion.
A representative no-findings outcome requires a predeclared eligibility census and direct assessment of
at least ten eligible open-ended call sites across at least three FIELD-001 companies. Representative
no-findings or explicit insufficient coverage satisfies the V1 field record but does not authorize scorer
design.

## Locked implementation decisions

- Stable semantic call-site identity belongs to the human-reviewed manifest. Scanner output owns a
  structural discovery fingerprint, confidence, and patchability reason.
- JSON and Markdown are the required evidence formats. SARIF is deferred until a concrete code-scanning
  use is specified.
- Monthly and annual economic claims require reviewed workload-volume provenance whose observation time or window
  remains current under explicit policy. Without it, Vetryn reports normalized unit economics and does not
  manufacture a monthly estimate.
- Root `llms.txt`, Markdown onboarding, stable JSON output, and documented exit semantics provide one
  provider-neutral installation and operation contract for coding agents. Codex- or Claude-specific pages may
  explain the same commands but cannot introduce separate product behavior.
- Recommendation PRs and abstention reports include a next-assessment section derived only from reconciled
  repository counts. It renders an exact action when an eligible target exists and explicitly reports none otherwise.
  This is presentation metadata, not recommendation evidence, and Vetryn ships no mandatory growth telemetry.
- New packages are extracted only when their milestone begins; empty placeholder packages are not
  created.
- `Rollout`, optional judges, Python, hosted execution, and production canaries are outside OSS V1.
- OpenRouter supplies the V1 catalog universe, but hard compatibility and policy filters run before a
  deterministic shortlist whose default and maximum size is five candidates. Each manifest pins a
  human-reviewed representative prompt/completion token-weight profile with provenance. Ranking computes
  exact-decimal estimated workload cost from that profile and normalized model-level catalog prices, then sorts cost
  ascending, context limit descending, and canonical model ID ascending; missing or invalid profiles fail
  closed. This is a shortlist estimate, not observed provider billing.
- OpenRouter model IDs identify model authors, not execution providers. Every evaluation request is built from the
  manifest's explicit route policy with one provider slug, fallbacks disabled, required parameters enforced, data
  collection denied, and ZDR required. A complete run requires redacted router metadata that reconciles attempts
  and identifies exactly one selected provider; absent or contradictory route evidence abstains.
- Scanner reports use an explicit supported-direct-call scope and reconcile files considered, parsed, and failed
  with patchable/non-patchable observations, confidence counts, and reason-code totals. Zero findings are not
  represented as zero AI usage.
- Provider-backed assessment is manual by default. A repository may explicitly opt into a schedule;
  unchanged normalized catalog and evaluation-input digests skip paid candidate execution only when
  prior evidence is complete, integrity-valid, and reusable under current policy.
- The evaluation-input digest binds the evaluator executable identity, including tool version and build
  or commit revision, so evaluator upgrades cannot reuse evidence produced by older code.
- Every successful catalog refresh records immutable freshness evidence even when its unchanged,
  content-addressed snapshot is reused.
- A failed live catalog refresh is reported as a failure and never relabels an older snapshot as current.
- Unknown compatibility, insufficient evidence, ambiguous binding, stale source, or failed hard gates
  always produce a report without a patch.
