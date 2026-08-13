# Contributing to Vetryn

Thank you for helping build trustworthy AI model dependency maintenance.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search existing issues and discussions before opening a new one.
- For substantial behavior or architecture changes, open a proposal issue before writing code.
- Never include customer prompts, credentials, production traces, or other sensitive data in an issue or
  pull request.

## Development setup

Prerequisites:

- Node.js 22 or newer
- pnpm 10.23.0, as declared by the root `packageManager` field

Install and validate the repository:

```sh
corepack enable
pnpm install
pnpm check
```

Useful commands:

| Command              | Purpose                                      |
| -------------------- | -------------------------------------------- |
| `pnpm build`         | Build every workspace package                |
| `pnpm format`        | Format supported files                       |
| `pnpm lint`          | Run ESLint                                   |
| `pnpm lint:deadcode` | Find unused files, exports, and dependencies |
| `pnpm typecheck`     | Run strict TypeScript checks                 |
| `pnpm test`          | Run the test suite                           |
| `pnpm test:coverage` | Generate local coverage output               |
| `pnpm check`         | Run the complete merge gate                  |

Maintainers continuing canonical plan work without a supplied task ID can explicitly invoke
`$vetryn-continue-next`. Its offline preflight is read-only and never substitutes for a current task-scoped grant.

## Contribution workflow

1. Fork the repository and create a focused branch.
2. Add or update tests for changed behavior.
3. Update documentation when a public contract changes.
4. Run `pnpm check` locally.
5. Add a changeset with `pnpm changeset` for user-visible package changes.
6. Open a pull request using the template.

Pull requests should be small enough to review and should explain the problem before the implementation.
Maintainers may ask for an issue or architecture decision record when a change affects public formats,
security boundaries, provider behavior, or the recommendation policy.

## Commit and pull request titles

Use a short imperative description. Conventional Commit prefixes are encouraged:

- `feat:` new user-visible behavior
- `fix:` defect correction
- `docs:` documentation only
- `test:` tests only
- `refactor:` behavior-preserving internal change
- `chore:` tooling or maintenance

## Tests and fixtures

- Tests must be deterministic and must not call paid external APIs.
- Provider integrations should use local mock servers or recorded, sanitized protocol fixtures.
- Eval examples must be synthetic or explicitly approved for public distribution.
- Security-sensitive changes need negative tests and clear failure behavior.
- A recommendation path must test abstention as well as success.

## Dependency policy

Prefer small, maintained dependencies with licenses compatible with Apache-2.0. New runtime dependencies
need a clear justification in the pull request. GitHub dependency review blocks moderate-or-higher known
vulnerabilities and explicitly incompatible licenses.

## Documentation

Public interfaces, file formats, policy semantics, and architectural decisions belong in `docs/`.
Architecture decisions use the template in [`docs/adr/README.md`](docs/adr/README.md).

## Review and merge

During OSS V1 maintainer-led delivery, passing required checks and explicit approval from an active maintainer in
[`MAINTAINERS.md`](MAINTAINERS.md) are required; either listed maintainer may authorize a bounded run and merge a
green pull request. `CODEOWNERS` and named review roles remain advisory. Maintainers normally squash-merge pull
requests. Vetryn does not accept changes that weaken privacy, evidence provenance, or calibrated abstention for
convenience. See [`ADR 0009`](docs/adr/0009-single-maintainer-v1-delivery.md).
