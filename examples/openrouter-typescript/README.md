# OpenRouter TypeScript example

This directory is the contract for the first end-to-end fixture repository on the supported V1 path:

- TypeScript on Node.js
- the `openai` SDK configured for OpenRouter
- a direct, statically pinned model literal
- JSON or tool-call output
- checked-in, human-reviewed eval cases

The fixture contains a scanner-friendly source call, a human-owned call-site manifest, 30 reviewed synthetic
eval cases, a pinned model-catalog snapshot, a fixed clock, expected redacted artifacts, and a deterministic
OpenAI-compatible mock provider. The scenario matrix in [`fixtures/scenarios.json`](fixtures/scenarios.json)
defines both the happy path and the required abstention/refusal behavior.

To initialize the checked-in manifest from a reviewed call-site record, use the offline CLI command below. The
command requires the stable manifest ID only on first creation; rerunning it with the same record is a no-op, and
it refuses to overwrite a different record with the same human-owned call-site ID.

```sh
pnpm build
node packages/cli/dist/index.js manifest init \
  --manifest examples/openrouter-typescript/fixtures/manifest.json \
  --call-site examples/openrouter-typescript/fixtures/manifest-input.json
```

To inspect the scanner output without executing the fixture source, run:

```sh
node packages/cli/dist/index.js scan --root examples/openrouter-typescript src --json
```

Catalog inputs are provider data and remain untrusted. Capture or fetch them through `catalog refresh`,
then use only the persisted content-addressed snapshot for evaluation. This offline example already pins
its reviewed snapshot at `fixtures/catalog-snapshot.json`:

```sh
node packages/cli/dist/index.js catalog shortlist \
  --manifest examples/openrouter-typescript/fixtures/manifest.json \
  --call-site support-classification \
  --snapshot examples/openrouter-typescript/fixtures/catalog-snapshot.json
```

The shortlist excludes the baseline, retired entries, blocked providers, and incompatible capabilities
before applying the five-candidate bound. Its ordering uses the manifest's reviewed prompt/completion
weights and is reproducible even if OpenRouter's live catalog later changes.

The golden pipeline is:

1. scan the fixture and compare discovered fingerprints with reviewed expectations;
2. validate the call-site manifest and eval cases;
3. replay the pinned catalog and mock provider responses;
4. evaluate compatible candidates with deterministic scorers and hard limits;
5. recommend only when evidence clears the configured threshold;
6. create a minimal patch only when its source fingerprint is still current;
7. rerun and prove artifact and Action idempotency.

Run `pnpm test:scenarios` to replay the fixture. It is intentionally offline: the test constructs the real SDK
with a synthetic key to verify its OpenRouter configuration but never invokes it, the mock provider never performs
I/O, and the suite asserts semantics such as retry bounds, usage, abstention, artifact shape, and redaction rather
than using result snapshots.

Until the remaining V1 tasks land, Vetryn is pre-alpha and not ready for production migrations.
