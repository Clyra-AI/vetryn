import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  VETRYN_ARTIFACT_SCHEMA_VERSION,
  createCatalogContentDigest,
  parseCallSite,
  parseCatalogSnapshot,
  type CallSite,
  type CatalogModel,
  type CatalogSnapshot,
} from "@vetryn/core";
import { z } from "zod";

export const OPENROUTER_CATALOG_URL = "https://openrouter.ai/api/v1/models";
export const OPENROUTER_NORMALIZER_VERSION = "1.0.0";
export const DEFAULT_CANDIDATE_LIMIT = 5;
export const MAX_CANDIDATE_LIMIT = 5;
const MAX_CATALOG_BYTES = 20_000_000;
const MAX_CATALOG_MODELS = 20_000;

const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const modelIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._:-]*)+$/);
const refreshIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const timestampSchema = z.string().datetime({ offset: true });

const rawModelSchema = z
  .object({
    architecture: z.unknown().optional(),
    context_length: z.unknown().optional(),
    id: z.unknown(),
    pricing: z.unknown().optional(),
    supported_parameters: z.unknown().optional(),
  })
  .passthrough();

const rawCatalogSchema = z
  .object({
    data: z.array(z.unknown()).max(MAX_CATALOG_MODELS),
  })
  .passthrough();

const refreshObservationSchema = z
  .object({
    artifactType: z.literal("openrouter-catalog-refresh-observation"),
    acquisition: z.enum(["captured-response", "live-api"]),
    contentDigest: digestSchema.nullable(),
    errorCode: z.enum(["fetch-failed", "http-error", "invalid-catalog"]).nullable(),
    id: refreshIdSchema,
    normalizerVersion: z.literal(OPENROUTER_NORMALIZER_VERSION),
    observedAt: timestampSchema,
    reusedSnapshot: z.boolean(),
    schemaVersion: z.literal("1.0.0"),
    snapshotId: z.string().nullable(),
    source: z.literal("openrouter"),
    sourceRef: z.enum(["openrouter-models-api", "repository-captured-response"]),
    status: z.enum(["success", "failure"]),
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      (observation.acquisition === "live-api" &&
        observation.sourceRef !== "openrouter-models-api") ||
      (observation.acquisition === "captured-response" &&
        observation.sourceRef !== "repository-captured-response")
    ) {
      context.addIssue({
        code: "custom",
        message: "Refresh acquisition mode must match its source reference.",
      });
    }
    if (observation.status === "success") {
      if (
        observation.contentDigest === null ||
        observation.snapshotId === null ||
        observation.errorCode !== null
      ) {
        context.addIssue({ code: "custom", message: "Successful refresh evidence is incomplete." });
      }
    } else if (
      observation.contentDigest !== null ||
      observation.snapshotId !== null ||
      observation.errorCode === null ||
      observation.reusedSnapshot
    ) {
      context.addIssue({
        code: "custom",
        message: "Failed refresh evidence cannot identify a current snapshot.",
      });
    }
  });

export type RefreshObservation = z.infer<typeof refreshObservationSchema>;

export interface CatalogExclusion {
  readonly modelId: string;
  readonly reason:
    "invalid-capabilities" | "invalid-context-window" | "invalid-model-id" | "invalid-pricing";
}

export interface NormalizeCatalogResult {
  readonly exclusions: readonly CatalogExclusion[];
  readonly snapshot: CatalogSnapshot;
}

export interface CatalogStore {
  hasSnapshot(contentDigest: string): Promise<boolean>;
  putObservation(observation: RefreshObservation): Promise<void>;
  putSnapshot(
    snapshot: CatalogSnapshot,
  ): Promise<{ readonly reused: boolean; readonly snapshot: CatalogSnapshot }>;
}

interface RefreshCatalogBaseOptions {
  readonly observedAt: string;
  readonly refreshId: string;
  readonly store: CatalogStore;
}

export type RefreshCatalogOptions = RefreshCatalogBaseOptions &
  (
    | { readonly acquisition: "captured-response"; readonly fetch: typeof globalThis.fetch }
    | { readonly acquisition: "live-api"; readonly fetch?: never }
  );

export type RefreshCatalogResult =
  | {
      readonly observation: RefreshObservation;
      readonly snapshot: CatalogSnapshot;
      readonly status: "success";
    }
  | {
      readonly observation: RefreshObservation;
      readonly snapshot: null;
      readonly status: "failure";
    };

export interface CandidateExclusion {
  readonly modelId: string;
  readonly reason:
    | "baseline-model"
    | "capability-incompatible"
    | "context-window-insufficient"
    | "provider-blocked"
    | "retired";
}

export interface RankedCandidate {
  readonly contextWindowTokens: number;
  readonly modelId: string;
  readonly projectedCostUsd: string;
  readonly provider: string;
}

export interface CandidateShortlist {
  readonly baselineModel: string;
  readonly callSiteId: string;
  readonly candidates: readonly RankedCandidate[];
  readonly catalogContentDigest: string;
  readonly catalogSnapshotId: string;
  readonly exclusions: readonly CandidateExclusion[];
  readonly limit: number;
  readonly representativeUsageProvenanceRef: string;
  readonly schemaVersion: "1.0.0";
}

export interface ResolveCandidatesOptions {
  readonly callSite: CallSite | unknown;
  readonly limit?: number;
  readonly snapshot: CatalogSnapshot | unknown;
}

export class OpenRouterCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterCatalogError";
  }
}

export class FileCatalogStore implements CatalogStore {
  constructor(readonly root: string) {}

  async hasSnapshot(contentDigest: string): Promise<boolean> {
    try {
      await readFile(this.snapshotPath(contentDigest), "utf8");
      return true;
    } catch (error: unknown) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }

  async putSnapshot(
    snapshotInput: CatalogSnapshot,
  ): Promise<{ readonly reused: boolean; readonly snapshot: CatalogSnapshot }> {
    const snapshot = parseCatalogSnapshot(snapshotInput);
    const target = this.snapshotPath(snapshot.contentDigest);
    await mkdir(path.dirname(target), { recursive: true });
    const contents = `${stableJson(snapshot)}\n`;

    try {
      await writeFile(target, contents, { encoding: "utf8", flag: "wx" });
      return { reused: false, snapshot };
    } catch (error: unknown) {
      if (!isExistingFileError(error)) throw error;
      const existing = await readFile(target, "utf8");
      if (existing !== contents) {
        const storedSnapshot = parseCatalogSnapshot(JSON.parse(existing) as unknown);
        if (storedSnapshot.contentDigest !== snapshot.contentDigest) {
          throw new OpenRouterCatalogError(
            `Snapshot collision for immutable digest ${snapshot.contentDigest}.`,
          );
        }
        return { reused: true, snapshot: storedSnapshot };
      }
      return { reused: true, snapshot };
    }
  }

  async putObservation(observationInput: RefreshObservation): Promise<void> {
    const observation = refreshObservationSchema.parse(observationInput);
    const target = path.join(this.root, "observations", `${observation.id}.json`);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, `${stableJson(observation)}\n`, { encoding: "utf8", flag: "wx" });
    } catch (error: unknown) {
      if (isExistingFileError(error)) {
        throw new OpenRouterCatalogError(
          `Refresh observation ${observation.id} already exists; use a unique refresh ID.`,
        );
      }
      throw error;
    }
  }

  private snapshotPath(contentDigest: string): string {
    if (!digestSchema.safeParse(contentDigest).success) {
      throw new OpenRouterCatalogError("Snapshot lookup requires a sha256 content digest.");
    }
    return path.join(this.root, "snapshots", `${contentDigest.slice("sha256:".length)}.json`);
  }
}

export function normalizeOpenRouterCatalog(
  input: unknown,
  observedAt: string,
): NormalizeCatalogResult {
  const catalog = rawCatalogSchema.safeParse(input);
  if (!catalog.success)
    throw new OpenRouterCatalogError("OpenRouter returned an invalid catalog envelope.");
  if (!timestampSchema.safeParse(observedAt).success) {
    throw new OpenRouterCatalogError(
      "Catalog observation time must be an offset-aware ISO timestamp.",
    );
  }

  const exclusions: CatalogExclusion[] = [];
  const models: CatalogModel[] = [];

  for (const value of catalog.data.data) {
    const raw = rawModelSchema.safeParse(value);
    const rawId = raw.success && typeof raw.data.id === "string" ? raw.data.id : "unknown";
    if (
      !raw.success ||
      typeof raw.data.id !== "string" ||
      raw.data.id.length > 500 ||
      !modelIdSchema.safeParse(raw.data.id).success
    ) {
      exclusions.push({ modelId: rawId, reason: "invalid-model-id" });
      continue;
    }
    const provider = raw.data.id.slice(0, raw.data.id.indexOf("/"));
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(provider)) {
      exclusions.push({ modelId: raw.data.id, reason: "invalid-model-id" });
      continue;
    }
    if (
      typeof raw.data.context_length !== "number" ||
      !Number.isSafeInteger(raw.data.context_length) ||
      raw.data.context_length <= 0
    ) {
      exclusions.push({ modelId: raw.data.id, reason: "invalid-context-window" });
      continue;
    }
    const pricing = isRecord(raw.data.pricing) ? raw.data.pricing : undefined;
    const prompt = parsePerTokenPrice(pricing?.prompt);
    const completion = parsePerTokenPrice(pricing?.completion);
    if (prompt === undefined || completion === undefined) {
      exclusions.push({ modelId: raw.data.id, reason: "invalid-pricing" });
      continue;
    }
    const inputPricePerMillionUsd = multiplyDecimalByInteger(prompt, 1_000_000);
    const outputPricePerMillionUsd = multiplyDecimalByInteger(completion, 1_000_000);
    if (!isCoreDecimal(inputPricePerMillionUsd) || !isCoreDecimal(outputPricePerMillionUsd)) {
      exclusions.push({ modelId: raw.data.id, reason: "invalid-pricing" });
      continue;
    }
    const architecture = isRecord(raw.data.architecture) ? raw.data.architecture : undefined;
    const parameters = parseBoundedStringArray(raw.data.supported_parameters, 200);
    const outputModalities = parseBoundedStringArray(architecture?.output_modalities, 20);
    if (parameters === undefined || outputModalities === undefined) {
      exclusions.push({ modelId: raw.data.id, reason: "invalid-capabilities" });
      continue;
    }

    const textGeneration = outputModalities.includes("text");
    if (!textGeneration) {
      exclusions.push({ modelId: raw.data.id, reason: "invalid-capabilities" });
      continue;
    }
    models.push({
      capabilities: {
        structuredOutput:
          parameters.includes("response_format") || parameters.includes("structured_outputs"),
        textGeneration: true,
        toolCalls: parameters.includes("tools") || parameters.includes("tool_choice"),
      },
      contextWindowTokens: raw.data.context_length,
      id: raw.data.id,
      inputPricePerMillionUsd,
      outputPricePerMillionUsd,
      provider,
      retired: false,
    });
  }

  if (models.length === 0) {
    throw new OpenRouterCatalogError(
      "OpenRouter catalog has no models with complete trusted metadata.",
    );
  }
  const sortedModels = models.toSorted((left, right) => compareText(left.id, right.id));
  const contentDigest = createCatalogContentDigest(sortedModels);
  const digestSuffix = contentDigest.slice("sha256:".length);
  const snapshot = parseCatalogSnapshot({
    artifactType: "catalog-snapshot",
    contentDigest,
    id: `catalog-snapshot:openrouter--sha256-${digestSuffix}`,
    models: sortedModels,
    observedAt,
    schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
    source: "openrouter",
  });
  return { exclusions, snapshot };
}

export async function refreshOpenRouterCatalog(
  options: RefreshCatalogOptions,
): Promise<RefreshCatalogResult> {
  const { acquisition, observedAt, refreshId, store } = options;
  if (acquisition !== "captured-response" && acquisition !== "live-api") {
    throw new OpenRouterCatalogError("Catalog refresh requires an explicit acquisition mode.");
  }
  if (acquisition === "captured-response" && options.fetch === undefined) {
    throw new OpenRouterCatalogError(
      "Captured-response provenance requires an injected repository capture transport.",
    );
  }
  if (acquisition === "live-api" && "fetch" in options && options.fetch !== undefined) {
    throw new OpenRouterCatalogError(
      "Live OpenRouter provenance cannot use an injected transport; use captured-response instead.",
    );
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  refreshIdSchema.parse(refreshId);
  timestampSchema.parse(observedAt);

  let body: string;
  try {
    const response = await fetchImplementation(OPENROUTER_CATALOG_URL, {
      headers: { accept: "application/json" },
      method: "GET",
    });
    if (!response.ok) {
      return recordRefreshFailure(store, refreshId, observedAt, acquisition, "http-error");
    }
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > MAX_CATALOG_BYTES) {
      return recordRefreshFailure(store, refreshId, observedAt, acquisition, "invalid-catalog");
    }
    const boundedBody = await readResponseBody(response, MAX_CATALOG_BYTES);
    if (boundedBody === undefined) {
      return recordRefreshFailure(store, refreshId, observedAt, acquisition, "invalid-catalog");
    }
    body = boundedBody;
  } catch {
    return recordRefreshFailure(store, refreshId, observedAt, acquisition, "fetch-failed");
  }

  let input: unknown;
  try {
    input = JSON.parse(body) as unknown;
  } catch {
    return recordRefreshFailure(store, refreshId, observedAt, acquisition, "invalid-catalog");
  }

  let normalizedSnapshot: CatalogSnapshot;
  try {
    normalizedSnapshot = normalizeOpenRouterCatalog(input, observedAt).snapshot;
  } catch {
    return recordRefreshFailure(store, refreshId, observedAt, acquisition, "invalid-catalog");
  }

  const stored = await store.putSnapshot(normalizedSnapshot);
  const snapshot = stored.snapshot;
  const observation = refreshObservationSchema.parse({
    artifactType: "openrouter-catalog-refresh-observation",
    acquisition,
    contentDigest: snapshot.contentDigest,
    errorCode: null,
    id: refreshId,
    normalizerVersion: OPENROUTER_NORMALIZER_VERSION,
    observedAt,
    reusedSnapshot: stored.reused,
    schemaVersion: "1.0.0",
    snapshotId: snapshot.id,
    source: "openrouter",
    sourceRef:
      acquisition === "live-api" ? "openrouter-models-api" : "repository-captured-response",
    status: "success",
  });
  await store.putObservation(observation);
  return { observation, snapshot, status: "success" };
}

export function resolveCandidates({
  callSite: callSiteInput,
  limit: limitInput = DEFAULT_CANDIDATE_LIMIT,
  snapshot: snapshotInput,
}: ResolveCandidatesOptions): CandidateShortlist {
  const callSite = parseCallSite(callSiteInput);
  const snapshot = parseCatalogSnapshot(snapshotInput);
  const limit = assertCandidateLimit(limitInput);
  assertRepresentativeUsage(callSite);

  const candidates: RankedCandidate[] = [];
  const exclusions: CandidateExclusion[] = [];
  for (const model of snapshot.models) {
    const reason = exclusionReason(model, callSite);
    if (reason !== undefined) {
      exclusions.push({ modelId: model.id, reason });
      continue;
    }
    candidates.push({
      contextWindowTokens: model.contextWindowTokens,
      modelId: model.id,
      projectedCostUsd: addDecimals(
        multiplyDecimalByInteger(
          model.inputPricePerMillionUsd,
          callSite.representativeUsage.promptTokens,
        ),
        multiplyDecimalByInteger(
          model.outputPricePerMillionUsd,
          callSite.representativeUsage.completionTokens,
        ),
      ),
      provider: model.provider,
    });
  }

  candidates.sort((left, right) => {
    const cost = compareDecimals(left.projectedCostUsd, right.projectedCostUsd);
    if (cost !== 0) return cost;
    if (left.contextWindowTokens !== right.contextWindowTokens) {
      return right.contextWindowTokens - left.contextWindowTokens;
    }
    return compareText(left.modelId, right.modelId);
  });

  return {
    baselineModel: callSite.currentModel,
    callSiteId: callSite.id,
    candidates: candidates.slice(0, limit),
    catalogContentDigest: snapshot.contentDigest,
    catalogSnapshotId: snapshot.id,
    exclusions: exclusions.toSorted((left, right) => compareText(left.modelId, right.modelId)),
    limit,
    representativeUsageProvenanceRef: callSite.representativeUsage.provenanceRef,
    schemaVersion: "1.0.0",
  };
}

async function recordRefreshFailure(
  store: CatalogStore,
  refreshId: string,
  observedAt: string,
  acquisition: "captured-response" | "live-api",
  errorCode: "fetch-failed" | "http-error" | "invalid-catalog",
): Promise<Extract<RefreshCatalogResult, { status: "failure" }>> {
  const observation = refreshObservationSchema.parse({
    artifactType: "openrouter-catalog-refresh-observation",
    acquisition,
    contentDigest: null,
    errorCode,
    id: refreshId,
    normalizerVersion: OPENROUTER_NORMALIZER_VERSION,
    observedAt,
    reusedSnapshot: false,
    schemaVersion: "1.0.0",
    snapshotId: null,
    source: "openrouter",
    sourceRef:
      acquisition === "live-api" ? "openrouter-models-api" : "repository-captured-response",
    status: "failure",
  });
  await store.putObservation(observation);
  return { observation, snapshot: null, status: "failure" };
}

function exclusionReason(
  model: CatalogModel,
  callSite: CallSite,
): CandidateExclusion["reason"] | undefined {
  if (model.id === callSite.currentModel) return "baseline-model";
  if (model.retired) return "retired";
  if (!callSite.providerPolicy.allowedProviders.includes(model.provider)) return "provider-blocked";
  if (
    model.contextWindowTokens <
    callSite.representativeUsage.promptTokens + callSite.representativeUsage.completionTokens
  ) {
    return "context-window-insufficient";
  }
  if (
    !model.capabilities.textGeneration ||
    (callSite.requiredCapabilities.structuredOutput && !model.capabilities.structuredOutput) ||
    (callSite.requiredCapabilities.toolCalls && !model.capabilities.toolCalls)
  ) {
    return "capability-incompatible";
  }
  return undefined;
}

function assertCandidateLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CANDIDATE_LIMIT) {
    throw new OpenRouterCatalogError(
      `Candidate limit must be a repository-configured integer from 1 to ${MAX_CANDIDATE_LIMIT}.`,
    );
  }
  return value;
}

function assertRepresentativeUsage(callSite: CallSite): void {
  const { completionTokens, promptTokens, provenanceRef, reviewed } = callSite.representativeUsage;
  if (
    reviewed !== true ||
    provenanceRef.length === 0 ||
    !Number.isSafeInteger(promptTokens) ||
    !Number.isSafeInteger(completionTokens) ||
    promptTokens < 0 ||
    completionTokens < 0 ||
    !Number.isSafeInteger(promptTokens + completionTokens) ||
    promptTokens + completionTokens === 0
  ) {
    throw new OpenRouterCatalogError(
      "Candidate resolution requires a reviewed, provenance-bound representative usage profile with non-negative integer token weights.",
    );
  }
}

async function readResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<string | undefined> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, byteLength).toString("utf8");
}

function parsePerTokenPrice(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 100 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
  )
    return undefined;
  return normalizeDecimal(value);
}

function isCoreDecimal(value: string): boolean {
  return value.length <= 100 && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value);
}

function parseBoundedStringArray(value: unknown, maximumLength: number): string[] | undefined {
  if (!Array.isArray(value) || value.length > maximumLength) return undefined;
  if (value.some((entry) => typeof entry !== "string" || entry.length > 100)) return undefined;
  return value as string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function multiplyDecimalByInteger(value: string, multiplier: number): string {
  if (!Number.isSafeInteger(multiplier) || multiplier < 0) {
    throw new OpenRouterCatalogError("Decimal multiplier must be a non-negative safe integer.");
  }
  const decimal = parseDecimal(value);
  return formatDecimal(decimal.integer * BigInt(multiplier), decimal.scale);
}

function addDecimals(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const leftInteger = a.integer * 10n ** BigInt(scale - a.scale);
  const rightInteger = b.integer * 10n ** BigInt(scale - b.scale);
  return formatDecimal(leftInteger + rightInteger, scale);
}

function compareDecimals(left: string, right: string): number {
  const difference = addDecimals(left, negateForComparison(right));
  if (difference.startsWith("-")) return -1;
  return difference === "0" ? 0 : 1;
}

function negateForComparison(value: string): string {
  return `-${value}`;
}

function parseDecimal(value: string): { integer: bigint; scale: number } {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(unsigned)) {
    throw new OpenRouterCatalogError(`Invalid decimal value: ${value}`);
  }
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const integer = BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n);
  return { integer, scale: fraction.length };
}

function formatDecimal(integer: bigint, scale: number): string {
  const negative = integer < 0n;
  const digits = (negative ? -integer : integer).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? "" : digits.slice(-scale).replace(/0+$/, "");
  const value = fraction.length === 0 ? whole : `${whole}.${fraction}`;
  return `${negative && value !== "0" ? "-" : ""}${value}`;
}

function normalizeDecimal(value: string): string {
  const parsed = parseDecimal(value);
  return formatDecimal(parsed.integer, parsed.scale);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isExistingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
