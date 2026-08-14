# Vetryn pre-push review patterns

Apply only the rows relevant to the changed surface. One adversarial regression may cover several rows. This is a
review prompt, not permission to broaden packet scope or build speculative infrastructure.

| Changed surface            | Ask before freezing the ProductCandidate                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Producer and consumer      | Do both sides derive the same gate, identity, count, capability, and decimal boundary from the same inputs?                                               |
| Evidence and freshness     | Is every actionable claim bound to the exact source, candidate, policy, lineage, clock, and latest terminal event rather than a producer label?           |
| External effects           | Are authorization, compatibility, privacy, path separation, budgets, and size limits checked before the first call, write, or irreversible state advance? |
| Syntax or object discovery | Can a later spread, computed key, accessor, alias, reassignment, wrapper, or mutation override the value being reported or patched?                       |
| Filesystem boundary        | Can a symlinked parent, canonical-path alias, replacement directory, ignored dependency, or path swap cross the intended trust boundary?                  |
| Multi-file persistence     | What happens after each possible crash point? Can recovery distinguish prior, pending, committed, forked, and rolled-back states without data loss?       |
| Concurrency and retries    | Are budgets reserved before dispatch, results reduced in stable order, collisions locked, and retries idempotent?                                         |
| Economics and statistics   | Are decimal comparisons exact, minimum sample counts enforced, repeated-attempt variance measured, and estimate/observed/billed values kept distinct?     |
| Untrusted input            | Are reads bounded before allocation, raw privacy-sensitive lexemes checked before lossy parsing, and persisted artifacts redacted?                        |
| Public package surface     | Does a clean build include workspace dependencies, public behavior have a Changeset, and docs match the actual invocation?                                |

Stop after the relevant matrix is covered and active gates pass. A new standalone P2 after one completed repair
generation is a maintainer delivery decision under ADR 0009, not an automatic invitation to reopen the implementation.
