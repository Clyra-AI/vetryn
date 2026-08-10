# ADR 0001: Repository foundation

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

Vetryn needs a credible open-source foundation before implementing scanners or model-provider behavior.
The first supported workflow is TypeScript/Node.js and must evolve without coupling provider side
effects to core decision contracts.

## Decision

Use a pnpm TypeScript monorepo on Node.js 22 or newer. Keep provider-neutral Zod schemas in
`@vetryn/core` and the command-line entry point in `vetryn`. Publish under Apache-2.0, use Changesets for
version intent, and enforce formatting, linting, dead-code analysis, type checking, tests, builds, and
package dry-runs in CI.

Automated dependencies and security analysis use pinned GitHub Actions. Releases are deferred until the
npm namespace and trusted publishing are configured; initial automation must not hold npm tokens.

## Consequences

- A narrow package boundary limits premature abstraction while preserving an inward dependency rule.
- Node.js 22 provides a current LTS-class baseline but excludes older runtimes.
- Apache-2.0 supports broad adoption and includes an explicit patent grant.
- Strict checks add contributor friction, offset by documented one-command validation.
- No release workflow exists until maintainers can configure provenance-backed trusted publishing.
