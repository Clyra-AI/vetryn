# Maintainers

## Active maintainers

- [David Ahmann](https://github.com/davidahmann) — `@davidahmann`, project lead
- [`@RyshMan`](https://github.com/RyshMan)

An active maintainer with current GitHub write, maintain, or admin access may explicitly authorize a bounded task
run, branch and pull-request creation, canonical task promotion after every non-waivable gate passes, and merge
through the protected repository workflow. Either maintainer may perform those actions; OSS V1 does not require a
second maintainer's approval.

Authorization is per run and task. Listing here, `CODEOWNERS`, a skill, a compiled packet, or a prior conversation
is not standing permission to mutate the repository. Maintainers cannot use this role to broaden task scope, push
directly to `main`, use ambient credentials, incur live-provider spend without an eligible packet and explicit
grant, or waive privacy, fail-closed behavior, provider safety, evidence integrity, or another non-waivable rule.

Repository-specific skills live under `.agents/skills/` and are available from a Vetryn checkout. Generic Factory
workers must come from the repository's verified portable Factory integration; missing or unverifiable worker
resources are a blocker, not a reason to depend on a machine-local sibling checkout.

Roster changes must land through a reviewed pull request together with matching `CODEOWNERS` and policy updates.
See [`GOVERNANCE.md`](GOVERNANCE.md) for maintainer responsibilities and how maintainership evolves.
