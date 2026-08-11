import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import {
  createCatalogContentDigest,
  parseVetrynArtifact,
} from "../../../packages/core/src/index.js";
import {
  createOpenAICompatibleMockTransport,
  createMockProvider,
  evaluatePatchPrecondition,
  type MockOutcome,
  type MockUsage,
} from "../mock/provider.js";
import {
  classifySupportTicket,
  createOpenRouterClient,
  OPENROUTER_BASE_URL,
} from "../src/support-classification.js";

interface CallSiteManifest {
  readonly callSites: readonly {
    readonly currentModel: string;
    readonly evalSuiteId: string;
    readonly id: string;
    readonly owner: string;
    readonly representativeUsage: {
      readonly reviewed: boolean;
    };
    readonly sourceBinding: {
      readonly file: string;
      readonly sourceFingerprint: string;
      readonly symbol: string;
    };
  }[];
}

interface EvalSuite {
  readonly caseCount: number;
  readonly fixtureDigest: string;
  readonly fixturePath: string;
  readonly id: string;
  readonly reviewed: boolean;
}

interface EvalCase {
  readonly expectedClass: string;
  readonly id: string;
  readonly review: {
    readonly owner: string;
    readonly reviewedAt: string;
    readonly status: string;
  };
}

interface CatalogSnapshot {
  readonly contentDigest: string;
  readonly models: Parameters<typeof createCatalogContentDigest>[0];
}

interface ClockFixture {
  readonly now: string;
  readonly timezone: string;
}

interface ScenarioMatrix {
  readonly offline: boolean;
  readonly scenarios: readonly {
    readonly assertions: readonly string[];
    readonly expectedDisposition: string;
    readonly id: string;
  }[];
}

interface ExpectedSummary {
  readonly artifactType: string;
  readonly disposition: string;
  readonly expectedPatch?: { readonly operation: string };
  readonly patch?: null;
  readonly redaction: { readonly rawInputs: boolean; readonly rawOutputs: boolean };
}

const fixtureRoot = new URL("../", import.meta.url);
const fixtureFile = (relativePath: string): URL => new URL(relativePath, fixtureRoot);

const readJson = async <Value>(relativePath: string): Promise<Value> =>
  JSON.parse(await readFile(fixtureFile(relativePath), "utf8")) as Value;

const readDurableArtifactContents = async (relativeDirectory: string): Promise<string[]> => {
  const entries = await readdir(fixtureFile(relativeDirectory), { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      return entry.isDirectory()
        ? readDurableArtifactContents(relativePath)
        : [await readFile(fixtureFile(relativePath), "utf8")];
    }),
  );
  return contents.flat();
};

const fixtureDigest = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const parseJsonLines = (value: string): EvalCase[] =>
  value
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as EvalCase);

describe("OpenRouter TypeScript golden scenario", () => {
  it("binds a scanner-friendly source call to a human-reviewed manifest and 30 reviewed synthetic cases", async () => {
    const [application, manifest, evalSuite, evalCaseText] = await Promise.all([
      readFile(fixtureFile("src/support-classification.ts"), "utf8"),
      readJson<CallSiteManifest>("fixtures/manifest.json"),
      readJson<EvalSuite>("fixtures/eval-suite.json"),
      readFile(fixtureFile("fixtures/support-classification.evals.jsonl"), "utf8"),
    ]);
    const cases = parseJsonLines(evalCaseText);
    const callSite = manifest.callSites[0];

    expect(callSite).toBeDefined();
    if (callSite === undefined) {
      throw new Error("golden manifest must declare the support-classification call site");
    }

    expect(callSite).toMatchObject({
      currentModel: "openai/gpt-4.1-mini",
      evalSuiteId: evalSuite.id,
      id: "support-classification",
      owner: "support-platform",
      representativeUsage: { reviewed: true },
      sourceBinding: { file: "src/support-classification.ts", symbol: "classifySupportTicket" },
    });
    const client = createOpenRouterClient("fixture-only-key-not-a-secret");

    expect(client).toBeInstanceOf(OpenAI);
    expect(client.baseURL).toBe(OPENROUTER_BASE_URL);
    expect(client.maxRetries).toBe(0);
    expect(classifySupportTicket).toBeTypeOf("function");
    expect(application).toContain('model: "openai/gpt-4.1-mini"');
    expect(callSite.sourceBinding.sourceFingerprint).toBe(fixtureDigest(application));
    expect(OPENROUTER_BASE_URL).toBe("https://openrouter.ai/api/v1");
    expect(cases).toHaveLength(30);
    expect(new Set(cases.map(({ id }) => id)).size).toBe(30);
    expect(cases.every(({ expectedClass }) => expectedClass.length > 0)).toBe(true);
    expect(
      cases.every(
        ({ review }) =>
          review.owner === "support-platform" &&
          review.status === "reviewed" &&
          review.reviewedAt === "2026-08-10",
      ),
    ).toBe(true);
    expect(evalSuite).toMatchObject({
      caseCount: 30,
      fixtureDigest: fixtureDigest(evalCaseText),
      fixturePath: "fixtures/support-classification.evals.jsonl",
      reviewed: true,
    });
    expect(() => parseVetrynArtifact(manifest)).not.toThrow();
    expect(() => parseVetrynArtifact(evalSuite)).not.toThrow();
  });

  it("replays only the pinned catalog and fixed clock without network or ambient credentials", async () => {
    const [catalog, clock, scenarioMatrix, mockSource] = await Promise.all([
      readJson<CatalogSnapshot>("fixtures/catalog-snapshot.json"),
      readJson<ClockFixture>("fixtures/clock.json"),
      readJson<ScenarioMatrix>("fixtures/scenarios.json"),
      readFile(fixtureFile("mock/provider.ts"), "utf8"),
    ]);
    const requiredScenarioIds = [
      "cheaper-valid-candidate",
      "invalid-json-output",
      "contradictory-evidence",
      "rate-limit-budget-exhaustion",
      "stale-source-fingerprint",
    ];

    expect(clock).toEqual({
      now: "2026-08-10T00:00:00.000Z",
      timezone: "UTC",
      schemaVersion: "1.0.0",
    });
    expect(scenarioMatrix.offline).toBe(true);
    expect([...new Set(scenarioMatrix.scenarios.map(({ id }) => id))]).toEqual(
      expect.arrayContaining(requiredScenarioIds),
    );
    expect(catalog.contentDigest).toBe(createCatalogContentDigest(catalog.models));
    expect(catalog.models.every(({ id, provider }) => id.startsWith(`${provider}/`))).toBe(true);
    expect(() => parseVetrynArtifact(catalog)).not.toThrow();
    expect(mockSource).not.toMatch(/\bfetch\s*\(|\bprocess\.env\b|node:(?:http|https)/u);
  });

  it("refuses a stale source fingerprint without producing a patch", async () => {
    const [application, manifest, scenarioMatrix, expectedStaleReport] = await Promise.all([
      readFile(fixtureFile("src/support-classification.ts"), "utf8"),
      readJson<CallSiteManifest>("fixtures/manifest.json"),
      readJson<ScenarioMatrix>("fixtures/scenarios.json"),
      readJson<ExpectedSummary>("expected/stale-source-report.json"),
    ]);
    const staleScenario = scenarioMatrix.scenarios.find(
      ({ id }) => id === "stale-source-fingerprint",
    );
    const callSite = manifest.callSites[0];

    expect(callSite).toBeDefined();
    if (callSite === undefined) {
      throw new Error("golden manifest must declare the support-classification call site");
    }

    const expectedFingerprint = callSite.sourceBinding.sourceFingerprint;
    const changedSource = application.replace(
      'model: "openai/gpt-4.1-mini"',
      'model: "openai/gpt-4.1"',
    );
    const matched = evaluatePatchPrecondition(expectedFingerprint, fixtureDigest(application));
    const stale = evaluatePatchPrecondition(expectedFingerprint, fixtureDigest(changedSource));

    expect(staleScenario).toMatchObject({
      expectedDisposition: "refuse",
      assertions: expect.arrayContaining(["No stale patch is applied."]),
    });
    expect(matched).toEqual({
      diagnosticCodes: [],
      disposition: "eligible",
      patch: { operation: "replace-model-literal" },
    });
    expect(stale).toEqual({
      diagnosticCodes: ["stale-source-fingerprint"],
      disposition: "refuse",
      patch: null,
    });
    expect(expectedStaleReport).toMatchObject(stale);
  });

  it("models success, invalid output, timeout, rate limiting, usage, retries, and request-budget exhaustion", async () => {
    const clock = await readJson<ClockFixture>("fixtures/clock.json");
    const customUsage: MockUsage = { completionTokens: 3, promptTokens: 11, totalTokens: 14 };
    const cases: readonly {
      readonly outcome: MockOutcome;
      readonly expected: {
        readonly attempts: number;
        readonly code: string;
        readonly disposition: string;
        readonly eventKinds: readonly string[];
        readonly requestCount: number;
        readonly totalTokens: number;
      };
    }[] = [
      {
        outcome: "success",
        expected: {
          attempts: 1,
          code: "success",
          disposition: "complete",
          eventKinds: ["completed"],
          requestCount: 1,
          totalTokens: 10,
        },
      },
      {
        outcome: "invalid-output",
        expected: {
          attempts: 1,
          code: "invalid-output",
          disposition: "abstain",
          eventKinds: ["invalid-output"],
          requestCount: 1,
          totalTokens: 0,
        },
      },
      {
        outcome: "timeout",
        expected: {
          attempts: 1,
          code: "timeout",
          disposition: "abstain",
          eventKinds: ["timeout"],
          requestCount: 1,
          totalTokens: 0,
        },
      },
      {
        outcome: "rate-limit",
        expected: {
          attempts: 3,
          code: "rate-limit-exhausted",
          disposition: "abstain",
          eventKinds: ["rate-limit", "rate-limit", "rate-limit"],
          requestCount: 3,
          totalTokens: 0,
        },
      },
      {
        outcome: "usage",
        expected: {
          attempts: 1,
          code: "success",
          disposition: "complete",
          eventKinds: ["completed"],
          requestCount: 1,
          totalTokens: 14,
        },
      },
      {
        outcome: "budget-exhaustion",
        expected: {
          attempts: 0,
          code: "budget-exhausted",
          disposition: "abstain",
          eventKinds: ["budget-exhausted"],
          requestCount: 0,
          totalTokens: 0,
        },
      },
    ];

    for (const testCase of cases) {
      const provider = createMockProvider({ clock: clock.now, requestBudget: 3, retryLimit: 2 });
      const result = await provider.execute({ outcome: testCase.outcome, usage: customUsage });

      expect(result).toMatchObject({
        attempts: testCase.expected.attempts,
        code: testCase.expected.code,
        disposition: testCase.expected.disposition,
      });
      expect(result.artifact.finishedAt).toBe(clock.now);
      expect(result.artifact.requestCount).toBe(testCase.expected.requestCount);
      expect(result.artifact.requestCount).toBeLessThanOrEqual(3);
      expect(result.artifact.usage.totalTokens).toBe(testCase.expected.totalTokens);
      expect(result.artifact.events.map(({ kind }) => kind)).toEqual(testCase.expected.eventKinds);
    }

    const noBudgetProvider = createMockProvider({
      clock: clock.now,
      requestBudget: 0,
      retryLimit: 2,
    });
    const noBudgetResult = await noBudgetProvider.execute({ outcome: "success" });
    expect(noBudgetResult).toMatchObject({
      attempts: 0,
      code: "budget-exhausted",
      disposition: "abstain",
    });

    for (const invalidUsage of [
      { completionTokens: -1, promptTokens: 1, totalTokens: 0 },
      { completionTokens: Number.POSITIVE_INFINITY, promptTokens: 1, totalTokens: 1 },
      { completionTokens: 0.5, promptTokens: 1, totalTokens: 1.5 },
      { completionTokens: 1, promptTokens: 1, totalTokens: 3 },
    ]) {
      const invalidUsageResult = await createMockProvider({
        clock: clock.now,
        requestBudget: 3,
        retryLimit: 2,
      }).execute({ outcome: "usage", usage: invalidUsage });

      expect(invalidUsageResult).toMatchObject({
        attempts: 1,
        code: "invalid-usage",
        disposition: "abstain",
      });
      expect(invalidUsageResult.artifact.events).toEqual([
        { kind: "invalid-usage", reason: "usage-accounting-invalid" },
      ]);
      expect(invalidUsageResult.artifact.usage).toEqual({
        completionTokens: 0,
        promptTokens: 0,
        totalTokens: 0,
      });
    }

    const unknownOutcomeResult = await createMockProvider({
      clock: clock.now,
      requestBudget: 3,
      retryLimit: 2,
    }).execute({ outcome: "typo" as MockOutcome });
    expect(unknownOutcomeResult).toMatchObject({
      attempts: 0,
      code: "invalid-request",
      disposition: "abstain",
    });
    expect(unknownOutcomeResult.artifact.events).toEqual([
      { kind: "invalid-request", reason: "unknown-outcome" },
    ]);

    const replayOne = await createMockProvider({
      clock: clock.now,
      requestBudget: 3,
      retryLimit: 2,
    }).execute({
      outcome: "success",
    });
    const replayTwo = await createMockProvider({
      clock: clock.now,
      requestBudget: 3,
      retryLimit: 2,
    }).execute({
      outcome: "success",
    });
    expect(replayTwo).toEqual(replayOne);
  });

  it("replays the application call through an offline OpenAI-compatible transport", async () => {
    const transport = createOpenAICompatibleMockTransport({
      clock: "2026-08-10T00:00:00.000Z",
      requestBudget: 3,
      retryLimit: 2,
    });
    const client = createOpenRouterClient("fixture-only-key-not-a-secret", transport.fetch);

    const completion = await classifySupportTicket(client, "Synthetic billing question");

    expect(completion).toMatchObject({
      choices: [{ message: { content: '{"classification":"billing"}', role: "assistant" } }],
      model: "openai/gpt-4.1-mini",
      usage: { completion_tokens: 1, prompt_tokens: 9, total_tokens: 10 },
    });
    expect(transport.requests).toEqual([
      {
        endpoint: "/api/v1/chat/completions",
        method: "POST",
        model: "openai/gpt-4.1-mini",
        responseFormat: "json_object",
      },
    ]);

    const exhaustedTransport = createOpenAICompatibleMockTransport({
      clock: "2026-08-10T00:00:00.000Z",
      requestBudget: 0,
      retryLimit: 2,
    });
    const exhaustedClient = createOpenRouterClient(
      "fixture-only-key-not-a-secret",
      exhaustedTransport.fetch,
    );

    await expect(
      classifySupportTicket(exhaustedClient, "Synthetic billing question"),
    ).rejects.toMatchObject({ status: 429 });
    expect(exhaustedTransport.requests).toEqual([]);
  });

  it("keeps protected runtime markers out of logs, provider reports, and durable expected artifacts", async () => {
    const credentialMarker = ["golden", "credential", "marker"].join("-");
    const protectedOutputMarker = ["golden", "protected", "output"].join("-");
    const capturedLogs: unknown[][] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => {
      capturedLogs.push(values);
    });

    try {
      const result = await createMockProvider({
        clock: "2026-08-10T00:00:00.000Z",
        requestBudget: 3,
        retryLimit: 2,
      }).execute({
        outcome: "success",
        protectedInput: credentialMarker,
        untrustedModelOutput: protectedOutputMarker,
      });
      const durableArtifacts = (
        await Promise.all(["fixtures", "expected"].map(readDurableArtifactContents))
      ).flat();

      expect(JSON.stringify(result)).not.toContain(credentialMarker);
      expect(JSON.stringify(result)).not.toContain(protectedOutputMarker);
      expect(capturedLogs.flat().map(String).join("\n")).not.toContain(credentialMarker);
      expect(capturedLogs.flat().map(String).join("\n")).not.toContain(protectedOutputMarker);
      expect(durableArtifacts.join("\n")).not.toContain(credentialMarker);
      expect(durableArtifacts.join("\n")).not.toContain(protectedOutputMarker);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses redacted expected artifact shapes and semantic abstention rather than result snapshots", async () => {
    const [recommendation, abstention, staleSource] = await Promise.all([
      readJson<ExpectedSummary>("expected/recommendation-summary.json"),
      readJson<ExpectedSummary>("expected/abstention-report.json"),
      readJson<ExpectedSummary>("expected/stale-source-report.json"),
    ]);

    expect(recommendation).toMatchObject({
      artifactType: "golden-scenario-summary",
      disposition: "recommend",
      expectedPatch: { operation: "replace-model-literal" },
      redaction: { rawInputs: false, rawOutputs: false },
    });
    expect(abstention).toMatchObject({
      artifactType: "golden-scenario-summary",
      disposition: "abstain",
      patch: null,
      redaction: { rawInputs: false, rawOutputs: false },
    });
    expect(staleSource).toMatchObject({
      artifactType: "golden-scenario-summary",
      disposition: "refuse",
      patch: null,
      redaction: { rawInputs: false, rawOutputs: false },
    });
  });
});
