# Roadmap

The roadmap is outcome-based. Dates will follow validated design-partner needs rather than precede them.

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

## 3. Evidence and decision

- [ ] OpenRouter catalog adapter
- [ ] Compatibility and policy filtering
- [ ] Bounded candidate runner
- [ ] Deterministic schema, classification, and tool-call scorers
- [ ] Constrained recommender with calibrated abstention
- [ ] JSON and Markdown evidence reports

## 4. Safe change loop

- [ ] Verified one-literal patcher
- [ ] Local reproduction workflow
- [ ] GitHub Action with explicit assessment and mutation modes
- [ ] One idempotent draft migration PR

## Post-V1 candidates

These require evidence of repeated merged migrations before commitment:

- additional SDK and language adapters;
- trace and existing-eval imports;
- release, repricing, and retirement triggers;
- cross-repository policy and evidence history; and
- gateway-neutral canary integrations.

Runtime routing, autonomous merges, and a generic eval playground are not planned V1 features.
