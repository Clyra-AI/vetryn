# Vetryn

[![CI](https://github.com/Clyra-AI/vetryn/actions/workflows/ci.yml/badge.svg)](https://github.com/Clyra-AI/vetryn/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Clyra-AI/vetryn/actions/workflows/codeql.yml/badge.svg)](https://github.com/Clyra-AI/vetryn/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Clyra-AI/vetryn/badge)](https://scorecard.dev/viewer/?uri=github.com/Clyra-AI/vetryn)
[![License](https://img.shields.io/github/license/Clyra-AI/vetryn)](LICENSE)

**Dependabot for AI model dependencies.**

Vetryn discovers statically pinned model call sites, evaluates compatible candidates against
repository-owned evidence, and prepares a minimal model-upgrade pull request only when every configured
quality gate passes.

> [!WARNING]
> Vetryn is pre-alpha. The repository foundation and public interfaces are under active development. Do
> not use it to automate production model migrations yet.

## Product contract

Given a supported, statically identifiable LLM call site with a representative eval suite, Vetryn will:

1. resolve the current model from source;
2. shortlist compatible candidate models;
3. compare quality, cost, latency, errors, and variance;
4. return `insufficient-evidence` when a safe decision cannot be supported;
5. patch only a verified model literal; and
6. produce a reproducible draft pull request with the evidence.

Vetryn is not a runtime router, inference gateway, prompt IDE, or autonomous deployment system.

## Planned OSS V1

The first supported path is deliberately narrow:

- TypeScript and Node.js;
- the `openai` SDK configured for OpenRouter;
- direct, statically pinned model literals;
- text, JSON, and simple tool-call workloads;
- checked-in, human-reviewed JSONL eval fixtures; and
- local execution plus GitHub Actions using customer-provided model credentials.

See the [OSS V1 product specification](docs/oss-v1.md), [architecture](docs/architecture.md), and
[roadmap](ROADMAP.md).

## Repository status

The current code establishes the versioned domain-schema and CLI foundations:

```sh
pnpm install
pnpm check
pnpm --filter vetryn start doctor
```

The scanner, OpenRouter adapter, evaluator, patcher, and GitHub Action will land behind explicit
milestones. We prefer a small honest surface over placeholder functionality.

## Design principles

- **Trust before automation:** abstaining is better than proposing an unsupported migration.
- **Repository-owned evidence:** source, manifests, fixtures, and policies remain reviewable.
- **Provider neutrality:** integrations may execute through providers, but recommendations are not paid
  placement.
- **Outside the inference path:** Vetryn does not need to proxy production traffic.
- **Minimal diffs:** V1 changes one verified model literal and never auto-merges.
- **Local-first privacy:** customer prompts, outputs, and credentials stay in the configured execution
  environment by default.

## Contributing

We welcome focused issues, design discussions, documentation improvements, and code contributions. Read
[`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and
[`GOVERNANCE.md`](GOVERNANCE.md) before participating.

Please report security issues privately according to [`SECURITY.md`](SECURITY.md).

## License

Copyright 2026 Clyra AI.

Licensed under the [Apache License 2.0](LICENSE).
