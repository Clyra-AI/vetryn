# OSS V1 execution plan

The OSS V1 plan tracks implementation from the current repository foundation to one evidence-backed,
verified model-upgrade draft PR.

- [`plan.json`](plan.json) contains the task DAG, scopes, invariants, gates, and review requirements.
- [`acceptance-ledger.json`](acceptance-ledger.json) contains item-level definitions of done.
- [`state/`](state/) contains one mutable state document per task.
- [`evidence/`](evidence/) contains compact, immutable evidence records.
- [`progress.json`](progress.json) is a generated roll-up and must not be edited manually.

Task state advances only when evidence applies to the exact candidate commit. Field evidence from real
repositories remains a separate product-validation gate and must not be replaced by synthetic CI
results or agent assertions.
