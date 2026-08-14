# Vetryn Factory adapter

Vetryn uses a lean repo-native planning model under `product/plans/`. This directory records the
optional Factory adoption posture without making Factory a product dependency.

- Factory is not a Git submodule.
- Factoryd runtime state belongs in ignored `.factoryd/`.
- Repo-native task compilation is enabled; remote shipping, network, credentials, provider access, merge
  authority, and autoship still require the compiled packet, repository policy, and explicit human authority.
- Factoryd's currently proven bootstrap template is Go CLI-specific. Vetryn will not claim runtime
  readiness until a real TypeScript-compatible adapter validates `doctor` and dry-run behavior.
- Installed Factory skills are trusted local development tools. Vetryn neither requires a sibling Factory checkout
  nor authenticates the developer host or installed worker bytes.

Committed task-run evidence must be compact and redacted. Raw logs, claims, prompts, worktrees, grants,
and credentials are transient runtime state.

Use `pnpm --silent task:next` and `pnpm --silent task:compile -- TASK-ID` as the stable adapter surface.
`profile.yaml` vendors the executable `implementation_risk` overlay and records the canonical Factory source plus
profile and semantic-risk schema digests for reproducibility. This does not make Factory a Vetryn product or
runtime dependency, and installed generic workers are invoked by skill name rather than through a machine-local
Factory path.

Compiled packets expose Factory's runner-ready task, scope, validation, worker-chain, lifecycle, evidence,
runtime, compatibility, and acceptance-result fields directly. The executor still cannot fabricate lifecycle
artifacts, accept the task, edit generated progress, or broaden canonical scope. Repository-specific domain
reviews use `required_domain_review_chain`; they are not aliases for Factory's generic `code-review` worker.
This is Vetryn's lean adapter contract, not a claim that its packets implement Factory's larger universal
task-packet runtime schema.
Medium- and high-risk packets add exact writable report and integrity-marker targets under
`.factory/artifacts/task-runs/<task-id>/`. The repository vendors the byte-identical pinned Factory schema and
provides `pnpm --silent semantic-risk:design -- TASK-ID`, so a clean checkout can bind and later validate the
design evidence without a hosted runtime or machine-local Factory path. The marker proves internal consistency,
not chronology, approval, or independent authority. This offline V1 adapter rejects `authorized`
external actions; live authority remains a separately reviewed field-operation boundary. Lifecycle-owned
validation, review, shipping, and promotion artifacts remain outside executor scope.
