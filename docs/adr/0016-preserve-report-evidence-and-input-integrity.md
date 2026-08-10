# ADR 0016: Preserve recommendation-report evidence and reject ambiguous inputs

## Context

The human-readable recommendation report must be derived from durable machine-readable evidence. The core
recommendation artifact previously had no fields for its required limitations or exact reproduction commands.
Recommendation validation also accepted duplicate candidate-run IDs, and repository-path validation accepted
Windows drive-qualified values.

## Decision

- Recommendations require finite limitation codes and one or more single-line redacted reproduction commands.
- Candidate-run evidence inputs reject duplicate artifact IDs before any recommendation lookup.
- Repository paths reject Windows drive prefixes in addition to POSIX roots, backslashes, nulls, and traversal.

## Consequences

The JSON recommendation can be the source of a Markdown report without inventing caveats or commands. Durable
evidence is order-independent and unambiguous. Consumers can resolve parsed paths only within the repository
across supported operating systems.
