# Vetryn Factory operating profile

Vetryn uses a repo-native planning model under `product/plans/`. This directory contains a self-contained profile
with every field required by the four installed portable Factory workers, plus task-bound design evidence, without
making Factory a product dependency. It is intentionally smaller than Factory's broader project profile because
unconsumed Factory features are not part of Vetryn's worker contract.

- Factory is not a Git submodule.
- Factoryd runtime state belongs in ignored `.factoryd/`.
- Repo-native task compilation is enabled. Remote shipping, network, credentials, provider access, promotion, and
  merge still require both packet capability and explicit current-run maintainer authority.
- `.factory/profile.yaml` is the self-contained portable-worker profile and immutable trust anchor. It pins one
  Factory source commit and the manifest digest of every required installed worker.
- `$vetryn-continue-next` independently verifies committed profile bytes, every manifest pin and resource, and the
  manifest-bound verifier before installed code executes. It never consults a sibling checkout.
- The profile also pins the complete runtime package graph used by the plan/task adapters. Preflight verifies the
  tracked package and lock manifests and hashes every direct and transitive installed package before each adapter
  invocation, so ignored dependency bytes cannot execute merely because their names resolve.
- Portable worker-pack contract v1 supports POSIX macOS and Linux with `/dev/fd`; other platforms receive the typed
  `unsupported_platform` blocker before installed-pack I/O.
- Factoryd remains deferred; `.factoryd/` is transient and non-authoritative.

`commit_push.submodule_policy.factory_path` uses the quoted `disabled:no-factory-submodule` sentinel because the
portable `commit-push` profile contract requires a non-empty field. Every related submodule flag is false; the
sentinel must never be resolved or inspected as a path.

Committed task-run evidence must be compact and redacted. Raw logs, claims, prompts, worktrees, grants,
and credentials are transient runtime state.

Use `pnpm --silent task:next` and `pnpm --silent task:compile -- TASK-ID` as the stable adapter surface. The profile
vendors the executable policy used by task compilation, records its Factory provenance and semantic-risk schema
digests, and pins the portable pack set. Updating any pin is a reviewed repository policy change and invalidates
compiled packets that observed the prior profile.

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
