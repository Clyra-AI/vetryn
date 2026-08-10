# ADR 0002: Lock OSS V1 scope and execution vocabulary

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

The detailed OSS V1 blueprint and the initial repository foundation disagreed on scanner targets, CLI
vocabulary, report formats, package timing, judge support, rollout state, and field-validation thresholds.
Leaving these choices implicit would allow implementation agents to resolve product scope accidentally.

## Decision

- Use `vetryn eval` as the canonical evaluation command; `evaluate` may be a compatibility alias.
- Require at least 95% precision for high-confidence supported discovery and 80% recall within the
  declared supported-pattern corpus.
- Require JSON and Markdown evidence reports. SARIF is not a V1 commitment.
- Limit V1 to deterministic scorers. Optional judges are deferred.
- Keep rollout state and production canary behavior outside V1.
- Assign stable call-site identity in the human-reviewed manifest; scanners emit fingerprints and
  syntactic evidence.
- Extract TypeScript and OpenRouter packages only when their implementation milestones start.
- Use ten qualified PRs across three companies, 40% merge rate, and zero serious regressions as the
  expansion gate. This field evidence is separate from deterministic engineering completion.

## Consequences

- Recommendation and patching behavior can be tested without subjective judge dependencies.
- The required PR surface remains portable JSON and readable Markdown.
- Scanner acceptance has an explicit denominator and measurable precision/recall targets.
- Product tasks cannot introduce rollout, Python, hosted, SARIF, or judge scope without a new decision.
- Package boundaries remain earned by implementation rather than pre-created as empty structure.
