# ADR 0015: Bind candidate capabilities to call-site requirements

## Context

V1 supports text generation, structured JSON, and simple tool calls. A candidate catalog already records each
model's text-generation, structured-output, and tool-call capabilities, but the call-site contract did not declare
which capabilities its workload requires.

## Decision

- Call-site specifications and manifests declare `requiredCapabilities`, with `textGeneration: true` and explicit
  booleans for structured output and tool calls.
- Recommendation validation rejects a retired candidate or one missing any required capability before it can
  authorize a patch.

## Consequences

A text-only candidate cannot replace a structured-output or tool-calling workload. Scanner and manifest-writing
work must infer or request these requirements before producing a durable call-site manifest.
