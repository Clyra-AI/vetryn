import { createHash } from "node:crypto";

import { z } from "zod";

export const VETRYN_ARTIFACT_SCHEMA_VERSION = "1.0.0" as const;

const artifactTypes = [
  "call-site-manifest",
  "eval-suite",
  "catalog-snapshot",
  "candidate-run",
  "recommendation",
  "patch-plan",
] as const;

export const artifactTypeSchema = z.enum(artifactTypes);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

const stableIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case stable ID.");
const artifactIdSchema = z
  .string()
  .regex(
    /^(?:call-site-manifest|eval-suite|catalog-snapshot|candidate-run|recommendation|patch-plan):[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:--[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/,
    "Use a deterministic Vetryn artifact ID.",
  );
const evalSuiteArtifactIdSchema = artifactIdSchema.refine(
  (value) => value.startsWith("eval-suite:"),
  "Use an eval-suite artifact ID.",
);
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "Use a sha256 digest.");
const decimalSchema = z
  .string()
  .max(100, "Decimal values are limited to 100 characters.")
  .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/, "Use a canonical non-negative decimal string.");
const confidenceSchema = z.number().finite().min(0).max(1);
const confidenceComparisonTolerance = Number.EPSILON * 4;
const modelIdSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._:-]*)+$/,
    "Use a canonical provider/model ID.",
  );
const repositoryPathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[a-zA-Z]:/.test(value) &&
      !value.includes("\\") &&
      !value.split("/").includes("..") &&
      !value.includes("\u0000"),
    "Use a relative repository path without traversal or a drive-qualified prefix.",
  );
const opaqueReferenceSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*:[a-zA-Z0-9._:-]+$/, "Use a compact opaque reference.");
const recommendationReasonCodes = [
  "budget-exhausted",
  "candidate-regressed",
  "candidate-timeout",
  "capability-incompatible",
  "confidence-below-floor",
  "context-incompatible",
  "contradictory-evidence",
  "cost-regression",
  "cost-savings",
  "error-regression",
  "insufficient-cases",
  "latency-regression",
  "no-better-candidate",
  "privacy-incompatible",
  "provider-failure",
  "quality-gates-passed",
  "quality-regression",
] as const;
const recommendationReasonCodeSchema = z.enum(recommendationReasonCodes);
type RecommendationReasonCode = z.infer<typeof recommendationReasonCodeSchema>;
const recommendationLimitationCodes = [
  "aggregate-metrics-only",
  "no-production-canary",
  "representative-eval-suite-only",
] as const;
const recommendationLimitationCodeSchema = z.enum(recommendationLimitationCodes);
const reproductionCommandSchema = z
  .object({
    callSiteId: stableIdSchema,
    operation: z.enum(["eval", "recommend"]),
  })
  .strict();
const capabilityNames = ["textGeneration", "structuredOutput", "toolCalls"] as const;

const artifactEnvelope = {
  id: artifactIdSchema,
  schemaVersion: z.literal(VETRYN_ARTIFACT_SCHEMA_VERSION),
};

export const sourceBindingSchema = z
  .object({
    adapter: z.string().min(1),
    file: repositoryPathSchema,
    symbol: z.string().min(1),
  })
  .strict();

export type SourceBinding = z.infer<typeof sourceBindingSchema>;

export const boundSourceBindingSchema = sourceBindingSchema
  .extend({
    sourceFingerprint: digestSchema,
  })
  .strict();

export type BoundSourceBinding = z.infer<typeof boundSourceBindingSchema>;

export const evaluationGatesSchema = z
  .object({
    maxP95LatencyMs: z.number().int().positive().optional(),
    maxQualityRegression: z.number().min(0).max(1).default(0),
    minCases: z.number().int().positive().default(30),
    minPassRate: z.number().min(0).max(1),
    minRecommendationConfidence: confidenceSchema.default(0.8),
    minSavingsPercent: z.number().min(0).max(100).default(0),
  })
  .strict();

export type EvaluationGates = z.infer<typeof evaluationGatesSchema>;

export const representativeUsageSchema = z
  .object({
    completionTokens: z.number().finite().nonnegative(),
    promptTokens: z.number().finite().nonnegative(),
    provenanceRef: opaqueReferenceSchema,
    reviewed: z.literal(true),
  })
  .strict()
  .refine(
    ({ completionTokens, promptTokens }) => completionTokens > 0 || promptTokens > 0,
    "Representative usage must include prompt or completion tokens.",
  );

export type RepresentativeUsage = z.infer<typeof representativeUsageSchema>;

export const callSiteCapabilityRequirementsSchema = z
  .object({
    structuredOutput: z.boolean(),
    textGeneration: z.literal(true),
    toolCalls: z.boolean(),
  })
  .strict();

export type CallSiteCapabilityRequirements = z.infer<typeof callSiteCapabilityRequirementsSchema>;

export const providerPolicySchema = z
  .object({
    allowedProviders: z.array(stableIdSchema).min(1),
  })
  .strict()
  .superRefine((policy, context) =>
    assertUniqueValues(policy.allowedProviders, context, "approved provider", ["allowedProviders"]),
  );

export type ProviderPolicy = z.infer<typeof providerPolicySchema>;

export const callSiteSpecSchema = z
  .object({
    binding: sourceBindingSchema,
    evalFixture: repositoryPathSchema,
    gates: evaluationGatesSchema,
    id: stableIdSchema,
    name: z.string().min(1),
    owner: z.string().min(1),
    providerPolicy: providerPolicySchema,
    requiredCapabilities: callSiteCapabilityRequirementsSchema,
  })
  .strict();

export type CallSiteSpec = z.infer<typeof callSiteSpecSchema>;

export function parseCallSiteSpec(value: unknown): CallSiteSpec {
  return parseWithDiagnostics(callSiteSpecSchema, "call-site specification", value);
}

export const callSiteSchema = z
  .object({
    currentModel: modelIdSchema,
    evalSuiteId: evalSuiteArtifactIdSchema,
    gates: evaluationGatesSchema,
    id: stableIdSchema,
    name: z.string().min(1),
    owner: z.string().min(1),
    providerPolicy: providerPolicySchema,
    requiredCapabilities: callSiteCapabilityRequirementsSchema,
    representativeUsage: representativeUsageSchema,
    sourceBinding: boundSourceBindingSchema,
  })
  .strict();

export type CallSite = z.infer<typeof callSiteSchema>;

export const callSiteManifestSchema = z
  .object({
    artifactType: z.literal("call-site-manifest"),
    callSites: z.array(callSiteSchema).min(1),
    ...artifactEnvelope,
  })
  .strict()
  .superRefine((artifact, context) => {
    assertArtifactIdPrefix(artifact, context, "call-site-manifest");
    assertUniqueValues(
      artifact.callSites.map((callSite) => callSite.id),
      context,
      "call-site ID",
      ["callSites"],
    );
  });

export type CallSiteManifest = z.infer<typeof callSiteManifestSchema>;

export interface InitializeCallSiteManifestOptions {
  readonly callSite: unknown;
  readonly existingManifest?: unknown;
  readonly manifestId?: string;
}

export function initializeCallSiteManifest({
  callSite: callSiteInput,
  existingManifest,
  manifestId,
}: InitializeCallSiteManifestOptions): CallSiteManifest {
  const callSite = callSiteSchema.parse(callSiteInput);
  const existing =
    existingManifest === undefined ? undefined : parseCallSiteManifest(existingManifest);

  if (existing === undefined) {
    if (manifestId === undefined) {
      throw new VetrynContractError(
        "Manifest initialization requires an explicit human-owned manifest ID.",
      );
    }

    return parseCallSiteManifest({
      artifactType: "call-site-manifest",
      callSites: [callSite],
      id: manifestId,
      schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
    });
  }

  if (manifestId !== undefined && manifestId !== existing.id) {
    throw new VetrynContractError(
      "Manifest initialization cannot silently rename an existing manifest ID.",
    );
  }

  const existingCallSite = existing.callSites.find(({ id }) => id === callSite.id);
  if (existingCallSite !== undefined) {
    if (canonicalizeJson(existingCallSite) !== canonicalizeJson(callSite)) {
      throw new VetrynContractError(
        `Call-site ID collision for ${callSite.id}; edit the human-owned manifest explicitly.`,
      );
    }

    return existing;
  }

  return parseCallSiteManifest({
    ...existing,
    callSites: [...existing.callSites, callSite].toSorted((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    ),
  });
}

export const evalSuiteSchema = z
  .object({
    artifactType: z.literal("eval-suite"),
    callSiteId: stableIdSchema,
    caseCount: z.number().int().positive(),
    fixtureDigest: digestSchema,
    fixturePath: repositoryPathSchema,
    ...artifactEnvelope,
    redactionMode: z.literal("no-raw-inputs-or-outputs"),
    reviewed: z.literal(true),
  })
  .strict()
  .superRefine((artifact, context) => assertArtifactIdPrefix(artifact, context, "eval-suite"));

export type EvalSuite = z.infer<typeof evalSuiteSchema>;

const catalogModelSchema = z
  .object({
    capabilities: z
      .object({
        structuredOutput: z.boolean(),
        textGeneration: z.boolean(),
        toolCalls: z.boolean(),
      })
      .strict(),
    contextWindowTokens: z.number().int().positive(),
    id: modelIdSchema,
    inputPricePerMillionUsd: decimalSchema,
    outputPricePerMillionUsd: decimalSchema,
    provider: stableIdSchema,
    retired: z.boolean(),
  })
  .strict()
  .superRefine((model, context) => {
    const providerFromModelId = model.id.split("/", 1)[0];

    if (model.provider !== providerFromModelId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Catalog model provider must match the canonical model ID provider segment.",
        path: ["provider"],
      });
    }
  });

export type CatalogModel = z.infer<typeof catalogModelSchema>;

export function createCatalogContentDigest(models: readonly CatalogModel[]): string {
  const normalizedModels = [...models].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const content = canonicalizeJson(normalizedModels);
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

export const catalogSnapshotSchema = z
  .object({
    artifactType: z.literal("catalog-snapshot"),
    contentDigest: digestSchema,
    ...artifactEnvelope,
    models: z.array(catalogModelSchema).min(1),
    observedAt: z.string().datetime({ offset: true }),
    source: stableIdSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    assertArtifactIdPrefix(artifact, context, "catalog-snapshot");
    assertUniqueValues(
      artifact.models.map((model) => model.id),
      context,
      "catalog model ID",
      ["models"],
    );
    if (artifact.contentDigest !== createCatalogContentDigest(artifact.models)) {
      context.addIssue({
        code: "custom",
        message: "Catalog snapshot contentDigest must match normalized model content.",
        path: ["contentDigest"],
      });
    }
  });

export type CatalogSnapshot = z.infer<typeof catalogSnapshotSchema>;

const candidateMetricsSchema = z
  .object({
    caseCount: z.number().int().positive(),
    costUsd: decimalSchema,
    errorCount: z.number().int().nonnegative(),
    failedCaseIds: z.array(stableIdSchema),
    p95LatencyMs: z.number().int().positive(),
    passedCases: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((metrics, context) => {
    assertUniqueValues(metrics.failedCaseIds, context, "failed case ID", ["failedCaseIds"]);

    if (
      metrics.passedCases + metrics.failedCaseIds.length + metrics.errorCount !==
      metrics.caseCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Candidate metrics must account for every evaluated case exactly once.",
        path: ["caseCount"],
      });
    }
  });

const hardGateOutcomesSchema = z
  .object({
    context: z.enum(["pass", "fail"]),
    cost: z.enum(["pass", "fail"]),
    latency: z.enum(["pass", "fail"]),
    privacy: z.enum(["pass", "fail"]),
    quality: z.enum(["pass", "fail"]),
  })
  .strict();

export type HardGateOutcomes = z.infer<typeof hardGateOutcomesSchema>;

const candidateRunProvenanceSchema = z
  .object({
    attemptCount: z.number().int().positive(),
    completedAt: z.string().datetime({ offset: true }),
    evaluator: z
      .object({
        build: opaqueReferenceSchema,
        version: z.string().min(1),
      })
      .strict(),
    sampling: z
      .object({
        maxOutputTokens: z.number().int().positive(),
        seed: z.number().int().nonnegative().nullable(),
        temperature: z.number().finite().min(0).max(2),
      })
      .strict(),
    scorer: z
      .object({
        configurationDigest: digestSchema,
        id: stableIdSchema,
        version: z.string().min(1),
      })
      .strict(),
    startedAt: z.string().datetime({ offset: true }),
    variance: z
      .object({
        costUsdStdDev: decimalSchema,
        p95LatencyMsStdDev: z.number().finite().nonnegative(),
        passRateStdDev: z.number().finite().min(0).max(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((provenance, context) => {
    if (Date.parse(provenance.startedAt) > Date.parse(provenance.completedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Evaluation provenance cannot complete before it starts.",
        path: ["completedAt"],
      });
    }
  });

export type CandidateRunProvenance = z.infer<typeof candidateRunProvenanceSchema>;

const candidateRunFailureCodeSchema = z.enum([
  "budget-exhausted",
  "invalid-output",
  "provider-error",
  "rate-limited",
  "timeout",
]);

export const candidateRunSchema = z
  .object({
    artifactType: z.literal("candidate-run"),
    baselineModel: modelIdSchema,
    baselineMetrics: candidateMetricsSchema.optional(),
    callSiteId: stableIdSchema,
    candidateModel: modelIdSchema,
    catalogSnapshotId: artifactIdSchema,
    confidenceFloor: confidenceSchema,
    evaluationInputDigest: digestSchema,
    evalSuiteId: artifactIdSchema,
    failureCode: candidateRunFailureCodeSchema.optional(),
    fixtureDigest: digestSchema,
    gateOutcomes: hardGateOutcomesSchema.optional(),
    ...artifactEnvelope,
    metrics: candidateMetricsSchema.optional(),
    provenance: candidateRunProvenanceSchema,
    status: z.enum(["complete", "failed", "incomplete"]),
  })
  .strict()
  .superRefine((artifact, context) => {
    assertArtifactIdPrefix(artifact, context, "candidate-run");

    if (artifact.baselineModel === artifact.candidateModel) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Candidate and baseline models must be different.",
        path: ["candidateModel"],
      });
    }

    if (artifact.status === "complete" && artifact.metrics === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Complete candidate runs require aggregate metrics.",
        path: ["metrics"],
      });
    }

    if (artifact.status === "complete" && artifact.baselineMetrics === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Complete candidate runs require baseline metrics.",
        path: ["baselineMetrics"],
      });
    }

    if (artifact.status === "complete" && artifact.gateOutcomes === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Complete candidate runs require hard-gate outcomes.",
        path: ["gateOutcomes"],
      });
    }

    if (artifact.status === "complete" && artifact.failureCode !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Complete candidate runs cannot include a failure code.",
        path: ["failureCode"],
      });
    }

    if (artifact.status !== "complete" && artifact.failureCode === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Incomplete or failed candidate runs require a bounded failure code.",
        path: ["failureCode"],
      });
    }

    if (artifact.status !== "complete" && artifact.metrics !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Incomplete or failed candidate runs cannot include promotable aggregate metrics.",
        path: ["metrics"],
      });
    }

    if (artifact.status !== "complete" && artifact.baselineMetrics !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Incomplete or failed candidate runs cannot include baseline metrics.",
        path: ["baselineMetrics"],
      });
    }

    if (artifact.status !== "complete" && artifact.gateOutcomes !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Incomplete or failed candidate runs cannot include hard-gate outcomes.",
        path: ["gateOutcomes"],
      });
    }

    if (
      artifact.status === "complete" &&
      artifact.metrics !== undefined &&
      artifact.baselineMetrics !== undefined &&
      artifact.metrics.caseCount !== artifact.baselineMetrics.caseCount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Candidate and baseline metrics must use the same evaluated case count.",
        path: ["baselineMetrics", "caseCount"],
      });
    }

    assertArtifactReferencePrefix(artifact.catalogSnapshotId, context, "catalog-snapshot", [
      "catalogSnapshotId",
    ]);
    assertArtifactReferencePrefix(artifact.evalSuiteId, context, "eval-suite", ["evalSuiteId"]);
  });

export type CandidateRun = z.infer<typeof candidateRunSchema>;

export const recommendationStatusSchema = z.enum([
  "recommend",
  "no-change",
  "incompatible",
  "regression",
  "insufficient-evidence",
]);

export type RecommendationStatus = z.infer<typeof recommendationStatusSchema>;

const reasonCodesByStatus: Record<RecommendationStatus, readonly RecommendationReasonCode[]> = {
  recommend: ["cost-savings", "quality-gates-passed"],
  "no-change": ["candidate-regressed", "no-better-candidate"],
  incompatible: ["capability-incompatible", "context-incompatible", "privacy-incompatible"],
  regression: ["cost-regression", "error-regression", "latency-regression", "quality-regression"],
  "insufficient-evidence": [
    "budget-exhausted",
    "candidate-timeout",
    "confidence-below-floor",
    "contradictory-evidence",
    "insufficient-cases",
    "provider-failure",
  ],
};

export const recommendationSchema = z
  .object({
    artifactType: z.literal("recommendation"),
    baselineModel: modelIdSchema,
    callSiteId: stableIdSchema,
    candidateRunIds: z.array(artifactIdSchema),
    catalogSnapshotId: artifactIdSchema,
    confidence: confidenceSchema,
    confidenceFloor: confidenceSchema,
    evaluationInputDigest: digestSchema,
    ...artifactEnvelope,
    limitations: z.array(recommendationLimitationCodeSchema).min(1),
    reasonCodes: z.array(recommendationReasonCodeSchema).min(1),
    recommendedModel: modelIdSchema.optional(),
    reproductionCommands: z.array(reproductionCommandSchema).min(1),
    status: recommendationStatusSchema,
    sourceBinding: boundSourceBindingSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    assertArtifactIdPrefix(artifact, context, "recommendation");
    assertUniqueValues(artifact.candidateRunIds, context, "candidate run ID", ["candidateRunIds"]);
    assertUniqueValues(artifact.reasonCodes, context, "recommendation reason code", [
      "reasonCodes",
    ]);
    assertUniqueValues(artifact.limitations, context, "recommendation limitation", ["limitations"]);
    assertUniqueValues(
      artifact.reproductionCommands.map(
        ({ callSiteId, operation }) => `${operation}:${callSiteId}`,
      ),
      context,
      "reproduction command",
      ["reproductionCommands"],
    );
    assertArtifactReferencePrefix(artifact.catalogSnapshotId, context, "catalog-snapshot", [
      "catalogSnapshotId",
    ]);

    for (const [index, candidateRunId] of artifact.candidateRunIds.entries()) {
      assertArtifactReferencePrefix(candidateRunId, context, "candidate-run", [
        "candidateRunIds",
        index,
      ]);
    }

    for (const [index, command] of artifact.reproductionCommands.entries()) {
      if (command.callSiteId !== artifact.callSiteId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A reproduction command must name the recommendation call site.",
          path: ["reproductionCommands", index, "callSiteId"],
        });
      }
    }

    if (artifact.status === "recommend") {
      if (artifact.confidence < artifact.confidenceFloor) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A recommend outcome must meet its confidence floor.",
          path: ["confidence"],
        });
      }

      if (artifact.recommendedModel === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A recommend outcome requires a recommended model.",
          path: ["recommendedModel"],
        });
      }

      if (artifact.recommendedModel === artifact.baselineModel) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A recommended model must be different from the baseline model.",
          path: ["recommendedModel"],
        });
      }

      if (artifact.candidateRunIds.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A recommend outcome requires completed candidate-run references.",
          path: ["candidateRunIds"],
        });
      }
    } else if (artifact.recommendedModel !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only a recommend outcome may include a recommended model.",
        path: ["recommendedModel"],
      });
    }

    const allowedReasonCodes = reasonCodesByStatus[artifact.status];
    for (const [index, reasonCode] of artifact.reasonCodes.entries()) {
      if (!allowedReasonCodes.includes(reasonCode)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Reason code ${reasonCode} is not valid for ${artifact.status}.`,
          path: ["reasonCodes", index],
        });
      }
    }
  });

export type Recommendation = z.infer<typeof recommendationSchema>;

export const patchPlanSchema = z
  .object({
    artifactType: z.literal("patch-plan"),
    callSiteId: stableIdSchema,
    expectedModel: modelIdSchema,
    ...artifactEnvelope,
    recommendationId: artifactIdSchema,
    recommendationStatus: z.literal("recommend"),
    replacementModel: modelIdSchema,
    sourceBinding: boundSourceBindingSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    assertArtifactIdPrefix(artifact, context, "patch-plan");
    assertArtifactReferencePrefix(artifact.recommendationId, context, "recommendation", [
      "recommendationId",
    ]);

    if (artifact.expectedModel === artifact.replacementModel) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A patch plan replacement model must be different from the expected model.",
        path: ["replacementModel"],
      });
    }
  });

export type PatchPlan = z.infer<typeof patchPlanSchema>;

export type VetrynArtifact =
  CallSiteManifest | EvalSuite | CatalogSnapshot | CandidateRun | Recommendation | PatchPlan;

export function createArtifactId(artifactType: ArtifactType, parts: readonly string[]): string {
  artifactTypeSchema.parse(artifactType);

  if (parts.length === 0 || !parts.every((part) => stableIdSchema.safeParse(part).success)) {
    throw new VetrynContractError(
      "Artifact IDs require one or more lowercase kebab-case stable ID parts.",
    );
  }

  return `${artifactType}:${parts.join("--")}`;
}

export function parseCallSiteManifest(value: unknown): CallSiteManifest {
  return parseVersionedArtifact(callSiteManifestSchema, "call-site manifest", value);
}

export function parseEvalSuite(value: unknown): EvalSuite {
  return parseVersionedArtifact(evalSuiteSchema, "eval suite", value);
}

export function parseCatalogSnapshot(value: unknown): CatalogSnapshot {
  return parseVersionedArtifact(catalogSnapshotSchema, "catalog snapshot", value);
}

export function parseCandidateRun(value: unknown): CandidateRun {
  return parseVersionedArtifact(candidateRunSchema, "candidate run", value);
}

export function parseRecommendation(value: unknown): Recommendation {
  return parseVersionedArtifact(recommendationSchema, "recommendation", value);
}

export function parsePatchPlan(value: unknown): PatchPlan {
  return parseVersionedArtifact(patchPlanSchema, "patch plan", value);
}

export function parseVetrynArtifact(value: unknown): VetrynArtifact {
  assertSupportedSchemaVersion(value, "Vetryn artifact");

  if (!isPlainObject(value) || typeof value.artifactType !== "string") {
    throw new VetrynContractError("Vetryn artifact must declare a supported artifactType.");
  }

  switch (value.artifactType) {
    case "call-site-manifest":
      return parseCallSiteManifest(value);
    case "eval-suite":
      return parseEvalSuite(value);
    case "catalog-snapshot":
      return parseCatalogSnapshot(value);
    case "candidate-run":
      return parseCandidateRun(value);
    case "recommendation":
      return parseRecommendation(value);
    case "patch-plan":
      return parsePatchPlan(value);
    default:
      throw new VetrynContractError(`Unsupported Vetryn artifactType: ${value.artifactType}.`);
  }
}

export function canonicalizeArtifact(value: unknown): string {
  return canonicalizeJson(parseVetrynArtifact(value));
}

export function assertEvaluationInputDigest<T extends { evaluationInputDigest: string }>(
  artifact: T,
  expectedDigest: string,
): T {
  if (!digestSchema.safeParse(expectedDigest).success) {
    throw new VetrynContractError("Expected evaluation input digest must be a sha256 digest.");
  }

  if (artifact.evaluationInputDigest !== expectedDigest) {
    throw new VetrynContractError(
      "Evaluation evidence is stale for the current evaluation input digest.",
    );
  }

  return artifact;
}

export function assertCandidateRunPolicy(
  candidateRun: CandidateRun,
  callSite: CallSite,
): CandidateRun {
  if (candidateRun.callSiteId !== callSite.id) {
    throw new VetrynContractError(
      "Candidate run has a different call site than its evaluation policy.",
    );
  }

  if (candidateRun.baselineModel !== callSite.currentModel) {
    throw new VetrynContractError(
      "Candidate run has a different baseline model than its evaluation policy.",
    );
  }

  if (candidateRun.confidenceFloor !== callSite.gates.minRecommendationConfidence) {
    throw new VetrynContractError(
      "Candidate run has a different confidence floor than its evaluation policy.",
    );
  }

  if (candidateRun.status === "complete") {
    assertMeasuredHardGateOutcomes(candidateRun, callSite);
  }

  return candidateRun;
}

function recommendationConfidenceUpperBound(candidateRun: CandidateRun): number {
  if (candidateRun.status !== "complete" || candidateRun.metrics === undefined) {
    throw new VetrynContractError(
      "Only complete candidate runs with aggregate metrics can support recommendation confidence.",
    );
  }

  return Math.max(
    0,
    candidateRun.metrics.passedCases / candidateRun.metrics.caseCount -
      candidateRun.provenance.variance.passRateStdDev,
  );
}

export function assertRecommendationEvidence(
  recommendation: Recommendation,
  candidateRuns: readonly CandidateRun[],
  expectedEvaluationInputDigest: string,
  callSite: CallSite,
  evalSuite: EvalSuite,
  catalogSnapshot: CatalogSnapshot,
): Recommendation {
  assertEvaluationInputDigest(recommendation, expectedEvaluationInputDigest);
  assertRecommendationPolicy(recommendation, callSite, catalogSnapshot);

  if (
    recommendation.status === "recommend" &&
    recommendation.confidence < recommendation.confidenceFloor
  ) {
    throw new VetrynContractError("Recommendation confidence does not meet its confidence floor.");
  }

  if (new Set(candidateRuns.map((candidateRun) => candidateRun.id)).size !== candidateRuns.length) {
    throw new VetrynContractError("Recommendation evidence contains duplicate candidate run IDs.");
  }

  const candidateRunsById = new Map(
    candidateRuns.map((candidateRun) => [candidateRun.id, candidateRun]),
  );
  let confidenceUpperBound = 1;

  for (const candidateRunId of recommendation.candidateRunIds) {
    const candidateRun = candidateRunsById.get(candidateRunId);

    if (candidateRun === undefined) {
      throw new VetrynContractError(
        `Recommendation evidence is missing candidate run ${candidateRunId}.`,
      );
    }

    if (candidateRun.callSiteId !== recommendation.callSiteId) {
      throw new VetrynContractError(
        `Recommendation evidence candidate run ${candidateRunId} has a different call site.`,
      );
    }

    if (candidateRun.baselineModel !== recommendation.baselineModel) {
      throw new VetrynContractError(
        `Recommendation evidence candidate run ${candidateRunId} has a different baseline model.`,
      );
    }

    if (candidateRun.catalogSnapshotId !== recommendation.catalogSnapshotId) {
      throw new VetrynContractError(
        `Recommendation evidence candidate run ${candidateRunId} has a different catalog snapshot.`,
      );
    }

    if (candidateRun.confidenceFloor !== recommendation.confidenceFloor) {
      throw new VetrynContractError(
        `Recommendation evidence candidate run ${candidateRunId} has a different confidence floor.`,
      );
    }

    assertEvaluationInputDigest(candidateRun, expectedEvaluationInputDigest);
    assertCandidateRunPolicy(candidateRun, callSite);
    assertCandidateRunEvalSuite(candidateRun, callSite, evalSuite);

    if (recommendation.status !== "recommend") continue;

    if (candidateRun.status !== "complete") {
      throw new VetrynContractError(
        `Recommendation evidence cannot use ${candidateRun.status} candidate run ${candidateRunId}.`,
      );
    }

    if (candidateRun.candidateModel !== recommendation.recommendedModel) {
      throw new VetrynContractError(
        `Recommendation evidence candidate run ${candidateRunId} has a different recommended model.`,
      );
    }

    assertCandidateRunCatalog(candidateRun, catalogSnapshot, callSite);
    assertPassedHardGates(candidateRun);
    confidenceUpperBound = Math.min(
      confidenceUpperBound,
      recommendationConfidenceUpperBound(candidateRun),
    );
  }

  if (
    recommendation.status === "recommend" &&
    recommendation.confidence - confidenceUpperBound > confidenceComparisonTolerance
  ) {
    throw new VetrynContractError(
      "Recommendation confidence exceeds the evidence-bound quality lower bound.",
    );
  }

  return recommendation;
}

export function assertPatchPlanEvidence(
  patchPlan: PatchPlan,
  recommendation: Recommendation,
): PatchPlan {
  if (recommendation.status !== "recommend" || recommendation.recommendedModel === undefined) {
    throw new VetrynContractError("Patch plan evidence must reference a recommend outcome.");
  }

  if (patchPlan.recommendationId !== recommendation.id) {
    throw new VetrynContractError("Patch plan references a different recommendation.");
  }

  if (patchPlan.callSiteId !== recommendation.callSiteId) {
    throw new VetrynContractError("Patch plan has a different call site than its recommendation.");
  }

  if (patchPlan.expectedModel !== recommendation.baselineModel) {
    throw new VetrynContractError(
      "Patch plan has a different expected model than its recommendation.",
    );
  }

  if (patchPlan.replacementModel !== recommendation.recommendedModel) {
    throw new VetrynContractError(
      "Patch plan has a different replacement model than its recommendation.",
    );
  }

  if (!sameSourceBinding(patchPlan.sourceBinding, recommendation.sourceBinding)) {
    throw new VetrynContractError(
      "Patch plan has a different source binding than its recommendation.",
    );
  }

  return patchPlan;
}

class VetrynContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VetrynContractError";
  }
}

function parseVersionedArtifact<T>(schema: z.ZodType<T>, name: string, value: unknown): T {
  assertSupportedSchemaVersion(value, name);
  return parseWithDiagnostics(schema, name, value);
}

function parseWithDiagnostics<T>(schema: z.ZodType<T>, name: string, value: unknown): T {
  const result = schema.safeParse(value);

  if (result.success) return result.data;

  const details = result.error.issues
    .map(
      (issue) => `${issue.path.length === 0 ? "artifact" : issue.path.join(".")}: ${issue.message}`,
    )
    .join("; ");
  throw new VetrynContractError(`Invalid ${name}: ${details}`);
}

function assertSupportedSchemaVersion(value: unknown, name: string): void {
  if (!isPlainObject(value) || value.schemaVersion !== VETRYN_ARTIFACT_SCHEMA_VERSION) {
    throw new VetrynContractError(
      `${name} schemaVersion must be ${VETRYN_ARTIFACT_SCHEMA_VERSION}; unknown versions fail closed.`,
    );
  }
}

function assertArtifactIdPrefix(
  artifact: { id: string },
  context: z.RefinementCtx,
  artifactType: ArtifactType,
): void {
  if (!artifact.id.startsWith(`${artifactType}:`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Artifact ID must start with ${artifactType}:`,
      path: ["id"],
    });
  }
}

function assertArtifactReferencePrefix(
  reference: string,
  context: z.RefinementCtx,
  artifactType: ArtifactType,
  path: readonly (string | number)[],
): void {
  if (!reference.startsWith(`${artifactType}:`)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Artifact reference must point to a ${artifactType}.`,
      path: [...path],
    });
  }
}

function assertUniqueValues(
  values: readonly string[],
  context: z.RefinementCtx,
  label: string,
  path: readonly (string | number)[],
): void {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate ${label} values are not allowed.`,
      path: [...path],
    });
  }
}

function assertPassedHardGates(candidateRun: CandidateRun): void {
  if (candidateRun.gateOutcomes === undefined) {
    throw new VetrynContractError(
      `Recommendation evidence candidate run ${candidateRun.id} is missing hard-gate outcomes.`,
    );
  }

  const failedGates = Object.entries(candidateRun.gateOutcomes)
    .filter(([, outcome]) => outcome !== "pass")
    .map(([gate]) => gate);
  if (failedGates.length > 0) {
    throw new VetrynContractError(
      `Recommendation evidence candidate run ${candidateRun.id} failed hard gate(s): ${failedGates.join(", ")}.`,
    );
  }
}

function assertRecommendationPolicy(
  recommendation: Recommendation,
  callSite: CallSite,
  catalogSnapshot: CatalogSnapshot,
): void {
  if (recommendation.callSiteId !== callSite.id) {
    throw new VetrynContractError(
      "Recommendation has a different call site than its evaluation policy.",
    );
  }

  if (recommendation.baselineModel !== callSite.currentModel) {
    throw new VetrynContractError(
      "Recommendation has a different baseline model than its evaluation policy.",
    );
  }

  if (recommendation.catalogSnapshotId !== catalogSnapshot.id) {
    throw new VetrynContractError(
      "Recommendation has a different catalog snapshot than its evidence.",
    );
  }

  if (recommendation.confidenceFloor !== callSite.gates.minRecommendationConfidence) {
    throw new VetrynContractError(
      "Recommendation has a different confidence floor than its evaluation policy.",
    );
  }

  if (!sameSourceBinding(recommendation.sourceBinding, callSite.sourceBinding)) {
    throw new VetrynContractError(
      "Recommendation has a different source binding than its evaluation policy.",
    );
  }
}

function assertCandidateRunCatalog(
  candidateRun: CandidateRun,
  catalogSnapshot: CatalogSnapshot,
  callSite: CallSite,
): void {
  if (candidateRun.catalogSnapshotId !== catalogSnapshot.id) {
    throw new VetrynContractError(
      "Candidate run has a different catalog snapshot than its evidence.",
    );
  }

  const candidateModel = catalogSnapshot.models.find(
    (model) => model.id === candidateRun.candidateModel,
  );
  if (candidateModel === undefined) {
    throw new VetrynContractError(
      `Recommendation evidence catalog is missing candidate model ${candidateRun.candidateModel}.`,
    );
  }

  if (candidateModel.retired) {
    throw new VetrynContractError(
      `Recommendation evidence candidate model ${candidateRun.candidateModel} is retired.`,
    );
  }

  if (!callSite.providerPolicy.allowedProviders.includes(candidateModel.provider)) {
    throw new VetrynContractError(
      `Recommendation evidence candidate model ${candidateRun.candidateModel} provider ${candidateModel.provider} is not in the call site's approved provider policy.`,
    );
  }

  if (candidateRun.status === "complete" && candidateRun.gateOutcomes?.privacy !== "pass") {
    throw new VetrynContractError(
      `Candidate run ${candidateRun.id} has an invalid privacy gate outcome for its approved provider policy.`,
    );
  }

  const missingCapabilities = capabilityNames.filter(
    (capability) =>
      callSite.requiredCapabilities[capability] && !candidateModel.capabilities[capability],
  );
  if (missingCapabilities.length > 0) {
    throw new VetrynContractError(
      `Recommendation evidence candidate model ${candidateRun.candidateModel} is missing required capability/capabilities: ${missingCapabilities.join(", ")}.`,
    );
  }

  const requiredTokens =
    callSite.representativeUsage.promptTokens + callSite.representativeUsage.completionTokens;
  if (candidateModel.contextWindowTokens < requiredTokens) {
    throw new VetrynContractError(
      `Recommendation evidence candidate model ${candidateRun.candidateModel} lacks the required context window.`,
    );
  }
}

function assertCandidateRunEvalSuite(
  candidateRun: CandidateRun,
  callSite: CallSite,
  evalSuite: EvalSuite,
): void {
  if (callSite.evalSuiteId !== evalSuite.id) {
    throw new VetrynContractError(
      "Evaluation suite does not match the call site's manifest declaration.",
    );
  }

  if (evalSuite.callSiteId !== callSite.id) {
    throw new VetrynContractError(
      "Evaluation suite has a different call site than its evaluation policy.",
    );
  }

  if (candidateRun.evalSuiteId !== evalSuite.id) {
    throw new VetrynContractError(
      "Candidate run has a different evaluation suite than its evidence.",
    );
  }

  if (candidateRun.fixtureDigest !== evalSuite.fixtureDigest) {
    throw new VetrynContractError(
      "Candidate run has a different fixture binding than its evaluation suite.",
    );
  }

  if (
    candidateRun.status === "complete" &&
    (candidateRun.metrics === undefined ||
      candidateRun.baselineMetrics === undefined ||
      candidateRun.metrics.caseCount !== evalSuite.caseCount ||
      candidateRun.baselineMetrics.caseCount !== evalSuite.caseCount)
  ) {
    throw new VetrynContractError(
      "Candidate run metrics must use the reviewed evaluation suite case count.",
    );
  }
}

function assertMeasuredHardGateOutcomes(candidateRun: CandidateRun, callSite: CallSite): void {
  if (
    candidateRun.baselineMetrics === undefined ||
    candidateRun.gateOutcomes === undefined ||
    candidateRun.metrics === undefined
  ) {
    throw new VetrynContractError(
      `Complete candidate run ${candidateRun.id} is missing metrics or hard-gate outcomes.`,
    );
  }

  const { baselineMetrics, metrics } = candidateRun;
  const qualityPasses =
    metrics.caseCount >= callSite.gates.minCases &&
    ratioAtLeast(metrics.passedCases, metrics.caseCount, callSite.gates.minPassRate) &&
    qualityRegressionWithinLimit(
      baselineMetrics.passedCases,
      metrics.passedCases,
      metrics.caseCount,
      callSite.gates.maxQualityRegression,
    );
  const expectedOutcomes = {
    cost: costSavingsAtLeast(
      baselineMetrics.costUsd,
      metrics.costUsd,
      callSite.gates.minSavingsPercent,
    ),
    latency:
      callSite.gates.maxP95LatencyMs === undefined ||
      metrics.p95LatencyMs <= callSite.gates.maxP95LatencyMs,
    quality: qualityPasses,
  } as const;

  for (const [gate, passed] of Object.entries(expectedOutcomes)) {
    const expectedOutcome = passed ? "pass" : "fail";
    if (candidateRun.gateOutcomes[gate as keyof typeof expectedOutcomes] !== expectedOutcome) {
      throw new VetrynContractError(
        `Candidate run ${candidateRun.id} has an invalid ${gate} gate outcome for its policy and metrics.`,
      );
    }
  }
}

function ratioAtLeast(numerator: number, denominator: number, minimum: number): boolean {
  const threshold = decimalFraction(minimum);
  return BigInt(numerator) * threshold.denominator >= BigInt(denominator) * threshold.numerator;
}

function qualityRegressionWithinLimit(
  baselinePassedCases: number,
  candidatePassedCases: number,
  caseCount: number,
  maximumRegression: number,
): boolean {
  const regression = baselinePassedCases - candidatePassedCases;
  if (regression <= 0) return true;

  const limit = decimalFraction(maximumRegression);
  return BigInt(regression) * limit.denominator <= BigInt(caseCount) * limit.numerator;
}

function costSavingsAtLeast(
  baselineCost: string,
  candidateCost: string,
  minimumSavingsPercent: number,
): boolean {
  const baseline = decimalFraction(baselineCost);
  const candidate = decimalFraction(candidateCost);
  const minimum = decimalFraction(minimumSavingsPercent);
  const baselineScaled = baseline.numerator * candidate.denominator;
  const candidateScaled = candidate.numerator * baseline.denominator;

  if (baselineScaled === 0n) {
    return candidateScaled === 0n && minimum.numerator === 0n;
  }

  return (
    (baselineScaled - candidateScaled) * 100n * minimum.denominator >=
    baselineScaled * minimum.numerator
  );
}

function decimalFraction(value: number | string): { numerator: bigint; denominator: bigint } {
  const match = String(value)
    .toLowerCase()
    .match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
  if (match === null) {
    throw new VetrynContractError("Policy comparison requires a non-negative decimal value.");
  }

  const [, whole, fractional = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  const scale = fractional.length - exponent;
  const numerator = BigInt(`${whole}${fractional}`);

  if (scale <= 0) {
    return { numerator: numerator * 10n ** BigInt(-scale), denominator: 1n };
  }

  return { numerator, denominator: 10n ** BigInt(scale) };
}

function sameSourceBinding(left: BoundSourceBinding, right: BoundSourceBinding): boolean {
  return (
    left.adapter === right.adapter &&
    left.file === right.file &&
    left.sourceFingerprint === right.sourceFingerprint &&
    left.symbol === right.symbol
  );
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new VetrynContractError(
        "Canonical JSON only accepts finite non-negative-zero numbers.",
      );
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
      .join(",")}}`;
  }

  throw new VetrynContractError("Canonical JSON only accepts JSON-compatible values.");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
