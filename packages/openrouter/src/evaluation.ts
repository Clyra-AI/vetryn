import { createHash } from "node:crypto";

import {
  VETRYN_ARTIFACT_SCHEMA_VERSION,
  assertCandidateRunExecutionRecord,
  createCandidateRunContentDigest,
  openRouterRoutePolicySchema,
  parseCallSite,
  parseCandidateRun,
  parseCatalogSnapshot,
  parseEvalSuite,
  parseEvaluationExecutionRecord,
  type CallSite,
  type CandidateRun,
  type CatalogSnapshot,
  type EvaluationExecutionRecord,
  type OpenRouterRoutePolicy,
} from "@vetryn/core";
import { z } from "zod";

import { consumeLiveCatalogRefreshResult } from "./live-refresh.js";

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const decimalSchema = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/);
const stableIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const timestampSchema = z.string().datetime({ offset: true });
const evaluationRefreshObservationSchema = z
  .object({
    acquisition: z.enum(["captured-response", "live-api"]),
    artifactType: z.literal("openrouter-catalog-refresh-observation"),
    contentDigest: digestSchema.nullable(),
    errorCode: z.enum(["fetch-failed", "http-error", "invalid-catalog"]).nullable(),
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
    normalizerVersion: z.literal("1.0.0"),
    observedAt: timestampSchema,
    reusedSnapshot: z.boolean(),
    schemaVersion: z.literal("1.0.0"),
    snapshotId: z.string().nullable(),
    source: z.literal("openrouter"),
    sourceRef: z.enum(["openrouter-models-api", "repository-captured-response"]),
    status: z.enum(["success", "failure"]),
  })
  .strict();
type RefreshObservation = z.infer<typeof evaluationRefreshObservationSchema>;

const refreshLineageSchema = z
  .object({
    attempts: z
      .array(
        z
          .object({
            observation: evaluationRefreshObservationSchema,
            ordinal: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    invocationId: stableIdSchema,
    schemaVersion: z.literal("1.0.0"),
    terminalOrdinal: z.number().int().positive(),
  })
  .strict();

export type CatalogRefreshLineage = z.infer<typeof refreshLineageSchema>;
const currentCatalogRefreshBrand: unique symbol = Symbol("vetryn-current-catalog-refresh");

export interface CurrentCatalogRefresh {
  readonly [currentCatalogRefreshBrand]: true;
  readonly lineage: CatalogRefreshLineage;
  readonly snapshot: CatalogSnapshot;
}

export function createCurrentCatalogRefresh(input: {
  readonly invocationId: string;
  readonly refresh: {
    readonly observation: RefreshObservation;
    readonly snapshot: unknown;
    readonly status: "success";
  };
}): CurrentCatalogRefresh {
  if (!consumeLiveCatalogRefreshResult(input.refresh, input.invocationId)) {
    throw new Error(
      "Current evaluation requires an unconsumed canonical live acquisition result object.",
    );
  }
  const observation = evaluationRefreshObservationSchema.parse(input.refresh.observation);
  if (observation.acquisition !== "live-api") {
    throw new Error("Captured or imported catalog responses remain replay-only.");
  }
  const snapshot = parseCatalogSnapshot(input.refresh.snapshot);
  const lineage = validateCatalogRefreshLineage(
    {
      attempts: [{ observation, ordinal: 1 }],
      invocationId: input.invocationId,
      schemaVersion: "1.0.0",
      terminalOrdinal: 1,
    },
    snapshot,
    input.invocationId,
  );
  return { [currentCatalogRefreshBrand]: true, lineage, snapshot };
}

export interface EvaluationCase {
  readonly expected: Readonly<Record<string, string | number | boolean | null>>;
  readonly id: string;
  readonly input: string;
  readonly protectedSegments?: readonly string[];
}

export interface EvaluationClock {
  now(): string;
}

export interface EvaluationTransportRequest {
  readonly caseId: string;
  readonly input: string;
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly routePolicy: Readonly<{
    headers: Readonly<{ "X-OpenRouter-Metadata": "enabled" }>;
    provider: Readonly<{
      allow_fallbacks: false;
      data_collection: "deny";
      only: readonly [string];
      require_parameters: true;
      zdr: true;
    }>;
  }>;
  readonly sampling: Readonly<{ seed: number | null; temperature: number }>;
  readonly signal: AbortSignal;
}

export interface EvaluationTransportResult {
  readonly latencyMs: number;
  readonly output: unknown;
  readonly route: {
    readonly attempts: readonly {
      readonly model: string;
      readonly providerName: string;
      readonly statusCode: number;
    }[];
    readonly selectedProvider: { readonly model: string; readonly providerName: string } | null;
  };
  readonly usage: { readonly completionTokens: number; readonly promptTokens: number };
}

export interface EvaluationTransport {
  execute(request: EvaluationTransportRequest): Promise<EvaluationTransportResult>;
}

export type EvaluationTransportErrorCode =
  "invalid-output" | "provider-error" | "rate-limited" | "timeout";

export class EvaluationTransportError extends Error {
  readonly code: EvaluationTransportErrorCode;

  constructor(code: EvaluationTransportErrorCode) {
    super(`Evaluation transport failed: ${code}.`);
    this.name = "EvaluationTransportError";
    this.code = code;
  }
}

export interface OpenRouterEvaluationTransportOptions {
  readonly apiKey: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly nowMilliseconds?: () => number;
}

export function createOpenRouterEvaluationTransport(
  options: OpenRouterEvaluationTransportOptions,
): EvaluationTransport {
  if (options.apiKey.trim().length === 0) throw new Error("OpenRouter API key is required.");
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const nowMilliseconds = options.nowMilliseconds ?? (() => performance.now());
  return {
    async execute(request) {
      const started = nowMilliseconds();
      let response: Response;
      try {
        response = await fetchImplementation("https://openrouter.ai/api/v1/chat/completions", {
          body: JSON.stringify({
            max_tokens: request.maxOutputTokens,
            messages: [{ content: request.input, role: "user" }],
            model: request.model,
            provider: request.routePolicy.provider,
            response_format: { type: "json_object" },
            seed: request.sampling.seed,
            temperature: request.sampling.temperature,
          }),
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            ...request.routePolicy.headers,
          },
          method: "POST",
          signal: request.signal,
        });
      } catch {
        throw new EvaluationTransportError(request.signal.aborted ? "timeout" : "provider-error");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new EvaluationTransportError(
          response.status === 429 ? "rate-limited" : "provider-error",
        );
      }
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && Number(declaredLength) > 1_000_000) {
        await response.body?.cancel().catch(() => undefined);
        throw new EvaluationTransportError("invalid-output");
      }
      const bodyText = await readBoundedEvaluationBody(response, 1_000_000);
      if (bodyText === undefined) throw new EvaluationTransportError("invalid-output");
      let body: unknown;
      try {
        body = JSON.parse(bodyText) as unknown;
      } catch {
        throw new EvaluationTransportError("invalid-output");
      }
      if (!isRecord(body) || body.model !== request.model || typeof body.provider !== "string") {
        throw new EvaluationTransportError("invalid-output");
      }
      const choices = Array.isArray(body.choices) ? body.choices : [];
      const firstChoice = isRecord(choices[0]) ? choices[0] : undefined;
      const message = isRecord(firstChoice?.message) ? firstChoice.message : undefined;
      if (typeof message?.content !== "string")
        throw new EvaluationTransportError("invalid-output");
      let output: unknown;
      try {
        output = JSON.parse(message.content) as unknown;
      } catch {
        throw new EvaluationTransportError("invalid-output");
      }
      const usage = isRecord(body.usage) ? body.usage : undefined;
      if (
        !Number.isSafeInteger(usage?.prompt_tokens) ||
        !Number.isSafeInteger(usage?.completion_tokens)
      )
        throw new EvaluationTransportError("invalid-output");
      const promptTokens = usage?.prompt_tokens as number;
      const completionTokens = usage?.completion_tokens as number;
      const rawAttempts = Array.isArray(body.route_attempts) ? body.route_attempts : undefined;
      if (rawAttempts === undefined || rawAttempts.length === 0) {
        throw new EvaluationTransportError("invalid-output");
      }
      const attempts = rawAttempts.map((attempt) => {
        if (
          !isRecord(attempt) ||
          typeof attempt.model !== "string" ||
          typeof attempt.provider_name !== "string" ||
          !Number.isSafeInteger(attempt.status_code)
        )
          throw new EvaluationTransportError("invalid-output");
        return {
          model: attempt.model,
          providerName: attempt.provider_name,
          statusCode: attempt.status_code as number,
        };
      });
      return {
        latencyMs: Math.max(1, Math.ceil(nowMilliseconds() - started)),
        output,
        route: {
          attempts,
          selectedProvider: { model: body.model, providerName: body.provider },
        },
        usage: {
          completionTokens,
          promptTokens,
        },
      };
    },
  };
}

export interface EvaluateOpenRouterCandidateOptions {
  readonly callSite: unknown;
  readonly candidateModel: string;
  readonly cases: readonly EvaluationCase[];
  readonly currentCatalogRefresh: CurrentCatalogRefresh;
  readonly clock: EvaluationClock;
  readonly evalSuite: unknown;
  readonly evaluator: Readonly<{ build: string; id: string; version: string }>;
  readonly executionRecordId: string;
  readonly limits: Readonly<{
    concurrency: number;
    maxRequests: number;
    maxSpendUsd: string;
    retries: number;
    timeoutMs: number;
  }>;
  readonly sampling: Readonly<{
    attempts: number;
    maxOutputTokens: number;
    seed: number | null;
    temperature: number;
  }>;
  readonly scorer: Readonly<{ configurationDigest: string; id: string; version: string }>;
  readonly transport: EvaluationTransport;
}

export interface EvaluationArtifacts {
  readonly candidateRun: CandidateRun;
  readonly executionRecord: EvaluationExecutionRecord;
}

interface EvaluatedRequest {
  readonly caseId: string;
  readonly latencyMs: number;
  readonly passed: boolean;
  readonly privacySafe: boolean;
  readonly route: EvaluationTransportResult["route"];
  readonly usage: EvaluationTransportResult["usage"];
}

interface Job {
  readonly caseIndex: number;
  readonly model: string;
  readonly repetition: number;
  readonly role: "baseline" | "candidate";
}

export function createCatalogRefreshLineageDigest(lineageInput: unknown): string {
  const lineage = parseCatalogRefreshLineage(lineageInput);
  return sha256(canonicalJson(lineage));
}

export function createEvaluationCaseDigest(casesInput: readonly EvaluationCase[]): string {
  return sha256(canonicalJson(parseCases(casesInput)));
}

export function parseCatalogRefreshLineage(lineageInput: unknown): CatalogRefreshLineage {
  const lineage = refreshLineageSchema.parse(lineageInput);
  if (
    lineage.terminalOrdinal !== lineage.attempts.length ||
    lineage.attempts.some(({ ordinal }, index) => ordinal !== index + 1) ||
    lineage.attempts.at(-1)?.observation.status !== "success"
  ) {
    throw new EvaluationTransportError("provider-error");
  }
  return lineage;
}

export function validateCatalogRefreshLineage(
  lineageInput: unknown,
  snapshotInput: unknown,
  expectedInvocationId: string,
): CatalogRefreshLineage {
  const lineage = parseCatalogRefreshLineage(lineageInput);
  const snapshot = parseCatalogSnapshot(snapshotInput);
  if (lineage.invocationId !== expectedInvocationId) {
    throw new EvaluationTransportError("provider-error");
  }
  const terminal = lineage.attempts.at(-1)?.observation;
  if (
    terminal?.status !== "success" ||
    terminal.snapshotId !== snapshot.id ||
    terminal.contentDigest !== snapshot.contentDigest ||
    terminal.observedAt !== snapshot.observedAt
  ) {
    throw new EvaluationTransportError("provider-error");
  }
  return lineage;
}

export async function evaluateOpenRouterCandidate(
  options: EvaluateOpenRouterCandidateOptions,
): Promise<EvaluationArtifacts> {
  const callSite = parseCallSite(options.callSite);
  const evalSuite = parseEvalSuite(options.evalSuite);
  if (options.currentCatalogRefresh[currentCatalogRefreshBrand] !== true) {
    throw new Error("Evaluation requires a canonical same-invocation catalog refresh result.");
  }
  const snapshot = parseCatalogSnapshot(options.currentCatalogRefresh.snapshot);
  const limits = parseLimits(options.limits);
  const sampling = parseSampling(options.sampling);
  const cases = parseCases(options.cases);
  const evaluator = parseRunner(options.evaluator);
  const scorer = parseScorer(options.scorer);
  if (evalSuite.callSiteId !== callSite.id || evalSuite.id !== callSite.evalSuiteId) {
    throw new Error("Evaluation suite does not match the reviewed call site.");
  }
  const fixtureDigest = createEvaluationCaseDigest(cases);
  if (evalSuite.fixtureDigest !== fixtureDigest || evalSuite.caseCount !== cases.length) {
    throw new Error("Evaluation cases do not match the reviewed fixture digest and case count.");
  }
  const candidate = snapshot.models.find(({ id }) => id === options.candidateModel);
  if (candidate === undefined || candidate.retired || !candidate.capabilities.textGeneration) {
    throw new Error("Candidate model is missing or incompatible with the pinned catalog snapshot.");
  }
  const lineage = validateCatalogRefreshLineage(
    options.currentCatalogRefresh.lineage,
    snapshot,
    options.currentCatalogRefresh.lineage.invocationId,
  );
  const lineageDigest = createCatalogRefreshLineageDigest(lineage);
  const evaluationInputDigest = sha256(
    canonicalJson({
      callSite,
      cases,
      candidateModel: options.candidateModel,
      catalogContentDigest: snapshot.contentDigest,
      catalogRefreshLineageDigest: lineageDigest,
      evalSuite,
      evaluator,
      limits,
      sampling,
      scorer,
    }),
  );
  const startedAt = parseClock(options.clock);
  const jobs = createJobs(
    cases.length,
    sampling.attempts,
    callSite.currentModel,
    options.candidateModel,
  );
  let requestsStarted = 0;
  let spend = 0;
  let committedBudgetUnits = 0n;
  const maxSpendUnits = decimalUnitsFloor(limits.maxSpendUsd);
  let exhausted = false;
  let terminalFailure: EvaluationTransportErrorCode | undefined;
  const results = new Array<EvaluatedRequest | undefined>(jobs.length);
  let nextJob = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const jobIndex = nextJob;
      nextJob += 1;
      const job = jobs[jobIndex];
      if (job === undefined || exhausted || terminalFailure !== undefined) return;
      const evaluationCase = cases[job.caseIndex];
      if (evaluationCase === undefined)
        throw new Error("Evaluation job references a missing case.");
      for (let retry = 0; retry <= limits.retries; retry += 1) {
        const model = snapshot.models.find(({ id }) => id === job.model);
        if (model === undefined) throw new EvaluationTransportError("provider-error");
        const requestBudgetUnits = maximumRequestCostUnits(model, sampling.maxOutputTokens);
        if (
          requestsStarted >= limits.maxRequests ||
          committedBudgetUnits + requestBudgetUnits > maxSpendUnits
        ) {
          exhausted = true;
          return;
        }
        committedBudgetUnits += requestBudgetUnits;
        requestsStarted += 1;
        try {
          const response = await executeWithTimeout(
            options.transport,
            {
              caseId: evaluationCase.id,
              input: evaluationCase.input,
              maxOutputTokens: sampling.maxOutputTokens,
              model: job.model,
              routePolicy: createRouteRequestPolicy(callSite.routePolicy),
              sampling: { seed: sampling.seed, temperature: sampling.temperature },
            },
            limits.timeoutMs,
          );
          const normalized = normalizeResponse(
            response,
            evaluationCase,
            callSite.routePolicy,
            job.model,
          );
          if (
            normalized.usage.promptTokens > model.contextWindowTokens ||
            normalized.usage.completionTokens > sampling.maxOutputTokens
          ) {
            throw new EvaluationTransportError("invalid-output");
          }
          spend += requestCost(normalized.usage, model);
          results[jobIndex] = normalized;
          break;
        } catch (error: unknown) {
          const failure = error instanceof EvaluationTransportError ? error.code : "provider-error";
          if (retry === limits.retries) terminalFailure = failure;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limits.concurrency, jobs.length) }, worker));
  const completedAt = parseClock(options.clock);
  const candidateRun = buildCandidateRun({
    callSite,
    candidateModel: options.candidateModel,
    cases,
    completedAt,
    evalSuite,
    evaluationInputDigest,
    evaluator,
    executionRecordId: options.executionRecordId,
    exhausted,
    jobs,
    limits,
    observedProviderRequests: requestsStarted,
    observedSpendUsd: spend,
    results,
    sampling,
    scorer,
    snapshot,
    startedAt,
    ...(terminalFailure === undefined ? {} : { terminalFailure }),
  });
  const executionRecord = parseEvaluationExecutionRecord({
    artifactContentDigest: createCandidateRunContentDigest(candidateRun),
    artifactType: "evaluation-execution-record",
    candidateRunId: candidateRun.id,
    catalogRefreshLineageDigest: lineageDigest,
    completedAt,
    evaluationInputDigest,
    id: options.executionRecordId,
    runner: evaluator,
    schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
    startedAt,
  });
  assertCandidateRunExecutionRecord(candidateRun, executionRecord);
  return { candidateRun, executionRecord };
}

function buildCandidateRun(options: {
  callSite: CallSite;
  candidateModel: string;
  cases: readonly EvaluationCase[];
  completedAt: string;
  evalSuite: ReturnType<typeof parseEvalSuite>;
  evaluationInputDigest: string;
  evaluator: { build: string; id: string; version: string };
  executionRecordId: string;
  exhausted: boolean;
  jobs: readonly Job[];
  limits: ReturnType<typeof parseLimits>;
  observedProviderRequests: number;
  observedSpendUsd: number;
  results: readonly (EvaluatedRequest | undefined)[];
  sampling: ReturnType<typeof parseSampling>;
  scorer: ReturnType<typeof parseScorer>;
  snapshot: CatalogSnapshot;
  startedAt: string;
  terminalFailure?: EvaluationTransportErrorCode;
}): CandidateRun {
  const common = {
    artifactType: "candidate-run" as const,
    baselineModel: options.callSite.currentModel,
    callSiteId: options.callSite.id,
    candidateModel: options.candidateModel,
    catalogSnapshotId: options.snapshot.id,
    confidenceFloor: options.callSite.gates.minRecommendationConfidence,
    evaluationInputDigest: options.evaluationInputDigest,
    evalSuiteId: options.evalSuite.id,
    executionRecordId: options.executionRecordId,
    fixtureDigest: options.evalSuite.fixtureDigest,
    id: `candidate-run:${stablePart(options.callSite.id)}--${stablePart(options.candidateModel)}`,
    provenance: {
      attemptCount: options.sampling.attempts,
      completedAt: options.completedAt,
      evaluator: { build: options.evaluator.build, version: options.evaluator.version },
      limits: options.limits,
      observed: {
        providerRequestCount: options.observedProviderRequests,
        spendUsd: formatDecimal(options.observedSpendUsd),
      },
      sampling: {
        maxOutputTokens: options.sampling.maxOutputTokens,
        seed: options.sampling.seed,
        temperature: options.sampling.temperature,
      },
      scorer: options.scorer,
      startedAt: options.startedAt,
      variance: { costUsdStdDev: "0", p95LatencyMsStdDev: 0, passRateStdDev: 0 },
    },
    routePolicy: options.callSite.routePolicy,
    schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
  };
  if (
    options.exhausted ||
    options.terminalFailure !== undefined ||
    options.results.some((result) => result === undefined)
  ) {
    return parseCandidateRun({
      ...common,
      failureCode: options.exhausted ? "budget-exhausted" : mapFailure(options.terminalFailure),
      status: "incomplete",
    });
  }
  const baseline = requestResults(options.jobs, options.results, "baseline");
  const candidate = requestResults(options.jobs, options.results, "candidate");
  const baselineMetrics = metrics(
    options.cases,
    baseline,
    options.sampling.attempts,
    options.snapshot,
    options.callSite.currentModel,
  );
  const candidateMetrics = metrics(
    options.cases,
    candidate,
    options.sampling.attempts,
    options.snapshot,
    options.candidateModel,
  );
  const passRate = candidateMetrics.passedCases / candidateMetrics.caseCount;
  const baselinePassRate = baselineMetrics.passedCases / baselineMetrics.caseCount;
  const savingsPercent =
    Number(baselineMetrics.costUsd) === 0
      ? -Infinity
      : ((Number(baselineMetrics.costUsd) - Number(candidateMetrics.costUsd)) /
          Number(baselineMetrics.costUsd)) *
        100;
  const candidateModel = options.snapshot.models.find(({ id }) => id === options.candidateModel);
  if (candidateModel === undefined) throw new Error("Candidate model disappeared from snapshot.");
  const gateOutcomes = {
    context:
      candidateModel.contextWindowTokens >=
      options.callSite.representativeUsage.promptTokens + options.sampling.maxOutputTokens
        ? "pass"
        : "fail",
    cost: savingsPercent >= options.callSite.gates.minSavingsPercent ? "pass" : "fail",
    latency:
      options.callSite.gates.maxP95LatencyMs === undefined ||
      candidateMetrics.p95LatencyMs <= options.callSite.gates.maxP95LatencyMs
        ? "pass"
        : "fail",
    privacy: candidate.every(({ privacySafe }) => privacySafe) ? "pass" : "fail",
    quality:
      passRate >= options.callSite.gates.minPassRate &&
      baselinePassRate - passRate <= options.callSite.gates.maxQualityRegression
        ? "pass"
        : "fail",
  } as const;
  const routeObservation = {
    attempts: candidate.flatMap((result, requestIndex) =>
      result.route.attempts.map((attempt, attemptIndex) => ({
        attemptOrdinal: attemptIndex + 1,
        caseOrdinal: Math.floor(requestIndex / options.sampling.attempts) + 1,
        model: attempt.model,
        providerName: attempt.providerName,
        requestOrdinal: requestIndex + 1,
        repetitionOrdinal: (requestIndex % options.sampling.attempts) + 1,
        statusCode: attempt.statusCode,
      })),
    ),
    requestCount: candidate.length,
    selectedProvider: {
      model: candidate[0]?.route.selectedProvider?.model,
      providerName: candidate[0]?.route.selectedProvider?.providerName,
      providerSlug: options.callSite.routePolicy.providerSlug,
    },
    source: "openrouter-router-metadata" as const,
  };
  return parseCandidateRun({
    ...common,
    baselineMetrics,
    gateOutcomes,
    metrics: candidateMetrics,
    routeObservation,
    status: "complete",
  });
}

function parseCases(input: readonly EvaluationCase[]): readonly EvaluationCase[] {
  const schema = z
    .array(
      z
        .object({
          expected: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
          id: stableIdSchema,
          input: z.string().min(1).max(100_000),
          protectedSegments: z.array(z.string().min(1).max(1_000)).max(100).optional(),
        })
        .strict()
        .superRefine((evaluationCase, context) => {
          if (Object.keys(evaluationCase.expected).length === 0) {
            context.addIssue({
              code: "custom",
              message: "Evaluation cases require at least one expected fact.",
              path: ["expected"],
            });
          }
        }),
    )
    .min(1)
    .max(10_000);
  const parsedCases = schema.parse(input);
  const cases = parsedCases.map((evaluationCase) => ({
    expected: evaluationCase.expected,
    id: evaluationCase.id,
    input: evaluationCase.input,
    ...(evaluationCase.protectedSegments === undefined ||
    evaluationCase.protectedSegments.length === 0
      ? {}
      : { protectedSegments: evaluationCase.protectedSegments }),
  }));
  if (new Set(cases.map(({ id }) => id)).size !== cases.length)
    throw new Error("Duplicate evaluation case ID.");
  return cases;
}

function parseLimits(input: EvaluateOpenRouterCandidateOptions["limits"]) {
  return z
    .object({
      concurrency: z.number().int().min(1).max(32),
      maxRequests: z.number().int().min(1).max(100_000),
      maxSpendUsd: decimalSchema,
      retries: z.number().int().min(0).max(10),
      timeoutMs: z.number().int().min(1).max(300_000),
    })
    .strict()
    .parse(input);
}

function parseSampling(input: EvaluateOpenRouterCandidateOptions["sampling"]) {
  return z
    .object({
      attempts: z.number().int().min(1).max(100),
      maxOutputTokens: z.number().int().min(1).max(1_000_000),
      seed: z.number().int().nonnegative().nullable(),
      temperature: z.number().finite().min(0).max(2),
    })
    .strict()
    .parse(input);
}

function parseRunner(input: EvaluateOpenRouterCandidateOptions["evaluator"]) {
  return z
    .object({
      build: z.string().regex(/^[a-z][a-z0-9-]*:[a-zA-Z0-9._:-]+$/),
      id: stableIdSchema,
      version: z.string().min(1),
    })
    .strict()
    .parse(input);
}

function parseScorer(input: EvaluateOpenRouterCandidateOptions["scorer"]) {
  return z
    .object({ configurationDigest: digestSchema, id: stableIdSchema, version: z.string().min(1) })
    .strict()
    .parse(input);
}

function parseClock(clock: EvaluationClock): string {
  return timestampSchema.parse(clock.now());
}

function createJobs(
  caseCount: number,
  attempts: number,
  baselineModel: string,
  candidateModel: string,
): Job[] {
  const jobs: Job[] = [];
  for (const role of ["baseline", "candidate"] as const) {
    for (let caseIndex = 0; caseIndex < caseCount; caseIndex += 1) {
      for (let repetition = 1; repetition <= attempts; repetition += 1) {
        jobs.push({
          caseIndex,
          model: role === "baseline" ? baselineModel : candidateModel,
          repetition,
          role,
        });
      }
    }
  }
  return jobs;
}

async function executeWithTimeout(
  transport: EvaluationTransport,
  request: Omit<EvaluationTransportRequest, "signal">,
  timeoutMs: number,
): Promise<EvaluationTransportResult> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      transport.execute({ ...request, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new EvaluationTransportError("timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function normalizeResponse(
  response: EvaluationTransportResult,
  evaluationCase: EvaluationCase,
  routePolicy: OpenRouterRoutePolicy,
  expectedModel: string,
): EvaluatedRequest {
  if (
    !Number.isSafeInteger(response.latencyMs) ||
    response.latencyMs <= 0 ||
    !Number.isSafeInteger(response.usage.promptTokens) ||
    response.usage.promptTokens < 0 ||
    !Number.isSafeInteger(response.usage.completionTokens) ||
    response.usage.completionTokens < 0 ||
    response.route.attempts.length === 0 ||
    response.route.selectedProvider === null
  )
    throw new EvaluationTransportError("invalid-output");
  const expectedProvider = routePolicy.providerSlug.split("/", 1)[0];
  const providerMatches = (name: string) => normalizeProvider(name) === expectedProvider;
  if (
    response.route.selectedProvider.model !== expectedModel ||
    !providerMatches(response.route.selectedProvider.providerName) ||
    response.route.attempts.some(
      ({ model, providerName, statusCode }) =>
        model !== expectedModel ||
        !providerMatches(providerName) ||
        !Number.isSafeInteger(statusCode) ||
        statusCode < 100 ||
        statusCode > 599,
    ) ||
    response.route.attempts.filter(
      ({ providerName, statusCode }) =>
        providerMatches(providerName) && statusCode >= 200 && statusCode < 300,
    ).length !== 1
  )
    throw new EvaluationTransportError("invalid-output");
  const outputRecord = isRecord(response.output) ? response.output : undefined;
  const passed =
    outputRecord !== undefined &&
    Object.entries(evaluationCase.expected).every(([key, value]) => outputRecord[key] === value);
  const serializedOutput = JSON.stringify(response.output);
  const privacySafe = (evaluationCase.protectedSegments ?? []).every(
    (segment) => !serializedOutput.includes(segment),
  );
  return {
    caseId: evaluationCase.id,
    latencyMs: response.latencyMs,
    passed,
    privacySafe,
    route: response.route,
    usage: response.usage,
  };
}

async function readBoundedEvaluationBody(
  response: Response,
  maximumBytes: number,
): Promise<string | undefined> {
  if (response.body === null) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function createRouteRequestPolicy(routePolicyInput: OpenRouterRoutePolicy) {
  const routePolicy = openRouterRoutePolicySchema.parse(routePolicyInput);
  return {
    headers: { "X-OpenRouter-Metadata": "enabled" as const },
    provider: {
      allow_fallbacks: routePolicy.allowFallbacks,
      data_collection: routePolicy.dataCollection,
      only: [routePolicy.providerSlug] as readonly [string],
      require_parameters: routePolicy.requireParameters,
      zdr: routePolicy.zdr,
    },
  };
}

function requestResults(
  jobs: readonly Job[],
  results: readonly (EvaluatedRequest | undefined)[],
  role: Job["role"],
): EvaluatedRequest[] {
  return jobs.flatMap((job, index) => {
    const result = results[index];
    return job.role === role && result !== undefined ? [result] : [];
  });
}

function metrics(
  cases: readonly EvaluationCase[],
  results: readonly EvaluatedRequest[],
  attempts: number,
  snapshot: CatalogSnapshot,
  modelId: string,
) {
  const model = snapshot.models.find(({ id }) => id === modelId);
  if (model === undefined) throw new Error("Evaluated model is missing from catalog snapshot.");
  const failedCaseIds = cases
    .filter((evaluationCase) => {
      const caseResults = results.filter(({ caseId }) => caseId === evaluationCase.id);
      return caseResults.length !== attempts || caseResults.some(({ passed }) => !passed);
    })
    .map(({ id }) => id);
  const latencies = results
    .map(({ latencyMs }) => latencyMs)
    .toSorted((left, right) => left - right);
  return {
    caseCount: cases.length,
    costUsd: formatDecimal(
      results.reduce((sum, result) => sum + requestCost(result.usage, model), 0),
    ),
    errorCount: 0,
    failedCaseIds,
    p95LatencyMs: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 1,
    passedCases: cases.length - failedCaseIds.length,
  };
}

function requestCost(
  usage: EvaluationTransportResult["usage"],
  model: CatalogSnapshot["models"][number],
): number {
  return (
    (usage.promptTokens * Number(model.inputPricePerMillionUsd) +
      usage.completionTokens * Number(model.outputPricePerMillionUsd)) /
    1_000_000
  );
}

const BUDGET_DECIMAL_PLACES = 12;
const BUDGET_SCALE = 10n ** BigInt(BUDGET_DECIMAL_PLACES);
const PRICE_DENOMINATOR = 1_000_000n;

function decimalUnitsFloor(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  const normalizedFraction = fraction
    .slice(0, BUDGET_DECIMAL_PLACES)
    .padEnd(BUDGET_DECIMAL_PLACES, "0");
  return BigInt(whole) * BUDGET_SCALE + BigInt(normalizedFraction || "0");
}

function maximumRequestCostUnits(
  model: CatalogSnapshot["models"][number],
  maxOutputTokens: number,
): bigint {
  return (
    tokenCostUnitsCeil(model.contextWindowTokens, model.inputPricePerMillionUsd) +
    tokenCostUnitsCeil(maxOutputTokens, model.outputPricePerMillionUsd)
  );
}

function tokenCostUnitsCeil(tokens: number, pricePerMillionUsd: string): bigint {
  const [whole = "0", fraction = ""] = pricePerMillionUsd.split(".");
  const decimalScale = 10n ** BigInt(fraction.length);
  const price = BigInt(`${whole}${fraction}`);
  const numerator = BigInt(tokens) * price * BUDGET_SCALE;
  const denominator = decimalScale * PRICE_DENOMINATOR;
  return (numerator + denominator - 1n) / denominator;
}

function mapFailure(code: EvaluationTransportErrorCode | undefined): CandidateRun["failureCode"] {
  if (code === "rate-limited") return "rate-limited";
  if (code === "timeout") return "timeout";
  if (code === "invalid-output") return "invalid-output";
  return "provider-error";
}

function normalizeProvider(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function stablePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDecimal(value: number): string {
  if (!Number.isFinite(value) || value < 0)
    throw new Error("Evaluation cost must be finite and non-negative.");
  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
