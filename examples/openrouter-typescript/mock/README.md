# Mock provider

This directory is reserved for the deterministic OpenAI-compatible mock provider implemented by task
`V1-02`. It must support successful JSON/tool responses, timeouts, rate limits, invalid output, usage
accounting, and a hard request budget without network access.
`provider.ts` is the only executor used by this fixture. It has injected clock, retry, and request-budget inputs,
emits redacted mock events, and has no network or credential behavior.
