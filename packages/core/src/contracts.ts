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
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "Use a sha256 digest.");
const decimalSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/, "Use a canonical non-negative decimal string.");
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
      !value.includes("\\") &&
      !value.split("/").includes("..") &&
      !value.includes("\u0000"),
    "Use a relative repository path without traversal.",
  );
const opaqueReferenceSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*:[a-zA-Z0-9._:-]+$/, "Use a compact opaque reference.");
const reasonCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case reason code.");

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

export const callSiteSpecSchema = z
  .object({
    binding: sourceBindingSchema,
    evalFixture: repositoryPathSchema,
    gates: evaluationGatesSchema,
    id: stableIdSchema,
    name: z.string().min(1),
    owner: z.string().min(1),
  })
  .strict();

export type CallSiteSpec = z.infer<typeof callSiteSpecSchema>;

export function parseCallSiteSpec(value: unknown): CallSiteSpec {
  return parseWithDiagnostics(callSiteSpecSchema, "call-site specification", value);
}

export const callSiteSchema = z
  .object({
    currentModel: modelIdSchema,
    evalSuiteId: stableIdSchema,
    gates: evaluationGatesSchema,
    id: stableIdSchema,
    name: z.string().min(1),
    owner: z.string().min(1),
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
  .strict();

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
    callSiteId: stableIdSchema,
    candidateModel: modelIdSchema,
    catalogSnapshotId: artifactIdSchema,
    evaluationInputDigest: digestSchema,
    failureCode: candidateRunFailureCodeSchema.optional(),
    ...artifactEnvelope,
    metrics: candidateMetricsSchema.optional(),
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

    assertArtifactReferencePrefix(artifact.catalogSnapshotId, context, "catalog-snapshot", [
      "catalogSnapshotId",
    ]);
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

export const recommendationSchema = z
  .object({
    artifactType: z.literal("recommendation"),
    baselineModel: modelIdSchema,
    callSiteId: stableIdSchema,
    candidateRunIds: z.array(artifactIdSchema),
    catalogSnapshotId: artifactIdSchema,
    confidence: z.number().min(0).max(1),
    evaluationInputDigest: digestSchema,
    ...artifactEnvelope,
    reasonCodes: z.array(reasonCodeSchema).min(1),
    recommendedModel: modelIdSchema.optional(),
    status: recommendationStatusSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    assertArtifactIdPrefix(artifact, context, "recommendation");
    assertUniqueValues(artifact.candidateRunIds, context, "candidate run ID", ["candidateRunIds"]);
    assertArtifactReferencePrefix(artifact.catalogSnapshotId, context, "catalog-snapshot", [
      "catalogSnapshotId",
    ]);

    for (const [index, candidateRunId] of artifact.candidateRunIds.entries()) {
      assertArtifactReferencePrefix(candidateRunId, context, "candidate-run", [
        "candidateRunIds",
        index,
      ]);
    }

    if (artifact.status === "recommend") {
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

export function assertRecommendationEvidence(
  recommendation: Recommendation,
  candidateRuns: readonly CandidateRun[],
  expectedEvaluationInputDigest: string,
): Recommendation {
  assertEvaluationInputDigest(recommendation, expectedEvaluationInputDigest);

  if (recommendation.status !== "recommend") return recommendation;

  const candidateRunsById = new Map(
    candidateRuns.map((candidateRun) => [candidateRun.id, candidateRun]),
  );

  for (const candidateRunId of recommendation.candidateRunIds) {
    const candidateRun = candidateRunsById.get(candidateRunId);

    if (candidateRun === undefined) {
      throw new VetrynContractError(
        `Recommendation evidence is missing candidate run ${candidateRunId}.`,
      );
    }

    if (candidateRun.status !== "complete") {
      throw new VetrynContractError(
        `Recommendation evidence cannot use ${candidateRun.status} candidate run ${candidateRunId}.`,
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

    if (candidateRun.candidateModel !== recommendation.recommendedModel) {
      throw new VetrynContractError(
        `Recommendation evidence candidate run ${candidateRunId} has a different recommended model.`,
      );
    }

    assertEvaluationInputDigest(candidateRun, expectedEvaluationInputDigest);
  }

  return recommendation;
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
