import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VETRYN_ARTIFACT_SCHEMA_VERSION,
  createCatalogContentDigest,
  parseCandidateRun,
  parseEvaluationExecutionRecord,
} from "@vetryn/core";

import {
  EvaluationTransportError,
  createCurrentCatalogRefresh,
  createEvaluationCaseDigest,
  createOpenRouterEvaluationTransport,
  evaluateOpenRouterCandidate,
  refreshOpenRouterCatalog,
  validateCatalogRefreshLineage,
  type CatalogStore,
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
  ...["openai/foo_bar", "openai/foo-bar"].map((id) => ({
    capabilities: { structuredOutput: true, textGeneration: true, toolCalls: false },
    contextWindowTokens: 100_000,
    id,
    inputPricePerMillionUsd: "0.1",
    outputPricePerMillionUsd: "0.2",
    modelAuthor: "openai",
    retired: false,
  })),
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

const rawCatalog = {
  data: [
    {
      architecture: { output_modalities: ["text"] },
      context_length: 100_000,
      id: callSite.currentModel,
      pricing: { completion: "0.000002", prompt: "0.000001" },
      supported_parameters: ["response_format"],
    },
    {
      architecture: { output_modalities: ["text"] },
      context_length: 100_000,
      id: "openai/gpt-4o-mini",
      pricing: { completion: "0.0000002", prompt: "0.0000001" },
      supported_parameters: ["response_format"],
    },
    ...["openai/foo_bar", "openai/foo-bar"].map((id) => ({
      architecture: { output_modalities: ["text"] },
      context_length: 100_000,
      id,
      pricing: { completion: "0.0000002", prompt: "0.0000001" },
      supported_parameters: ["response_format"],
    })),
  ],
};

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

const evalSuite = {
  artifactType: "eval-suite",
  callSiteId: callSite.id,
  caseCount: 2,
  fixtureDigest: createEvaluationCaseDigest(cases),
  fixturePath: "fixtures/support-classification.evals.jsonl",
  id: callSite.evalSuiteId,
  redactionMode: "no-raw-inputs-or-outputs",
  reviewed: true,
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
} as const;

function transport(): EvaluationTransport {
  return {
    async execute(request) {
      return {
        latencyMs: request.model === callSite.currentModel ? 600 : 300,
        output: { classification: request.caseId === "support-001" ? "billing" : "returns" },
        route: {
          attempts: [{ model: request.model, providerName: "Azure", statusCode: 200 }],
          selectedProvider: { model: request.model, providerName: "Azure" },
        },
        usage: { completionTokens: 1, promptTokens: 9 },
      };
    },
  };
}

function memoryCatalogStore(): CatalogStore {
  return {
    async hasSnapshot() {
      return false;
    },
    async putObservation() {},
    async putRefresh(catalogSnapshot, observation) {
      return {
        observation: { ...observation, reusedSnapshot: false },
        snapshot: catalogSnapshot,
      };
    },
    async putSnapshot(catalogSnapshot) {
      return { reused: false, snapshot: catalogSnapshot };
    },
  };
}

async function acquireCurrentCatalogRefresh(catalog: unknown = rawCatalog) {
  vi.useFakeTimers();
  vi.setSystemTime(snapshot.observedAt);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve(
        new Response(JSON.stringify(catalog), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      ),
    ),
  );
  try {
    const refresh = await refreshOpenRouterCatalog({
      acquisition: "live-api",
      refreshId: "refresh-success",
      store: memoryCatalogStore(),
    });
    if (refresh.status !== "success") throw new Error("Expected the offline live refresh to pass.");
    return createCurrentCatalogRefresh({ invocationId: lineage.invocationId, refresh });
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
}

function baseOptions(
  currentCatalogRefresh: Awaited<ReturnType<typeof acquireCurrentCatalogRefresh>>,
) {
  const times = ["2026-08-10T00:00:01.000Z", "2026-08-10T00:00:02.000Z"];
  return {
    callSite,
    candidateModel: "openai/gpt-4o-mini",
    cases,
    currentCatalogRefresh,
    clock: { now: () => times.shift() ?? "2026-08-10T00:00:02.000Z" },
    evalSuite,
    evaluator: { build: "git:test-build", id: "vetryn-evaluator", version: "0.1.0" },
    executionRecordId: "execution-record:support-classification-test",
    limits: { concurrency: 2, maxRequests: 8, maxSpendUsd: "1", retries: 1, timeoutMs: 1000 },
    sampling: { attempts: 1, maxOutputTokens: 32, seed: 42, temperature: 0 },
    scorer: {
      configurationDigest: digest("c"),
      id: "deterministic-assertions",
      version: "1.0.0",
    },
    transport: transport(),
  } as const;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
            route_attempts: [
              {
                model: "openai/gpt-4o-mini",
                provider_name: "Azure",
                status_code: 200,
              },
            ],
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
      attempts: [{ model: "openai/gpt-4o-mini", providerName: "Azure", statusCode: 200 }],
      selectedProvider: { model: "openai/gpt-4o-mini", providerName: "Azure" },
    });
  });

  it("rejects missing route metadata and inconsistent attempt models", async () => {
    const missingMetadataTransport = createOpenRouterEvaluationTransport({
      apiKey: "offline-fixture-key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"classification":"billing"}' } }],
            model: "openai/gpt-4o-mini",
            provider: "Azure",
            usage: { completion_tokens: 1, prompt_tokens: 9 },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      nowMilliseconds: () => 1,
    });
    await expect(
      missingMetadataTransport.execute({
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
      }),
    ).rejects.toMatchObject({ code: "invalid-output" });

    const options = baseOptions(await acquireCurrentCatalogRefresh());
    const artifacts = await evaluateOpenRouterCandidate({
      ...options,
      clock: { now: () => "2026-08-10T00:00:01.000Z" },
      transport: {
        async execute(request) {
          return {
            ...(await transport().execute(request)),
            route: {
              attempts: [{ model: "other/model", providerName: "Azure", statusCode: 200 }],
              selectedProvider: { model: "other/model", providerName: "Azure" },
            },
          };
        },
      },
    });
    expect(artifacts.candidateRun).toMatchObject({
      failureCode: "invalid-output",
      status: "incomplete",
    });
    expect(artifacts.candidateRun).not.toHaveProperty("routeObservation");
  });

  it("cancels a chunked provider body as soon as it exceeds one megabyte", async () => {
    let cancelled = false;
    let chunksProduced = 0;
    const chunk = new Uint8Array(600_000);
    const providerTransport = createOpenRouterEvaluationTransport({
      apiKey: "offline-fixture-key",
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              cancel() {
                cancelled = true;
              },
              pull(controller) {
                chunksProduced += 1;
                controller.enqueue(chunk);
                if (chunksProduced === 3) controller.close();
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      nowMilliseconds: () => 1,
    });

    await expect(
      providerTransport.execute({
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
      }),
    ).rejects.toMatchObject({ code: "invalid-output" });
    expect(cancelled).toBe(true);
    expect(chunksProduced).toBe(2);
  });

  it("emits reproducible complete candidate and execution artifacts from pinned inputs", async () => {
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    const result = await evaluateOpenRouterCandidate(options);

    expect(parseCandidateRun(result.candidateRun)).toMatchObject({
      executionRecordId: options.executionRecordId,
      gateOutcomes: {
        context: "pass",
        cost: "pass",
        latency: "pass",
        privacy: "pass",
        quality: "pass",
      },
      provenance: {
        limits: options.limits,
        observed: { providerRequestCount: 4 },
      },
      status: "complete",
    });
    expect(parseEvaluationExecutionRecord(result.executionRecord)).toMatchObject({
      candidateRunId: result.candidateRun.id,
      completedAt: "2026-08-10T00:00:02.000Z",
      id: options.executionRecordId,
      startedAt: "2026-08-10T00:00:01.000Z",
    });
    expect(result.candidateRun.routeObservation?.requestCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("Synthetic billing request");
    expect(JSON.stringify(result)).not.toContain("customer-secret");
  });

  it("keeps candidate-run IDs distinct when model punctuation normalizes alike", async () => {
    const first = await evaluateOpenRouterCandidate({
      ...baseOptions(await acquireCurrentCatalogRefresh()),
      candidateModel: "openai/foo_bar",
      executionRecordId: "execution-record:model-id-first",
    });
    const second = await evaluateOpenRouterCandidate({
      ...baseOptions(await acquireCurrentCatalogRefresh()),
      candidateModel: "openai/foo-bar",
      executionRecordId: "execution-record:model-id-second",
    });

    expect(first.candidateRun.id).not.toBe(second.candidateRun.id);
    expect(first.candidateRun.id).toMatch(/--model-[0-9a-f]{64}$/u);
    expect(second.candidateRun.id).toMatch(/--model-[0-9a-f]{64}$/u);
  });

  it("bounds retries and spend and leaves partial route evidence non-promotable", async () => {
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    let calls = 0;
    const result = await evaluateOpenRouterCandidate({
      ...options,
      clock: { now: () => "2026-08-10T00:00:01.000Z" },
      limits: { ...options.limits, maxRequests: 2 },
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
    const protectedSegment = "customer-\nsecret\u0007";
    const protectedCases = cases.map((evaluationCase) => ({
      ...evaluationCase,
      protectedSegments: [protectedSegment],
    }));
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    const result = await evaluateOpenRouterCandidate({
      ...options,
      cases: protectedCases,
      clock: { now: () => "2026-08-10T00:00:01.000Z" },
      evalSuite: {
        ...evalSuite,
        fixtureDigest: createEvaluationCaseDigest(protectedCases),
      },
      transport: {
        async execute(request) {
          return {
            ...(await transport().execute(request)),
            output: { classification: `wrong ${protectedSegment}` },
          };
        },
      },
    });

    expect(result.candidateRun.gateOutcomes).toMatchObject({ privacy: "fail", quality: "fail" });
    expect(JSON.stringify(result)).not.toContain("customer-secret");
  });

  it("detects protected numeric and boolean JSON primitives before redaction", async () => {
    const primitiveCases = cases.map((evaluationCase) => ({
      ...evaluationCase,
      protectedSegments: ["12345", "true"],
    }));
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    const result = await evaluateOpenRouterCandidate({
      ...options,
      cases: primitiveCases,
      evalSuite: {
        ...evalSuite,
        fixtureDigest: createEvaluationCaseDigest(primitiveCases),
      },
      transport: {
        async execute(request) {
          return {
            ...(await transport().execute(request)),
            output: {
              classification: request.caseId === "support-001" ? "billing" : "returns",
              leakedFlag: true,
              leakedId: 12345,
            },
          };
        },
      },
    });

    expect(result.candidateRun.gateOutcomes).toMatchObject({ privacy: "fail", quality: "pass" });
    expect(JSON.stringify(result)).not.toContain("12345");
  });

  it("fails quality when the reviewed suite is below the call-site minimum", async () => {
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    const result = await evaluateOpenRouterCandidate({
      ...options,
      callSite: {
        ...callSite,
        gates: { ...callSite.gates, minCases: cases.length + 1 },
      },
    });

    expect(result.candidateRun).toMatchObject({
      gateOutcomes: { quality: "fail" },
      status: "complete",
    });
  });

  it("uses exact decimal arithmetic at the cost-savings boundary", async () => {
    const boundaryCatalog = {
      ...rawCatalog,
      data: rawCatalog.data.map((model) =>
        model.id === callSite.currentModel
          ? { ...model, pricing: { completion: "0", prompt: "0.000003" } }
          : model.id === "openai/gpt-4o-mini"
            ? { ...model, pricing: { completion: "0", prompt: "0.0000027" } }
            : model,
      ),
    };
    const options = baseOptions(await acquireCurrentCatalogRefresh(boundaryCatalog));
    const result = await evaluateOpenRouterCandidate({
      ...options,
      callSite: {
        ...callSite,
        gates: { ...callSite.gates, minSavingsPercent: 10 },
      },
      limits: { ...options.limits, maxSpendUsd: "2" },
      sampling: { ...options.sampling, maxOutputTokens: 1 },
      transport: {
        async execute(request) {
          return {
            ...(await transport().execute(request)),
            usage: { completionTokens: 0, promptTokens: 100_000 },
          };
        },
      },
    });

    expect(result.candidateRun).toMatchObject({
      baselineMetrics: { costUsd: "0.6" },
      gateOutcomes: { cost: "pass" },
      metrics: { costUsd: "0.54" },
      status: "complete",
    });

    const subPicodollarCatalog = {
      ...rawCatalog,
      data: rawCatalog.data.map((model) =>
        model.id === callSite.currentModel
          ? { ...model, pricing: { completion: "0", prompt: "0.000000000000255" } }
          : model.id === "openai/gpt-4o-mini"
            ? { ...model, pricing: { completion: "0", prompt: "0.00000000000023" } }
            : model,
      ),
    };
    const preciseOptions = baseOptions(await acquireCurrentCatalogRefresh(subPicodollarCatalog));
    const preciseResult = await evaluateOpenRouterCandidate({
      ...preciseOptions,
      callSite: {
        ...callSite,
        gates: { ...callSite.gates, minSavingsPercent: 10 },
      },
      transport: {
        async execute(request) {
          return {
            ...(await transport().execute(request)),
            usage: { completionTokens: 0, promptTokens: 1 },
          };
        },
      },
    });

    expect(preciseResult.candidateRun).toMatchObject({
      baselineMetrics: { costUsd: "0.00000000000051" },
      gateOutcomes: { cost: "fail" },
      metrics: { costUsd: "0.00000000000046" },
      status: "complete",
    });
  });

  it("records repetition variance instead of a constant zero placeholder", async () => {
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    const candidateAttempts = new Map<string, number>();
    const result = await evaluateOpenRouterCandidate({
      ...options,
      limits: { ...options.limits, concurrency: 1 },
      sampling: { ...options.sampling, attempts: 2 },
      transport: {
        async execute(request) {
          const attempt = (candidateAttempts.get(request.caseId) ?? 0) + 1;
          if (request.model === "openai/gpt-4o-mini") {
            candidateAttempts.set(request.caseId, attempt);
          }
          const candidateSecondAttempt = request.model === "openai/gpt-4o-mini" && attempt === 2;
          return {
            ...(await transport().execute(request)),
            latencyMs: candidateSecondAttempt ? 300 : 100,
            output: candidateSecondAttempt
              ? { classification: "wrong" }
              : { classification: request.caseId === "support-001" ? "billing" : "returns" },
            usage: { completionTokens: candidateSecondAttempt ? 2 : 1, promptTokens: 9 },
          };
        },
      },
    });

    expect(result.candidateRun.provenance.variance).toMatchObject({
      p95LatencyMsStdDev: 100,
      passRateStdDev: 0.5,
    });
    expect(Number(result.candidateRun.provenance.variance.costUsdStdDev)).toBeGreaterThan(0);
  });

  it("chooses concurrent terminal failures by stable precedence", async () => {
    const failureCodes: string[] = [];
    for (const reverseCompletion of [false, true]) {
      const options = baseOptions(await acquireCurrentCatalogRefresh());
      const result = await evaluateOpenRouterCandidate({
        ...options,
        limits: { ...options.limits, retries: 0 },
        transport: {
          async execute(request) {
            const firstCase = request.caseId === "support-001";
            await new Promise((resolve) =>
              setTimeout(resolve, firstCase === reverseCompletion ? 5 : 0),
            );
            throw new EvaluationTransportError(firstCase ? "timeout" : "rate-limited");
          },
        },
      });
      failureCodes.push(result.candidateRun.failureCode ?? "missing");
    }

    expect(failureCodes).toEqual(["rate-limited", "rate-limited"]);
  });

  it("rejects cases with no required facts instead of passing them vacuously", async () => {
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    await expect(
      evaluateOpenRouterCandidate({
        ...options,
        cases: cases.map((evaluationCase) => ({ ...evaluationCase, expected: {} })),
      }),
    ).rejects.toThrow(/at least one expected fact/i);
  });

  it("rejects same-count case substitution against the reviewed fixture digest", async () => {
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    await expect(
      evaluateOpenRouterCandidate({
        ...options,
        cases: cases.map((evaluationCase, index) =>
          index === 0
            ? { ...evaluationCase, input: "Substituted same-count case" }
            : evaluationCase,
        ),
      }),
    ).rejects.toThrow(/reviewed fixture digest/i);
  });

  it("rejects baseline and capability-incompatible candidates before provider requests", async () => {
    const incompatibleCatalog = {
      ...rawCatalog,
      data: rawCatalog.data.map((model) =>
        model.id === "openai/gpt-4o-mini" ? { ...model, supported_parameters: ["tools"] } : model,
      ),
    };
    const attempts = [
      {
        candidateModel: callSite.currentModel,
        currentCatalogRefresh: await acquireCurrentCatalogRefresh(),
        expectedError: /differ from the current baseline/i,
        requiredCapabilities: callSite.requiredCapabilities,
      },
      {
        candidateModel: "openai/gpt-4o-mini",
        currentCatalogRefresh: await acquireCurrentCatalogRefresh(incompatibleCatalog),
        expectedError: /incompatible/i,
        requiredCapabilities: callSite.requiredCapabilities,
      },
      {
        candidateModel: "openai/gpt-4o-mini",
        currentCatalogRefresh: await acquireCurrentCatalogRefresh(),
        expectedError: /incompatible/i,
        requiredCapabilities: { ...callSite.requiredCapabilities, toolCalls: true },
      },
    ] as const;

    for (const attempt of attempts) {
      let providerRequests = 0;
      await expect(
        evaluateOpenRouterCandidate({
          ...baseOptions(attempt.currentCatalogRefresh),
          callSite: { ...callSite, requiredCapabilities: attempt.requiredCapabilities },
          candidateModel: attempt.candidateModel,
          transport: {
            async execute(request) {
              providerRequests += 1;
              return transport().execute(request);
            },
          },
        }),
      ).rejects.toThrow(attempt.expectedError);
      expect(providerRequests).toBe(0);
    }
  });

  it("reserves the hard spend ceiling before zero, expensive, and equality-bound requests", async () => {
    for (const [maxSpendUsd, expectedCalls] of [
      ["0", 0],
      ["0.01", 0],
      ["0.100064", 1],
    ] as const) {
      let calls = 0;
      const options = baseOptions(await acquireCurrentCatalogRefresh());
      const result = await evaluateOpenRouterCandidate({
        ...options,
        clock: { now: () => "2026-08-10T00:00:01.000Z" },
        limits: { ...options.limits, maxSpendUsd },
        transport: {
          async execute(request) {
            calls += 1;
            return transport().execute(request);
          },
        },
      });
      expect(calls).toBe(expectedCalls);
      expect(result.candidateRun).toMatchObject({
        failureCode: "budget-exhausted",
        status: "incomplete",
      });
    }
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

  it("rejects serialized lineage and public captured-response branding as current evidence", async () => {
    const options = baseOptions(await acquireCurrentCatalogRefresh());
    await expect(
      evaluateOpenRouterCandidate({
        ...options,
        currentCatalogRefresh: {
          lineage,
          snapshot,
        } as unknown as typeof options.currentCatalogRefresh,
      }),
    ).rejects.toThrow(/same-invocation/i);

    const captured = await refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch: async () =>
        new Response(JSON.stringify(rawCatalog), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      observedAt: snapshot.observedAt,
      refreshId: "captured-refresh",
      store: memoryCatalogStore(),
    });
    if (captured.status !== "success")
      throw new Error("Expected captured fixture refresh to pass.");
    expect(() =>
      createCurrentCatalogRefresh({ invocationId: "captured-invocation", refresh: captured }),
    ).toThrow(/canonical live acquisition/i);
  });
});
