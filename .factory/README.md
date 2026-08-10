# Vetryn Factory adapter

Vetryn uses a lean repo-native planning model under `product/plans/`. This directory records the
optional Factory adoption posture without making Factory a product dependency.

- Factory is not a Git submodule.
- Factoryd runtime state belongs in ignored `.factoryd/`.
- No remote shipping, network, credentials, provider access, merge authority, or autoship is enabled by
  this starter profile.
- Factoryd's currently proven bootstrap template is Go CLI-specific. Vetryn will not claim runtime
  readiness until a real TypeScript-compatible adapter validates `doctor` and dry-run behavior.
- At adoption time, use a pinned Factory/Factoryd release or bundled commit plus an explicit local
  development override such as `FACTORY_REPO`; do not serialize a machine-local path here.

Committed task-run evidence must be compact and redacted. Raw logs, claims, prompts, worktrees, grants,
and credentials are transient runtime state.
