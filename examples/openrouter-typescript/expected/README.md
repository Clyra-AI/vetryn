# Expected artifacts

Implementation tasks will add reviewed JSON and Markdown snapshots here. A golden run must be fully
offline and deterministic: source fixtures, the model catalog, provider responses, eval cases, and the
clock are pinned. Snapshots are evidence, not the sole assertion mechanism.

No expected recommendation is checked in yet because the scanner, catalog adapter, and evaluator do
not exist. Creating plausible-looking output before those contracts are implemented would hide drift.
