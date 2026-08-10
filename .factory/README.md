# Vetryn Factory adapter

Vetryn uses a lean repo-native planning model under `product/plans/`. This directory records the
optional Factory adoption posture without making Factory a product dependency.

- Factory is not a Git submodule.
- Factoryd runtime state belongs in ignored `.factoryd/`.
- Repo-native task compilation is enabled; remote shipping, network, credentials, provider access, merge
  authority, and autoship still require the canonical external Factory profile plus explicit human authority.
- Factoryd's currently proven bootstrap template is Go CLI-specific. Vetryn will not claim runtime
  readiness until a real TypeScript-compatible adapter validates `doctor` and dry-run behavior.
- At adoption time, use a pinned Factory/Factoryd release or bundled commit plus an explicit local
  development override such as `FACTORY_REPO`; do not serialize a machine-local path here.

Committed task-run evidence must be compact and redacted. Raw logs, claims, prompts, worktrees, grants,
and credentials are transient runtime state.

Use `pnpm --silent task:next` and `pnpm --silent task:compile -- TASK-ID` as the stable adapter surface. The canonical Factory
specialization lives in Factory's `profiles/vetryn.yaml`; this local file remains a portable summary and does
not make Factory a Vetryn runtime dependency.
