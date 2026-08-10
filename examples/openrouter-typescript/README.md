# OpenRouter TypeScript example

This directory is the contract for the first end-to-end fixture repository on the supported V1 path:

- TypeScript on Node.js
- the `openai` SDK configured for OpenRouter
- a direct, statically pinned model literal
- JSON or tool-call output
- checked-in, human-reviewed eval cases

The finished fixture will contain a small application, a human-owned call-site manifest, at least 30
representative eval cases, a pinned model-catalog snapshot, and a deterministic OpenAI-compatible mock
provider. The scenario matrix in [`fixtures/scenarios.json`](fixtures/scenarios.json) defines both the
happy path and the required abstention/refusal behavior.

The golden pipeline is:

1. scan the fixture and compare discovered fingerprints with reviewed expectations;
2. validate the call-site manifest and eval cases;
3. replay the pinned catalog and mock provider responses;
4. evaluate compatible candidates with deterministic scorers and hard limits;
5. recommend only when evidence clears the configured threshold;
6. create a minimal patch only when its source fingerprint is still current;
7. rerun and prove artifact and Action idempotency.

Until those tasks land, Vetryn is pre-alpha and not ready for production migrations. Empty or
plausible-looking result snapshots are intentionally avoided.
