import { describe, expect, it } from "vitest";

import {
  VETRYN_ARTIFACT_SCHEMA_VERSION,
  createCatalogContentDigest,
  parseCandidateRun,
  parseEvaluationExecutionRecord,
} from "@vetryn/core";

import {
  EvaluationTransportError,
  createCurrentCatalogRefresh,
  createOpenRouterEvaluationTransport,
  evaluateOpenRouterCandidate,
  validateCatalogRefreshLineage,
  type EvaluationTransport,
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const callSite = {
  currentModel: "openai/gpt-4.1-mini",
  evalSuiteId: "eval-suite:support-classification",
  gates: {
    maxP95LatencyMs: 750,
    maxQualityRegression: 0,
    minCases: 2,
    minPassRate: 1,
    minRecommendationConfidence: 0.8,
    minSavingsPercent: 1,
  },
  id: "support-classification",
  name: "Support classification",
  owner: "support-platform",
  routePolicy: {
    allowFallbacks: false,
    dataCollection: "deny",
    providerSlug: "azure",
    requireParameters: true,
    zdr: true,
  },
  representativeUsage: {
    completionTokens: 1,
    promptTokens: 9,
    provenanceRef: "reviewed-fixture:2026-08-10",
    reviewed: true,
  },
  requiredCapabilities: {
    structuredOutput: true,
    textGeneration: true,
    toolCalls: false,
  },
  sourceBinding: {
    adapter: "openai.chat.completions.create",
    file: "src/support-classification.ts",
    sourceFingerprint: digest("a"),
    symbol: "classifySupportTicket",
  },
} as const;

const evalSuite = {
  artifactType: "eval-suite",
  callSiteId: callSite.id,
  caseCount: 2,
  fixtureDigest: digest("b"),
  fixturePath: "fixtures/support-classification.evals.jsonl",
  id: callSite.evalSuiteId,
  redactionMode: "no-raw-inputs-or-outputs",
  reviewed: true,
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
} as const;

const models = [
  {
    capabilities: { structuredOutput: true, textGeneration: true, toolCalls: false },
    contextWindowTokens: 100_000,
    id: callSite.currentModel,
    inputPricePerMillionUsd: "1",
    outputPricePerMillionUsd: "2",
    modelAuthor: "openai",
    retired: false,
  },
  {
    capabilities: { structuredOutput: true, textGeneration: true, toolCalls: false },
    contextWindowTokens: 100_000,
    id: "openai/gpt-4o-mini",
    inputPricePerMillionUsd: "0.1",
    outputPricePerMillionUsd: "0.2",
    modelAuthor: "openai",
    retired: false,
  },
];

const snapshot = {
  artifactType: "catalog-snapshot",
  contentDigest: createCatalogContentDigest(models),
  id: "catalog-snapshot:openrouter-test",
  models,
  observedAt: "2026-08-10T00:00:00.000Z",
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
  source: "openrouter",
} as const;

const success = {
  acquisition: "live-api",
  artifactType: "openrouter-catalog-refresh-observation",
  contentDigest: snapshot.contentDigest,
  errorCode: null,
  id: "refresh-success",
  normalizerVersion: "1.0.0",
  observedAt: snapshot.observedAt,
  reusedSnapshot: false,
  schemaVersion: "1.0.0",
  snapshotId: snapshot.id,
  source: "openrouter",
  sourceRef: "openrouter-models-api",
  status: "success",
} as const;

const lineage = {
  attempts: [{ observation: success, ordinal: 1 }],
  invocationId: "invocation-one",
  schemaVersion: "1.0.0",
  terminalOrdinal: 1,
} as const;

const cases = [
  {
    expected: { classification: "billing" },
    id: "support-001",
    input: "Synthetic billing request",
    protectedSegments: ["customer-secret"],
  },
  {
    expected: { classification: "returns" },
    id: "support-002",
    input: "Synthetic return request",
    protectedSegments: ["customer-secret"],
  },
] as const;

function transport(): EvaluationTransport {
  return {
    async execute(request) {
      return {
        latencyMs: request.model === callSite.currentModel ? 600 : 300,
        output: { classification: request.caseId === "support-001" ? "billing" : "returns" },
        route: {
          attempts: [{ providerName: "Azure", statusCode: 200 }],
          selectedProvider: { providerName: "Azure" },
        },
        usage: { completionTokens: 1, promptTokens: 9 },
      };
    },
  };
}

const baseOptions = {
  callSite,
  candidateModel: "openai/gpt-4o-mini",
  cases,
  currentCatalogRefresh: createCurrentCatalogRefresh({
    attempts: lineage.attempts,
    invocationId: lineage.invocationId,
    snapshot,
    terminalOrdinal: lineage.terminalOrdinal,
  }),
  clock: {
    now: (() => {
      const times = ["2026-08-10T00:00:01.000Z", "2026-08-10T00:00:02.000Z"];
      return () => times.shift() ?? "2026-08-10T00:00:02.000Z";
    })(),
  },
  evalSuite,
  evaluator: { build: "git:test-build", id: "vetryn-evaluator", version: "0.1.0" },
  executionRecordId: "execution-record:support-classification-test",
  fixtureDigest: evalSuite.fixtureDigest,
  limits: { concurrency: 2, maxRequests: 8, maxSpendUsd: "1", retries: 1, timeoutMs: 1000 },
  sampling: { attempts: 1, maxOutputTokens: 32, seed: 42, temperature: 0 },
  scorer: { configurationDigest: digest("c"), id: "deterministic-assertions", version: "1.0.0" },
  transport: transport(),
} as const;

describe("bounded deterministic evaluation", () => {
  it("applies the reviewed route policy at the OpenRouter request boundary", async () => {
    let observedRequest: Request | undefined;
    const times = [0, 25];
    const providerTransport = createOpenRouterEvaluationTransport({
      apiKey: "offline-fixture-key",
      fetch: async (input, init) => {
        observedRequest = new Request(input, init);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"classification":"billing"}' } }],
            model: "openai/gpt-4o-mini",
            provider: "Azure",
            usage: { completion_tokens: 1, prompt_tokens: 9 },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        );
      },
      nowMilliseconds: () => times.shift() ?? 25,
    });
    const result = await providerTransport.execute({
      caseId: "support-001",
      input: "synthetic",
      maxOutputTokens: 32,
      model: "openai/gpt-4o-mini",
      routePolicy: {
        headers: { "X-OpenRouter-Metadata": "enabled" },
        provider: {
          allow_fallbacks: false,
          data_collection: "deny",
          only: ["azure"],
          require_parameters: true,
          zdr: true,
        },
      },
      sampling: { seed: 42, temperature: 0 },
      signal: new AbortController().signal,
    });

    expect(observedRequest).toBeDefined();
    expect(observedRequest?.headers.get("X-OpenRouter-Metadata")).toBe("enabled");
    expect(JSON.parse((await observedRequest?.text()) ?? "{}")).toMatchObject({
      model: "openai/gpt-4o-mini",
      provider: {
        allow_fallbacks: false,
        data_collection: "deny",
        only: ["azure"],
        require_parameters: true,
        zdr: true,
      },
    });
    expect(result.route).toEqual({
      attempts: [{ providerName: "Azure", statusCode: 200 }],
      selectedProvider: { providerName: "Azure" },
    });
  });

  it("emits reproducible complete candidate and execution artifacts from pinned inputs", async () => {
    const result = await evaluateOpenRouterCandidate(baseOptions);

    expect(parseCandidateRun(result.candidateRun)).toMatchObject({
      executionRecordId: baseOptions.executionRecordId,
      gateOutcomes: {
        context: "pass",
        cost: "pass",
        latency: "pass",
        privacy: "pass",
        quality: "pass",
      },
      provenance: {
        limits: baseOptions.limits,
        observed: { providerRequestCount: 4 },
      },
      status: "complete",
    });
    expect(parseEvaluationExecutionRecord(result.executionRecord)).toMatchObject({
      candidateRunId: result.candidateRun.id,
      completedAt: "2026-08-10T00:00:02.000Z",
      id: baseOptions.executionRecordId,
      startedAt: "2026-08-10T00:00:01.000Z",
    });
    expect(result.candidateRun.routeObservation?.requestCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("Synthetic billing request");
    expect(JSON.stringify(result)).not.toContain("customer-secret");
  });

  it("bounds retries and spend and leaves partial route evidence non-promotable", async () => {
    let calls = 0;
    const result = await evaluateOpenRouterCandidate({
      ...baseOptions,
      clock: { now: () => "2026-08-10T00:00:01.000Z" },
      limits: { ...baseOptions.limits, maxRequests: 2 },
      transport: {
        async execute() {
          calls += 1;
          throw new EvaluationTransportError("rate-limited");
        },
      },
    });

    expect(calls).toBe(2);
    expect(result.candidateRun).toMatchObject({
      failureCode: "budget-exhausted",
      status: "incomplete",
    });
    expect(result.candidateRun).not.toHaveProperty("metrics");
  });

  it("fails hard gates deterministically without leaking protected output", async () => {
    const result = await evaluateOpenRouterCandidate({
      ...baseOptions,
      clock: { now: () => "2026-08-10T00:00:01.000Z" },
      transport: {
        async execute(request) {
          return {
            ...(await transport().execute(request)),
            output: { classification: `wrong customer-secret` },
          };
        },
      },
    });

    expect(result.candidateRun.gateOutcomes).toMatchObject({ privacy: "fail", quality: "fail" });
    expect(JSON.stringify(result)).not.toContain("customer-secret");
  });

  it("requires a complete ordered lineage whose terminal attempt is the cited success", () => {
    const failure = {
      ...success,
      contentDigest: null,
      errorCode: "fetch-failed",
      id: "refresh-failure",
      reusedSnapshot: false,
      snapshotId: null,
      status: "failure",
    } as const;

    expect(() => validateCatalogRefreshLineage(lineage, snapshot, "invocation-one")).not.toThrow();
    for (const invalid of [
      { ...lineage, attempts: [...lineage.attempts, { observation: failure, ordinal: 2 }] },
      { ...lineage, attempts: [{ observation: success, ordinal: 2 }] },
      {
        ...lineage,
        attempts: [
          { observation: success, ordinal: 1 },
          { observation: failure, ordinal: 3 },
        ],
      },
      { ...lineage, invocationId: "another-invocation" },
    ]) {
      expect(() => validateCatalogRefreshLineage(invalid, snapshot, "invocation-one")).toThrow();
    }
  });

  it("rejects a serialized caller-supplied lineage in place of current-invocation evidence", async () => {
    await expect(
      evaluateOpenRouterCandidate({
        ...baseOptions,
        currentCatalogRefresh: {
          lineage,
          snapshot,
        } as unknown as typeof baseOptions.currentCatalogRefresh,
      }),
    ).rejects.toThrow(/same-invocation/i);
  });
});
