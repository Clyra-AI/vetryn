# OSS V1 execution plan

The OSS V1 plan tracks implementation from the current repository foundation to one evidence-backed,
verified model-upgrade draft PR.

- [`plan.json`](plan.json) contains the task DAG, scopes, invariants, gates, and advisory review requirements.
- [`acceptance-ledger.json`](acceptance-ledger.json) contains item-level definitions of done.
- [`state/`](state/) contains one mutable state document per task.
- [`evidence/`](evidence/) contains compact, immutable evidence records.
- [`progress.json`](progress.json) is a generated roll-up and must not be edited manually.

Task state advances only when evidence applies to the exact candidate commit and active command gates pass. Field
evidence from real repositories remains a separate product-validation gate and must not be replaced by synthetic
CI results or agent assertions. Named reviewer records are advisory during ADR-0009 single-maintainer V1 delivery.

`pnpm --silent task:compile -- TASK-ID` emits both Vetryn's canonical task/state/gate view and the explicit
runner-ready fields required by Factory's `task-executor`. Worker-owned evidence is separated from CI, review,
shipping, scope-closure, and post-merge lifecycle evidence; executor acceptance results never update this ledger
or generated progress. Generic Factory workers and repository-specific domain reviews are separate packet fields;
an active `QG-TRUST-REVIEW` requires the `vetryn-trust-review` step and its candidate-bound report.
