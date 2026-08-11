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
`--observed-at` is reserved for captured responses; live refreshes derive freshness from the acquisition clock.
The immutable observation distinguishes that live acquisition from a repository-captured response. Every attempt
needs a unique observation ID; the CLI generates one when omitted. Failures return a non-zero exit code and never
select a previous snapshot as current.

Resolve a shortlist entirely from checked-in evidence:

```sh
vetryn catalog shortlist \
  --manifest .vetryn/manifest.json \
  --call-site support-classification \
  --snapshot .vetryn/catalog/snapshots/SHA256_HEX.json
```

The output binds the call site and candidates to the snapshot ID and content digest. Use `--limit` only
to lower the default bound of five.
