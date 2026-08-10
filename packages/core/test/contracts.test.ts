import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  VETRYN_ARTIFACT_SCHEMA_VERSION,
  assertCandidateRunPolicy,
  assertEvaluationInputDigest,
  assertPatchPlanEvidence,
  assertRecommendationEvidence,
  canonicalizeArtifact,
  candidateRunSchema,
  catalogSnapshotSchema,
  callSiteSchema,
  createArtifactId,
  parsePatchPlan,
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
  evalSuiteId: "support-classification-eval",
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

const catalogSnapshot = {
  artifactType: "catalog-snapshot",
  contentDigest: digest("c"),
  id: "catalog-snapshot:openrouter-2026-08-10",
  models: [
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
      provider: "openai",
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
      provider: "openai",
      retired: false,
    },
  ],
  observedAt: "2026-08-10T00:00:00.000Z",
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
  source: "openrouter",
};

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
  reasonCodes: ["quality-gates-passed", "cost-savings"],
  recommendedModel: candidateRun.candidateModel,
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

  it("rejects stale evaluation evidence before it can support a recommendation", () => {
    const parsedRun = candidateRunSchema.parse(candidateRun);
    const parsedCallSite = callSiteSchema.parse(callSite);
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
      assertRecommendationEvidence(
        parsedRecommendation,
        [incompleteRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/cannot use incomplete candidate run/);

    const candidateRunWith = (overrides: Record<string, unknown>) =>
      candidateRunSchema.parse({
        ...candidateRun,
        ...overrides,
      });

    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ callSiteId: "other-call-site" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/call site/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ baselineModel: "openai/gpt-4.1-mini" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/baseline model/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ catalogSnapshotId: "catalog-snapshot:other-catalog" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/catalog snapshot/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ candidateModel: "openai/gpt-4.1" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/recommended model/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ confidenceFloor: 0.7 })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/confidence floor/i);
    expect(() =>
      assertRecommendationEvidence(
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
      assertRecommendationEvidence(
        abstention,
        [candidateRunWith({ callSiteId: "other-call-site" })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/call site/i);

    expect(() =>
      assertRecommendationEvidence(
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
        parsedCatalogSnapshot,
      ),
    ).toThrow(/quality gate outcome/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ metrics: { ...candidateRun.metrics, costUsd: "0.0600" } })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/cost gate outcome/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ metrics: { ...candidateRun.metrics, p95LatencyMs: 800 } })],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        parsedCatalogSnapshot,
      ),
    ).toThrow(/latency gate outcome/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        catalogSnapshotSchema.parse({
          ...catalogSnapshot,
          models: catalogSnapshot.models.filter(
            (model) => model.id !== candidateRun.candidateModel,
          ),
        }),
      ),
    ).toThrow(/missing candidate model/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        parsedCallSite,
        catalogSnapshotSchema.parse({
          ...catalogSnapshot,
          models: catalogSnapshot.models.map((model) =>
            model.id === candidateRun.candidateModel ? { ...model, retired: true } : model,
          ),
        }),
      ),
    ).toThrow(/not compatible/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [parsedRun],
        candidateRun.evaluationInputDigest,
        { ...parsedCallSite, sourceBinding: { ...sourceBinding, symbol: "otherCallSite" } },
        parsedCatalogSnapshot,
      ),
    ).toThrow(/source binding/i);

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

  it("keeps every core source file free of runtime side-effect imports", async () => {
    const sourceDirectory = new URL("../src/", import.meta.url);
    const sourceNames = await readdir(sourceDirectory);
    const sources = await Promise.all(
      sourceNames
        .filter((name) => name.endsWith(".ts"))
        .map(async (name) => readFile(new URL(name, sourceDirectory), "utf8")),
    );

    for (const source of sources) {
      expect(source).not.toMatch(/from ["']node:|from ["']openai|from ["']@octokit|typescript/);
    }
  });
});
