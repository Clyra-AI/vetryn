import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  VETRYN_ARTIFACT_SCHEMA_VERSION,
  assertCandidateRunExecutionRecord,
  assertCandidateRunPolicy,
  assertEvaluationInputDigest,
  assertPatchPlanEvidence,
  assertRecommendationArtifactConsistency,
  canonicalizeArtifact,
  candidateRunSchema,
  catalogSnapshotSchema,
  callSiteSchema,
  createArtifactId,
  createCatalogContentDigest,
  createCandidateRunContentDigest,
  evalSuiteSchema,
  parsePatchPlan,
  parseEvaluationExecutionRecord,
  parseRecommendation,
  parseVetrynArtifact,
} from "../src/index.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const sourceBinding = {
  adapter: "openai.chat.completions.create",
  file: "src/support/classify.ts",
  sourceFingerprint: digest("a"),
  symbol: "classifyTicket",
};

const callSite = {
  currentModel: "openai/gpt-4o-mini",
  evalSuiteId: "eval-suite:support-classification",
  gates: {
    maxP95LatencyMs: 750,
    minRecommendationConfidence: 0.8,
    maxQualityRegression: 0.01,
    minCases: 30,
    minPassRate: 0.98,
    minSavingsPercent: 20,
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
  requiredCapabilities: {
    structuredOutput: true,
    textGeneration: true,
    toolCalls: false,
  },
  representativeUsage: {
    completionTokens: 1,
    promptTokens: 9,
    provenanceRef: "reviewed-fixture:2026-08-10",
    reviewed: true,
  },
  sourceBinding,
};

const manifest = {
  artifactType: "call-site-manifest",
  callSites: [callSite],
  id: "call-site-manifest:sample-app",
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
};

const evalSuite = {
  artifactType: "eval-suite",
  callSiteId: callSite.id,
  caseCount: 30,
  fixtureDigest: digest("b"),
  fixturePath: ".vetryn/evals/support-classification.jsonl",
  id: "eval-suite:support-classification",
  redactionMode: "no-raw-inputs-or-outputs",
  reviewed: true,
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
};

const catalogModels = [
  {
    capabilities: {
      structuredOutput: true,
      textGeneration: true,
      toolCalls: false,
    },
    contextWindowTokens: 128000,
    id: "openai/gpt-4o-mini",
    inputPricePerMillionUsd: "0.15",
    outputPricePerMillionUsd: "0.60",
    modelAuthor: "openai",
    retired: false,
  },
  {
    capabilities: {
      structuredOutput: true,
      textGeneration: true,
      toolCalls: false,
    },
    contextWindowTokens: 128000,
    id: "openai/gpt-4o",
    inputPricePerMillionUsd: "2.50",
    outputPricePerMillionUsd: "10.00",
    modelAuthor: "openai",
    retired: false,
  },
];

const catalogSnapshot = {
  artifactType: "catalog-snapshot",
  contentDigest: createCatalogContentDigest(catalogModels),
  id: "catalog-snapshot:openrouter-2026-08-10",
  models: catalogModels,
  observedAt: "2026-08-10T00:00:00.000Z",
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
  source: "openrouter",
};

const candidateRouteAttempts = Array.from({ length: 30 }, (_, index) => ({
  attemptOrdinal: 1,
  caseOrdinal: index + 1,
  model: "openai/gpt-4o",
  providerName: "Azure",
  requestOrdinal: index + 1,
  repetitionOrdinal: 1,
  statusCode: 200,
}));

const candidateRun = {
  artifactType: "candidate-run",
  baselineModel: callSite.currentModel,
  baselineMetrics: {
    caseCount: 30,
    costUsd: "0.0600",
    errorCount: 0,
    failedCaseIds: [],
    p95LatencyMs: 600,
    passedCases: 30,
  },
  callSiteId: callSite.id,
  candidateModel: "openai/gpt-4o",
  catalogSnapshotId: catalogSnapshot.id,
  confidenceFloor: 0.8,
  evaluationInputDigest: digest("d"),
  evalSuiteId: evalSuite.id,
  executionRecordId: "execution-record:support-classification-openai-gpt-4o",
  fixtureDigest: evalSuite.fixtureDigest,
  id: "candidate-run:support-classification-openai-gpt-4o",
  gateOutcomes: {
    context: "pass",
    cost: "pass",
    latency: "pass",
    privacy: "pass",
    quality: "pass",
  },
  metrics: {
    caseCount: 30,
    costUsd: "0.0300",
    errorCount: 0,
    failedCaseIds: [],
    p95LatencyMs: 420,
    passedCases: 30,
  },
  provenance: {
    attemptCount: 1,
    completedAt: "2026-08-10T00:01:00.000Z",
    evaluator: {
      build: "git:348aa41",
      version: "0.1.0",
    },
    limits: {
      concurrency: 4,
      maxRequests: 100,
      maxSpendUsd: "1",
      retries: 2,
      timeoutMs: 30000,
    },
    observed: {
      providerRequestCount: 30,
      spendUsd: "0.03",
    },
    sampling: {
      maxOutputTokens: 128,
      seed: 42,
      temperature: 0,
    },
    scorer: {
      configurationDigest: digest("e"),
      id: "deterministic-assertions",
      version: "1.0.0",
    },
    startedAt: "2026-08-10T00:00:00.000Z",
    variance: {
      costUsdStdDev: "0",
      p95LatencyMsStdDev: 0,
      passRateStdDev: 0,
    },
  },
  routeObservation: {
    attempts: candidateRouteAttempts,
    requestCount: 30,
    selectedProvider: {
      model: "openai/gpt-4o",
      providerName: "Azure",
      providerSlug: "azure",
    },
    source: "openrouter-router-metadata",
  },
  routePolicy: callSite.routePolicy,
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
  status: "complete",
};

const recommendation = {
  artifactType: "recommendation",
  baselineModel: callSite.currentModel,
  callSiteId: callSite.id,
  candidateRunIds: [candidateRun.id],
  catalogSnapshotId: catalogSnapshot.id,
  confidence: 0.99,
  confidenceFloor: candidateRun.confidenceFloor,
  evaluationInputDigest: candidateRun.evaluationInputDigest,
  id: "recommendation:support-classification-openai-gpt-4o",
  limitations: ["aggregate-metrics-only", "no-production-canary"],
  reasonCodes: ["quality-gates-passed", "cost-savings"],
  recommendedModel: candidateRun.candidateModel,
  reproductionCommands: [
    { callSiteId: callSite.id, operation: "eval" },
    { callSiteId: callSite.id, operation: "recommend" },
  ],
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
  sourceBinding,
  status: "recommend",
};

const patchPlan = {
  artifactType: "patch-plan",
  callSiteId: callSite.id,
  expectedModel: callSite.currentModel,
  id: "patch-plan:support-classification-openai-gpt-4o",
  recommendationId: recommendation.id,
  recommendationStatus: "recommend",
  replacementModel: candidateRun.candidateModel,
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
  sourceBinding,
};

describe("V1 artifact contracts", () => {
  it("parses every versioned V1 artifact and canonicalizes keys deterministically", () => {
    const artifacts = [
      manifest,
      evalSuite,
      catalogSnapshot,
      candidateRun,
      recommendation,
      patchPlan,
    ];

    for (const artifact of artifacts) {
      expect(parseVetrynArtifact(artifact)).toMatchObject(artifact);
    }

    const reorderedManifest = {
      callSites: [...manifest.callSites],
      artifactType: manifest.artifactType,
      schemaVersion: manifest.schemaVersion,
      id: manifest.id,
    };

    expect(canonicalizeArtifact(reorderedManifest)).toBe(canonicalizeArtifact(manifest));
  });

  it("uses deterministic artifact IDs made only from safe stable parts", () => {
    expect(createArtifactId("candidate-run", ["support-classification", "openai-gpt-4o"])).toBe(
      "candidate-run:support-classification--openai-gpt-4o",
    );
    expect(() => createArtifactId("candidate-run", ["../../escape"])).toThrow(/stable ID/);
  });

  it("fails closed for unknown versions, extra fields, and impossible artifact states", () => {
    expect(() => parseVetrynArtifact({ ...manifest, schemaVersion: "2.0.0" })).toThrow(
      /schemaVersion/,
    );
    expect(() => parseVetrynArtifact({ ...manifest, apiKey: "not-allowed" })).toThrow(
      /unrecognized key/i,
    );
    expect(() =>
      parseVetrynArtifact({ ...manifest, callSites: [callSite, { ...callSite }] }),
    ).toThrow(/duplicate call-site ID/i);
    expect(() =>
      callSiteSchema.parse({ ...callSite, evalSuiteId: "candidate-run:not-an-eval-suite" }),
    ).toThrow(/eval-suite/i);
    expect(() =>
      parseVetrynArtifact({
        ...manifest,
        callSites: [
          { ...callSite, sourceBinding: { ...sourceBinding, file: "C:/Windows/System32" } },
        ],
      }),
    ).toThrow(/drive-qualified/i);
    expect(() => callSiteSchema.parse({ ...callSite, requiredCapabilities: undefined })).toThrow(
      /required.?capabilities/i,
    );
    expect(() => callSiteSchema.parse({ ...callSite, routePolicy: undefined })).toThrow(
      /routePolicy/i,
    );
    expect(() =>
      parseVetrynArtifact({ ...recommendation, recommendedModel: callSite.currentModel }),
    ).toThrow(/different/);
    expect(() => parseVetrynArtifact({ ...patchPlan, recommendationStatus: "no-change" })).toThrow(
      /recommendationStatus/,
    );
    expect(() =>
      parseVetrynArtifact({ ...candidateRun, failureCode: "timeout", status: "incomplete" }),
    ).toThrow(/cannot include promotable aggregate metrics/);
    expect(() =>
      parseVetrynArtifact({
        ...candidateRun,
        metrics: {
          ...candidateRun.metrics,
          caseCount: 2,
          failedCaseIds: ["case-a", "case-a"],
          passedCases: 0,
        },
      }),
    ).toThrow(/duplicate failed case ID/i);
    expect(() => parseVetrynArtifact({ ...candidateRun, baselineMetrics: undefined })).toThrow(
      /baseline metrics/i,
    );
    expect(() =>
      parseVetrynArtifact({
        ...catalogSnapshot,
        models: catalogSnapshot.models.map((model) =>
          model.id === "openai/gpt-4o" ? { ...model, retired: true } : model,
        ),
      }),
    ).toThrow(/content.?digest/i);
    expect(
      catalogSnapshotSchema.parse({
        ...catalogSnapshot,
        models: [...catalogSnapshot.models].reverse(),
      }).contentDigest,
    ).toBe(catalogSnapshot.contentDigest);
    const catalogWithMismatchedProvider = catalogSnapshot.models.map((model) =>
      model.id === "openai/gpt-4o" ? { ...model, modelAuthor: "other-provider" } : model,
    );
    expect(() =>
      catalogSnapshotSchema.parse({
        ...catalogSnapshot,
        contentDigest: createCatalogContentDigest(catalogWithMismatchedProvider),
        models: catalogWithMismatchedProvider,
      }),
    ).toThrow(/author segment/i);
    expect(() => parseVetrynArtifact({ ...candidateRun, gateOutcomes: undefined })).toThrow(
      /hard-gate outcomes/i,
    );
    expect(() => parseVetrynArtifact({ ...candidateRun, provenance: undefined })).toThrow(
      /provenance/i,
    );
    expect(() =>
      parseVetrynArtifact({
        ...candidateRun,
        baselineMetrics: { ...candidateRun.baselineMetrics, caseCount: 29 },
      }),
    ).toThrow(/same evaluated case count/i);
    expect(() =>
      parseVetrynArtifact({
        ...candidateRun,
        metrics: { ...candidateRun.metrics, costUsd: "1".repeat(101) },
      }),
    ).toThrow(/100 characters/i);
    expect(() => parseVetrynArtifact({ ...recommendation, confidence: 0.79 })).toThrow(
      /confidence floor/i,
    );
    expect(() =>
      parseVetrynArtifact({ ...recommendation, reasonCodes: ["privacy-failed"] }),
    ).toThrow(/reasonCodes/i);
    expect(() => parseVetrynArtifact({ ...recommendation, limitations: undefined })).toThrow(
      /limitations/i,
    );
    expect(() =>
      parseVetrynArtifact({
        ...recommendation,
        reproductionCommands: [
          { callSiteId: callSite.id, operation: "eval", token: "super-secret" },
        ],
      }),
    ).toThrow(/unrecognized key/i);
    expect(() =>
      parseVetrynArtifact({
        ...recommendation,
        reproductionCommands: [{ callSiteId: "another-call-site", operation: "eval" }],
      }),
    ).toThrow(/recommendation call site/i);
    expect(() =>
      parseVetrynArtifact({
        ...recommendation,
        recommendedModel: undefined,
        reasonCodes: ["cost-savings"],
        status: "regression",
      }),
    ).toThrow(/not valid for regression/i);
    expect(() =>
      parseVetrynArtifact({
        ...candidateRun,
        provenance: {
          ...candidateRun.provenance,
          completedAt: "2026-08-09T23:59:59.000Z",
        },
      }),
    ).toThrow(/complete before it starts/i);
  });

  it("excludes credentials and raw protected inputs or outputs by construction", () => {
    expect(() => parseVetrynArtifact({ ...manifest, prompt: "customer secret" })).toThrow(
      /unrecognized key/i,
    );
    expect(() => parseVetrynArtifact({ ...evalSuite, output: "protected model response" })).toThrow(
      /unrecognized key/i,
    );
    expect(() => parseVetrynArtifact({ ...candidateRun, credential: "secret" })).toThrow(
      /unrecognized key/i,
    );
  });

  it("binds candidate runs to immutable runner-owned execution records", () => {
    const record = parseEvaluationExecutionRecord({
      artifactContentDigest: createCandidateRunContentDigest(candidateRun),
      artifactType: "evaluation-execution-record",
      candidateRunId: candidateRun.id,
      catalogRefreshLineageDigest: digest("f"),
      completedAt: candidateRun.provenance.completedAt,
      evaluationInputDigest: candidateRun.evaluationInputDigest,
      id: candidateRun.executionRecordId,
      runner: { id: "vetryn-evaluator", ...candidateRun.provenance.evaluator },
      schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
      startedAt: candidateRun.provenance.startedAt,
    });

    expect(assertCandidateRunExecutionRecord(candidateRun, record)).toEqual(record);
    expect(() =>
      assertCandidateRunExecutionRecord(candidateRun, {
        ...record,
        completedAt: "2026-08-10T00:02:00.000Z",
      }),
    ).toThrow(/timestamps/i);
    expect(() =>
      assertCandidateRunExecutionRecord(candidateRun, {
        ...record,
        artifactContentDigest: digest("0"),
      }),
    ).toThrow(/content/i);
    const withoutRecord = { ...candidateRun } as Partial<typeof candidateRun>;
    Reflect.deleteProperty(withoutRecord, "executionRecordId");
    expect(() => parseVetrynArtifact(withoutRecord)).toThrow(/executionRecordId/i);
  });

  it("rejects stale evaluation evidence before it can support a recommendation", () => {
    const parsedRun = candidateRunSchema.parse(candidateRun);
    const parsedCallSite = callSiteSchema.parse(callSite);
    const parsedEvalSuite = evalSuiteSchema.parse(evalSuite);
    const parsedCatalogSnapshot = catalogSnapshotSchema.parse(catalogSnapshot);

    const defaultGates = { ...callSite.gates };
    Reflect.deleteProperty(defaultGates, "minRecommendationConfidence");
    expect(callSiteSchema.parse({ ...callSite, gates: defaultGates }).gates).toMatchObject({
      minRecommendationConfidence: 0.8,
    });

    expect(assertCandidateRunPolicy(parsedRun, parsedCallSite)).toEqual(parsedRun);
    expect(() =>
      assertCandidateRunPolicy(
        candidateRunSchema.parse({ ...candidateRun, confidenceFloor: 0.7 }),
        parsedCallSite,
      ),
    ).toThrow(/confidence floor/i);

    expect(assertEvaluationInputDigest(parsedRun, candidateRun.evaluationInputDigest)).toEqual(
      parsedRun,
    );
    expect(() => assertEvaluationInputDigest(parsedRun, digest("e"))).toThrow(/stale/i);

    const incompleteRun = candidateRunSchema.parse({
      ...candidateRun,
      baselineMetrics: undefined,
      failureCode: "timeout",
      gateOutcomes: undefined,
      metrics: undefined,
      status: "incomplete",
    });
    const parsedRecommendation = parseRecommendation(recommendation);

    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun, parsedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/duplicate candidate run ID/i);

    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [incompleteRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/cannot use incomplete candidate run/);

    const candidateRunWith = (overrides: Record<string, unknown>) =>
      candidateRunSchema.parse({
        ...candidateRun,
        ...overrides,
      });

    const variableQualityRun = candidateRunWith({
      provenance: {
        ...candidateRun.provenance,
        variance: { ...candidateRun.provenance.variance, passRateStdDev: 0.02 },
      },
    });
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [variableQualityRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/evidence-bound quality lower bound/i);
    expect(
      assertRecommendationArtifactConsistency(
        parseRecommendation({ ...recommendation, confidence: 0.98 }),
        [variableQualityRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toMatchObject({ confidence: 0.98 });

    const boundaryCallSite = callSiteSchema.parse({
      ...callSite,
      gates: {
        ...callSite.gates,
        maxQualityRegression: 0.8,
        minPassRate: 0,
        minRecommendationConfidence: 0.1,
      },
    });
    const boundaryRun = candidateRunWith({
      confidenceFloor: 0.1,
      metrics: {
        ...candidateRun.metrics,
        failedCaseIds: Array.from({ length: 21 }, (_, index) => `case-${index + 1}`),
        passedCases: 9,
      },
      provenance: {
        ...candidateRun.provenance,
        variance: { ...candidateRun.provenance.variance, passRateStdDev: 0.2 },
      },
    });
    expect(
      assertRecommendationArtifactConsistency(
        parseRecommendation({ ...recommendation, confidence: 0.1, confidenceFloor: 0.1 }),
        [boundaryRun],
        candidateRun.evaluationInputDigest,
        boundaryCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toMatchObject({ confidence: 0.1 });

    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [candidateRunWith({ callSiteId: "other-call-site" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/call site/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [candidateRunWith({ baselineModel: "openai/gpt-4.1-mini" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/baseline model/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [candidateRunWith({ catalogSnapshotId: "catalog-snapshot:other-catalog" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/catalog snapshot/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [
          candidateRunWith({
            candidateModel: "openai/gpt-4.1",
            routeObservation: {
              ...candidateRun.routeObservation,
              attempts: candidateRun.routeObservation.attempts.map((attempt) => ({
                ...attempt,
                model: "openai/gpt-4.1",
              })),
              selectedProvider: {
                ...candidateRun.routeObservation.selectedProvider,
                model: "openai/gpt-4.1",
              },
            },
          }),
        ],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/recommended model/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [candidateRunWith({ confidenceFloor: 0.7 })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/confidence floor/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [
          candidateRunWith({
            gateOutcomes: { ...candidateRun.gateOutcomes, quality: "fail" },
            metrics: {
              ...candidateRun.metrics,
              failedCaseIds: ["case-1"],
              passedCases: 29,
            },
          }),
        ],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/hard gate/i);

    const abstention = parseRecommendation({
      ...recommendation,
      id: "recommendation:support-classification-no-change",
      reasonCodes: ["candidate-regressed"],
      recommendedModel: undefined,
      status: "no-change",
    });
    expect(() =>
      assertRecommendationArtifactConsistency(
        abstention,
        [candidateRunWith({ callSiteId: "other-call-site" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/call site/i);

    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [
          candidateRunWith({
            metrics: {
              ...candidateRun.metrics,
              failedCaseIds: Array.from({ length: 30 }, (_, index) => `case-${index + 1}`),
              passedCases: 0,
            },
          }),
        ],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/quality gate outcome/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [candidateRunWith({ metrics: { ...candidateRun.metrics, costUsd: "0.0600" } })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/cost gate outcome/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [candidateRunWith({ metrics: { ...candidateRun.metrics, p95LatencyMs: 800 } })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/latency gate outcome/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        catalogSnapshotSchema.parse({
          ...catalogSnapshot,
          models: catalogSnapshot.models.filter(
            (model) => model.id !== candidateRun.candidateModel,
          ),
          contentDigest: createCatalogContentDigest(
            catalogSnapshot.models.filter((model) => model.id !== candidateRun.candidateModel),
          ),
        }),
      ),
    ).toThrow(/missing candidate model/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        catalogSnapshotSchema.parse({
          ...catalogSnapshot,
          models: catalogSnapshot.models.map((model) =>
            model.id === candidateRun.candidateModel ? { ...model, retired: true } : model,
          ),
          contentDigest: createCatalogContentDigest(
            catalogSnapshot.models.map((model) =>
              model.id === candidateRun.candidateModel ? { ...model, retired: true } : model,
            ),
          ),
        }),
      ),
    ).toThrow(/retired/i);
    const approvedCandidate = catalogSnapshot.models.find(
      (model) => model.id === candidateRun.candidateModel,
    );
    if (approvedCandidate === undefined) throw new Error("Missing candidate test fixture.");
    const unapprovedCandidate = {
      ...approvedCandidate,
      id: "other-provider/gpt-4o",
      modelAuthor: "other-provider",
    };
    const candidateFromUnapprovedProvider = catalogSnapshot.models.map((model) =>
      model.id === candidateRun.candidateModel ? unapprovedCandidate : model,
    );
    const unapprovedRun = candidateRunWith({
      candidateModel: unapprovedCandidate.id,
      routeObservation: {
        ...candidateRun.routeObservation,
        attempts: candidateRun.routeObservation.attempts.map((attempt) => ({
          ...attempt,
          model: unapprovedCandidate.id,
        })),
        selectedProvider: {
          ...candidateRun.routeObservation.selectedProvider,
          model: unapprovedCandidate.id,
        },
      },
    });
    const unapprovedRecommendation = parseRecommendation({
      ...recommendation,
      recommendedModel: unapprovedCandidate.id,
    });
    expect(() =>
      assertRecommendationArtifactConsistency(
        unapprovedRecommendation,
        [unapprovedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        catalogSnapshotSchema.parse({
          ...catalogSnapshot,
          contentDigest: createCatalogContentDigest(candidateFromUnapprovedProvider),
          models: candidateFromUnapprovedProvider,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [candidateRunWith({ gateOutcomes: { ...candidateRun.gateOutcomes, privacy: "fail" } })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/privacy gate outcome/i);
    const candidateWithoutStructuredOutput = catalogSnapshot.models.map((model) =>
      model.id === candidateRun.candidateModel
        ? { ...model, capabilities: { ...model.capabilities, structuredOutput: false } }
        : model,
    );
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedEvalSuite,
        catalogSnapshotSchema.parse({
          ...catalogSnapshot,
          contentDigest: createCatalogContentDigest(candidateWithoutStructuredOutput),
          models: candidateWithoutStructuredOutput,
        }),
      ),
    ).toThrow(/structuredOutput/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        {
          ...parsedCallSite,
          requiredCapabilities: { ...parsedCallSite.requiredCapabilities, toolCalls: true },
        },
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/toolCalls/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        { ...parsedCallSite, sourceBinding: { ...sourceBinding, symbol: "otherCallSite" } },
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/source binding/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        { ...parsedCallSite, evalSuiteId: "eval-suite:other-reviewed-suite" },
        parsedEvalSuite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/manifest/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        evalSuiteSchema.parse({ ...evalSuite, caseCount: 29 }),
        parsedCatalogSnapshot,
      ),
    ).toThrow(/case count/i);
    expect(() =>
      assertRecommendationArtifactConsistency(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        evalSuiteSchema.parse({ ...evalSuite, fixtureDigest: digest("f") }),
        parsedCatalogSnapshot,
      ),
    ).toThrow(/fixture binding/i);

    const parsedPatchPlan = parsePatchPlan(patchPlan);
    expect(assertPatchPlanEvidence(parsedPatchPlan, parsedRecommendation)).toEqual(parsedPatchPlan);
    expect(() =>
      assertPatchPlanEvidence(
        parsePatchPlan({ ...patchPlan, recommendationId: "recommendation:another-run" }),
        parsedRecommendation,
      ),
    ).toThrow(/different recommendation/i);
    expect(() =>
      assertPatchPlanEvidence(
        parsePatchPlan({ ...patchPlan, callSiteId: "other-call-site" }),
        parsedRecommendation,
      ),
    ).toThrow(/call site/i);
    expect(() =>
      assertPatchPlanEvidence(
        parsePatchPlan({ ...patchPlan, expectedModel: "openai/gpt-4.1" }),
        parsedRecommendation,
      ),
    ).toThrow(/expected model/i);
    expect(() =>
      assertPatchPlanEvidence(
        parsePatchPlan({ ...patchPlan, replacementModel: "openai/gpt-4.1" }),
        parsedRecommendation,
      ),
    ).toThrow(/replacement model/i);
    expect(() =>
      assertPatchPlanEvidence(
        parsePatchPlan({
          ...patchPlan,
          sourceBinding: { ...sourceBinding, symbol: "anotherCallSite" },
        }),
        parsedRecommendation,
      ),
    ).toThrow(/source binding/i);
  });

  it("requires request-bound route policy and reconciled router observations", () => {
    expect(() =>
      candidateRunSchema.parse({ ...candidateRun, routeObservation: undefined }),
    ).toThrow(/routing metadata/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        routeObservation: { ...candidateRun.routeObservation, selectedProvider: null },
      }),
    ).toThrow(/selected OpenRouter provider/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        baselineMetrics: undefined,
        failureCode: "provider-error",
        gateOutcomes: undefined,
        metrics: undefined,
        routeObservation: {
          ...candidateRun.routeObservation,
          attempts: candidateRun.routeObservation.attempts.map((attempt) => ({
            ...attempt,
            statusCode: 503,
          })),
          selectedProvider: null,
        },
        status: "failed",
      }),
    ).not.toThrow();
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        baselineMetrics: undefined,
        failureCode: "provider-error",
        gateOutcomes: undefined,
        metrics: undefined,
        routeObservation: { ...candidateRun.routeObservation, selectedProvider: null },
        status: "failed",
      }),
    ).toThrow(/successful attempt must identify/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        routeObservation: {
          ...candidateRun.routeObservation,
          selectedProvider: {
            ...candidateRun.routeObservation.selectedProvider,
            providerName: "Other",
          },
        },
      }),
    ).toThrow(/exactly one successful attempt/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        routeObservation: {
          ...candidateRun.routeObservation,
          selectedProvider: {
            ...candidateRun.routeObservation.selectedProvider,
            providerSlug: "deepinfra",
          },
        },
      }),
    ).toThrow(/requested provider slug/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        routeObservation: {
          ...candidateRun.routeObservation,
          attempts: candidateRun.routeObservation.attempts.map((attempt) => ({
            ...attempt,
            providerName: "OpenAI",
          })),
          selectedProvider: {
            ...candidateRun.routeObservation.selectedProvider,
            providerName: "OpenAI",
          },
        },
      }),
    ).toThrow(/provider name must match/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        routeObservation: {
          ...candidateRun.routeObservation,
          attempts: candidateRun.routeObservation.attempts.slice(0, 29),
          requestCount: 29,
        },
      }),
    ).toThrow(/caseCount times evaluator attemptCount/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        provenance: { ...candidateRun.provenance, attemptCount: 2 },
      }),
    ).toThrow(/caseCount times evaluator attemptCount/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        routeObservation: {
          ...candidateRun.routeObservation,
          attempts: candidateRun.routeObservation.attempts.map((attempt, index) =>
            index === candidateRun.routeObservation.attempts.length - 1
              ? { ...attempt, caseOrdinal: 1 }
              : attempt,
          ),
        },
      }),
    ).toThrow(/cover each case and evaluator repetition exactly once/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        routeObservation: {
          ...candidateRun.routeObservation,
          attempts: [
            candidateRun.routeObservation.attempts[0],
            { ...candidateRun.routeObservation.attempts[0], attemptOrdinal: 3, statusCode: 500 },
          ],
        },
      }),
    ).toThrow(/contiguous/i);
    expect(() =>
      candidateRunSchema.parse({
        ...candidateRun,
        routeObservation: {
          ...candidateRun.routeObservation,
          attempts: candidateRun.routeObservation.attempts.map((attempt) => ({
            ...attempt,
            statusCode: 500,
          })),
        },
      }),
    ).toThrow(/exactly one successful attempt/i);

    const parsedRun = candidateRunSchema.parse(candidateRun);
    const parsedCallSite = callSiteSchema.parse(callSite);
    expect(() =>
      assertCandidateRunPolicy(
        candidateRunSchema.parse({
          ...candidateRun,
          routePolicy: { ...candidateRun.routePolicy, providerSlug: "deepinfra" },
          routeObservation: {
            ...candidateRun.routeObservation,
            attempts: candidateRun.routeObservation.attempts.map((attempt) => ({
              ...attempt,
              providerName: "DeepInfra",
            })),
            selectedProvider: {
              ...candidateRun.routeObservation.selectedProvider,
              providerName: "DeepInfra",
              providerSlug: "deepinfra",
            },
          },
        }),
        parsedCallSite,
      ),
    ).toThrow(/route policy/i);
    expect(assertCandidateRunPolicy(parsedRun, parsedCallSite)).toEqual(parsedRun);
  });

  it("keeps every core source file free of provider and side-effect system integrations", async () => {
    const sourceDirectory = new URL("../src/", import.meta.url);
    const sourceNames = await readdir(sourceDirectory);
    const sources = await Promise.all(
      sourceNames
        .filter((name) => name.endsWith(".ts"))
        .map(async (name) => readFile(new URL(name, sourceDirectory), "utf8")),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/from ["']node:(?!crypto["'])/);
      expect(source).not.toMatch(/from ["']openai|from ["']@octokit|typescript/);
    }
  });
});
