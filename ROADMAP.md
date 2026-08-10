# Roadmap

The roadmap is outcome-based. Dates will follow validated design-partner needs rather than precede them.
Machine-tracked task and acceptance state lives in [`product/plans/oss-v1/`](product/plans/oss-v1/README.md);
these checkboxes are a human summary, not execution truth.

## 0. Repository foundation

- [x] Apache-2.0 project foundation
- [x] Community health and governance files
- [x] Strict TypeScript workspace and package contracts
- [x] CI, CodeQL, dependency review, Scorecard, and Dependabot
- [x] Initial domain-schema and CLI foundations

## 1. Golden example and evidence format

- [ ] Versioned call-site manifest schema
- [ ] JSONL eval fixture schema
- [ ] Immutable candidate-run and recommendation artifact schemas
- [ ] Local mock OpenRouter service
- [ ] End-to-end support-classification fixture repository

## 2. Inventory

- [ ] TypeScript scanner for direct `openai` SDK calls
- [ ] Stable human-reviewed call-site bindings
- [ ] Discovery confidence and patchability explanations
- [ ] Source and structural fingerprints
- [ ] At least 95% high-confidence precision and 80% supported-pattern recall

## 3. Evidence and decision

- [ ] OpenRouter catalog adapter
- [ ] Compatibility and policy filtering
- [ ] Deterministic cost-first candidate shortlist with a default and maximum size of five
- [ ] Immutable, idempotent catalog refresh with explicit stale/failure semantics
- [ ] Bounded candidate runner
- [ ] Deterministic schema, classification, and tool-call scorers
- [ ] Constrained recommender with calibrated abstention
- [ ] JSON and Markdown evidence reports

## 4. Safe change loop

- [ ] Verified one-literal patcher
- [ ] Local reproduction workflow
- [ ] GitHub Action with explicit assessment and mutation modes
- [ ] Manual-by-default assessment with an opt-in schedule and unchanged-input spend guard
- [ ] One idempotent draft migration PR

## V1 field gate

- [ ] Ten qualified recommendation PRs across at least three companies
- [ ] At least a 40% qualified-PR merge rate
- [ ] Zero serious escaped regressions
- [ ] Sanitized field determination: blocked sites, representative no-findings, or insufficient coverage

## Post-V1 candidates

These require evidence of repeated merged migrations before commitment:

- additional SDK and language adapters;
- trace and existing-eval imports;
- an optional calibrated semantic-rubric scorer, only if V1 field evidence shows deterministic
  evaluation blocks valuable open-ended call sites;
- release, repricing, and retirement triggers;
- cross-repository policy and evidence history; and
- gateway-neutral canary integrations.

Runtime routing, autonomous merges, and a generic eval playground are not planned V1 features.
