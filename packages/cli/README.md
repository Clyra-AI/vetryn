# `vetryn` CLI

The CLI discovers model pins, initializes reviewed manifests, and manages repository-owned OpenRouter
catalog evidence.

Import a captured OpenRouter response without network access:

```sh
vetryn catalog refresh \
  --catalog-file openrouter-models.json \
  --store .vetryn/catalog \
  --observed-at 2026-08-11T12:00:00.000Z \
  --refresh-id scheduled-2026-08-11
```

Omit `--catalog-file` to perform an explicit live refresh against OpenRouter's fixed public model endpoint.
`--observed-at` is required for captured responses and must record when the response was acquired; live refreshes
derive freshness from the acquisition clock.
The immutable observation distinguishes that live acquisition from a repository-captured response. Every attempt
needs a unique observation ID; the CLI generates one when omitted. Failures return a non-zero exit code and never
select a previous snapshot as current. Repository JSON, snapshot, and scanned source inputs are read through a
fixed byte limit before parsing.

Resolve a shortlist entirely from checked-in evidence:

```sh
vetryn catalog shortlist \
  --manifest .vetryn/manifest.json \
  --call-site support-classification \
  --observation .vetryn/catalog/observations/REFRESH_ID.json \
  --snapshot .vetryn/catalog/snapshots/SHA256_HEX.json
```

The successful observation must commit the snapshot's exact ID and digest with freshness no earlier than the
snapshot's creation time. The output binds the call site and candidates to both evidence records. Use `--limit`
only to lower the default bound of five.

`vetryn scan --json` includes both findings and an `assessment` funnel for the supported direct-call scope. File
counts reconcile considered, parsed, and parse-error units; observation counts reconcile patchable/non-patchable,
high-confidence/ambiguous, and reason-code totals. File-level parse diagnostics remain outside those call-site
observation totals. A scan with no findings therefore remains an explicitly scoped assessment rather than a claim
that the repository contains no other AI usage.
