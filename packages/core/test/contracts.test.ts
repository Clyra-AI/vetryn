import { readFile, readdir } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  VETRYN_ARTIFACT_SCHEMA_VERSION,
  assertEvaluationInputDigest,
  assertRecommendationEvidence,
  canonicalizeArtifact,
  candidateRunSchema,
  createArtifactId,
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
  ],
  observedAt: "2026-08-10T00:00:00.000Z",
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
  source: "openrouter",
};

const candidateRun = {
  artifactType: "candidate-run",
  baselineModel: callSite.currentModel,
  callSiteId: callSite.id,
  candidateModel: "openai/gpt-4o",
  catalogSnapshotId: catalogSnapshot.id,
  evaluationInputDigest: digest("d"),
  id: "candidate-run:support-classification-openai-gpt-4o",
  metrics: {
    caseCount: 30,
    costUsd: "0.0300",
    errorCount: 0,
    failedCaseIds: [],
    p95LatencyMs: 420,
    passedCases: 30,
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
  evaluationInputDigest: candidateRun.evaluationInputDigest,
  id: "recommendation:support-classification-openai-gpt-4o",
  reasonCodes: ["quality-gates-passed", "cost-savings"],
  recommendedModel: candidateRun.candidateModel,
  schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
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

    expect(assertEvaluationInputDigest(parsedRun, candidateRun.evaluationInputDigest)).toEqual(
      parsedRun,
    );
    expect(() => assertEvaluationInputDigest(parsedRun, digest("e"))).toThrow(/stale/i);

    const incompleteRun = candidateRunSchema.parse({
      ...candidateRun,
      failureCode: "timeout",
      metrics: undefined,
      status: "incomplete",
    });
    const parsedRecommendation = parseRecommendation(recommendation);

    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [incompleteRun],
        candidateRun.evaluationInputDigest,
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
      ),
    ).toThrow(/call site/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ baselineModel: "openai/gpt-4.1-mini" })],
        candidateRun.evaluationInputDigest,
      ),
    ).toThrow(/baseline model/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ catalogSnapshotId: "catalog-snapshot:other-catalog" })],
        candidateRun.evaluationInputDigest,
      ),
    ).toThrow(/catalog snapshot/i);
    expect(() =>
      assertRecommendationEvidence(
        parsedRecommendation,
        [candidateRunWith({ candidateModel: "openai/gpt-4.1" })],
        candidateRun.evaluationInputDigest,
      ),
    ).toThrow(/recommended model/i);
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
