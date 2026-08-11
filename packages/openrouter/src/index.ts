import { createReadStream } from "node:fs";
import { lstat, mkdir, realpath, unlink, writeFile } from "node:fs/promises";
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
const MAX_CAPTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

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
    | "ambiguous-model-id"
    | "invalid-capabilities"
    | "invalid-context-window"
    | "invalid-model-id"
    | "invalid-pricing";
}

export interface NormalizeCatalogResult {
  readonly exclusions: readonly CatalogExclusion[];
  readonly snapshot: CatalogSnapshot;
}

export interface CatalogStore {
  hasSnapshot(contentDigest: string): Promise<boolean>;
  putObservation(observation: RefreshObservation): Promise<void>;
  putRefresh(
    snapshot: CatalogSnapshot,
    observation: Omit<RefreshObservation, "reusedSnapshot">,
  ): Promise<{ readonly observation: RefreshObservation; readonly snapshot: CatalogSnapshot }>;
  putSnapshot(
    snapshot: CatalogSnapshot,
  ): Promise<{ readonly reused: boolean; readonly snapshot: CatalogSnapshot }>;
}

interface RefreshCatalogBaseOptions {
  readonly refreshId: string;
  readonly store: CatalogStore;
}

export type RefreshCatalogOptions = RefreshCatalogBaseOptions &
  (
    | {
        readonly acquisition: "captured-response";
        readonly fetch: typeof globalThis.fetch;
        readonly observedAt: string;
      }
    | { readonly acquisition: "live-api"; readonly fetch?: never; readonly observedAt?: never }
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
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  async hasSnapshot(contentDigest: string): Promise<boolean> {
    try {
      const target = this.snapshotPath(contentDigest);
      await this.assertSafeTarget(target, false);
      await readBoundedCatalogFile(target);
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
    assertCanonicalOpenRouterSnapshot(snapshot);
    const target = this.snapshotPath(snapshot.contentDigest);
    await this.assertSafeTarget(target, true);
    const contents = `${stableJson(snapshot)}\n`;

    try {
      await writeFile(target, contents, { encoding: "utf8", flag: "wx" });
      return { reused: false, snapshot };
    } catch (error: unknown) {
      if (!isExistingFileError(error)) throw error;
      const existing = await readBoundedCatalogFile(target);
      if (existing !== contents) {
        const storedSnapshot = parseCatalogSnapshot(JSON.parse(existing) as unknown);
        if (!isReusableOpenRouterSnapshot(storedSnapshot, snapshot)) {
          throw new OpenRouterCatalogError(
            `Snapshot collision or invalid provenance for immutable digest ${snapshot.contentDigest}.`,
          );
        }
        return { reused: true, snapshot: storedSnapshot };
      }
      return { reused: true, snapshot };
    }
  }

  async putRefresh(
    snapshotInput: CatalogSnapshot,
    observationInput: Omit<RefreshObservation, "reusedSnapshot">,
  ): Promise<{ readonly observation: RefreshObservation; readonly snapshot: CatalogSnapshot }> {
    const snapshot = parseCatalogSnapshot(snapshotInput);
    assertCanonicalOpenRouterSnapshot(snapshot);
    const existingSnapshot = await this.readReusableSnapshot(snapshot);
    const observation = refreshObservationSchema.parse({
      ...observationInput,
      reusedSnapshot: existingSnapshot !== undefined,
    });
    if (
      observation.status !== "success" ||
      observation.contentDigest !== snapshot.contentDigest ||
      observation.snapshotId !== snapshot.id
    ) {
      throw new OpenRouterCatalogError(
        "Successful refresh evidence must identify its exact canonical snapshot.",
      );
    }

    await this.putObservation(observation);
    if (existingSnapshot !== undefined) {
      return { observation, snapshot: existingSnapshot };
    }

    try {
      const stored = await this.putSnapshot(snapshot);
      return { observation, snapshot: stored.snapshot };
    } catch (error: unknown) {
      await this.removeObservation(observation);
      throw error;
    }
  }

  async putObservation(observationInput: RefreshObservation): Promise<void> {
    const observation = refreshObservationSchema.parse(observationInput);
    const target = path.join(this.root, "observations", `${observation.id}.json`);
    await this.assertSafeTarget(target, true);
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

  private async readReusableSnapshot(
    snapshot: CatalogSnapshot,
  ): Promise<CatalogSnapshot | undefined> {
    try {
      const target = this.snapshotPath(snapshot.contentDigest);
      await this.assertSafeTarget(target, false);
      const existing = parseCatalogSnapshot(
        JSON.parse(await readBoundedCatalogFile(target)) as unknown,
      );
      if (!isReusableOpenRouterSnapshot(existing, snapshot)) {
        throw new OpenRouterCatalogError(
          `Snapshot collision or invalid provenance for immutable digest ${snapshot.contentDigest}.`,
        );
      }
      return existing;
    } catch (error: unknown) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  private async removeObservation(observation: RefreshObservation): Promise<void> {
    const target = path.join(this.root, "observations", `${observation.id}.json`);
    const expected = `${stableJson(observation)}\n`;
    try {
      await this.assertSafeTarget(target, false);
      if ((await readBoundedCatalogFile(target)) === expected) await unlink(target);
    } catch (error: unknown) {
      if (!isMissingFileError(error)) throw error;
    }
  }

  private async assertSafeTarget(target: string, createParent: boolean): Promise<void> {
    const absoluteTarget = path.resolve(target);
    const relativeTarget = path.relative(this.root, absoluteTarget);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeTarget)
    ) {
      throw new OpenRouterCatalogError("Catalog store target escapes its configured root.");
    }

    const parent = path.dirname(absoluteTarget);
    await this.assertNoSymbolicLinks(parent, absoluteTarget);
    if (!createParent) return;
    await mkdir(parent, { recursive: true });
    await this.assertNoSymbolicLinks(parent, absoluteTarget);

    const [resolvedRoot, resolvedParent] = await Promise.all([
      realpath(this.root),
      realpath(parent),
    ]);
    const relativeParent = path.relative(resolvedRoot, resolvedParent);
    if (
      relativeParent === ".." ||
      relativeParent.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeParent)
    ) {
      throw new OpenRouterCatalogError("Catalog store destination resolves outside its root.");
    }
  }

  private async assertNoSymbolicLinks(parent: string, target: string): Promise<void> {
    const relativeParent = path.relative(this.root, parent);
    const components = [this.root];
    let current = this.root;
    for (const component of relativeParent.split(path.sep).filter(Boolean)) {
      current = path.join(current, component);
      components.push(current);
    }
    components.push(target);

    for (const component of components) {
      try {
        if ((await lstat(component)).isSymbolicLink()) {
          throw new OpenRouterCatalogError(
            `Catalog store refuses symbolic-link path component ${component}.`,
          );
        }
      } catch (error: unknown) {
        if (isMissingFileError(error)) continue;
        throw error;
      }
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
  const models = new Map<string, CatalogModel>();
  const ambiguousModelIds = new Set<string>();
  const rawModelIdCounts = new Map<string, number>();

  for (const value of catalog.data.data) {
    const raw = rawModelSchema.safeParse(value);
    if (raw.success && typeof raw.data.id === "string") {
      rawModelIdCounts.set(raw.data.id, (rawModelIdCounts.get(raw.data.id) ?? 0) + 1);
    }
  }

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
    const modelId = raw.data.id;
    const provider = modelId.slice(0, modelId.indexOf("/"));
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(provider)) {
      exclusions.push({ modelId, reason: "invalid-model-id" });
      continue;
    }
    const exclude = (reason: CatalogExclusion["reason"]): void => {
      if ((rawModelIdCounts.get(modelId) ?? 0) > 1) {
        models.delete(modelId);
        if (!ambiguousModelIds.has(modelId)) {
          ambiguousModelIds.add(modelId);
          exclusions.push({ modelId, reason: "ambiguous-model-id" });
        }
      } else {
        exclusions.push({ modelId, reason });
      }
    };
    if (ambiguousModelIds.has(modelId)) continue;
    if (
      typeof raw.data.context_length !== "number" ||
      !Number.isSafeInteger(raw.data.context_length) ||
      raw.data.context_length <= 0
    ) {
      exclude("invalid-context-window");
      continue;
    }
    const pricing = isRecord(raw.data.pricing) ? raw.data.pricing : undefined;
    const prompt = parsePerTokenPrice(pricing?.prompt);
    const completion = parsePerTokenPrice(pricing?.completion);
    if (prompt === undefined || completion === undefined) {
      exclude("invalid-pricing");
      continue;
    }
    const inputPricePerMillionUsd = multiplyDecimalByInteger(prompt, 1_000_000);
    const outputPricePerMillionUsd = multiplyDecimalByInteger(completion, 1_000_000);
    if (!isCoreDecimal(inputPricePerMillionUsd) || !isCoreDecimal(outputPricePerMillionUsd)) {
      exclude("invalid-pricing");
      continue;
    }
    const architecture = isRecord(raw.data.architecture) ? raw.data.architecture : undefined;
    const parameters = parseBoundedStringArray(raw.data.supported_parameters, 200);
    const outputModalities = parseBoundedStringArray(architecture?.output_modalities, 20);
    if (parameters === undefined || outputModalities === undefined) {
      exclude("invalid-capabilities");
      continue;
    }

    const textGeneration = outputModalities.includes("text");
    if (!textGeneration) {
      exclude("invalid-capabilities");
      continue;
    }
    const model: CatalogModel = {
      capabilities: {
        structuredOutput:
          parameters.includes("response_format") || parameters.includes("structured_outputs"),
        textGeneration: true,
        toolCalls: parameters.includes("tools") || parameters.includes("tool_choice"),
      },
      contextWindowTokens: raw.data.context_length,
      id: modelId,
      inputPricePerMillionUsd,
      outputPricePerMillionUsd,
      provider,
      retired: false,
    };
    const existingModel = models.get(model.id);
    if (existingModel === undefined) {
      models.set(model.id, model);
    } else if (stableJson(existingModel) !== stableJson(model)) {
      models.delete(model.id);
      ambiguousModelIds.add(model.id);
      exclusions.push({ modelId: model.id, reason: "ambiguous-model-id" });
    }
  }

  if (models.size === 0) {
    throw new OpenRouterCatalogError(
      "OpenRouter catalog has no models with complete trusted metadata.",
    );
  }
  const sortedModels = [...models.values()].toSorted((left, right) =>
    compareText(left.id, right.id),
  );
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
  const { acquisition, refreshId, store } = options;
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
  const observedAt = acquisition === "live-api" ? new Date().toISOString() : options.observedAt;
  refreshIdSchema.parse(refreshId);
  timestampSchema.parse(observedAt);
  if (
    acquisition === "captured-response" &&
    Date.parse(observedAt) > Date.now() + MAX_CAPTURE_CLOCK_SKEW_MS
  ) {
    throw new OpenRouterCatalogError(
      "Captured catalog observation time cannot exceed the trusted clock by more than five minutes.",
    );
  }

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

  const observationInput = {
    artifactType: "openrouter-catalog-refresh-observation",
    acquisition,
    contentDigest: normalizedSnapshot.contentDigest,
    errorCode: null,
    id: refreshId,
    normalizerVersion: OPENROUTER_NORMALIZER_VERSION,
    observedAt,
    schemaVersion: "1.0.0",
    snapshotId: normalizedSnapshot.id,
    source: "openrouter",
    sourceRef:
      acquisition === "live-api" ? "openrouter-models-api" : "repository-captured-response",
    status: "success",
  } as const;
  const committed = await store.putRefresh(normalizedSnapshot, observationInput);
  return { ...committed, status: "success" };
}

export function resolveCandidates({
  callSite: callSiteInput,
  limit: limitInput = DEFAULT_CANDIDATE_LIMIT,
  snapshot: snapshotInput,
}: ResolveCandidatesOptions): CandidateShortlist {
  const callSite = parseCallSite(callSiteInput);
  const snapshot = parseCatalogSnapshot(snapshotInput);
  assertCanonicalOpenRouterSnapshot(snapshot);
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
      projectedCostUsd: divideDecimalByPowerOfTen(
        addDecimals(
          multiplyDecimalByInteger(
            model.inputPricePerMillionUsd,
            callSite.representativeUsage.promptTokens,
          ),
          multiplyDecimalByInteger(
            model.outputPricePerMillionUsd,
            callSite.representativeUsage.completionTokens,
          ),
        ),
        6,
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

async function readBoundedCatalogFile(filePath: string): Promise<string> {
  const stream = createReadStream(filePath);
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_CATALOG_BYTES) {
      stream.destroy();
      throw new OpenRouterCatalogError(
        `Stored catalog input exceeds the ${MAX_CATALOG_BYTES}-byte limit.`,
      );
    }
    chunks.push(buffer);
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

function divideDecimalByPowerOfTen(value: string, exponent: number): string {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new OpenRouterCatalogError("Decimal exponent must be a non-negative safe integer.");
  }
  const decimal = parseDecimal(value);
  return formatDecimal(decimal.integer, decimal.scale + exponent);
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

function isReusableOpenRouterSnapshot(stored: CatalogSnapshot, incoming: CatalogSnapshot): boolean {
  return (
    hasCanonicalOpenRouterIdentity(stored) &&
    stored.contentDigest === incoming.contentDigest &&
    Date.parse(stored.observedAt) <= Date.parse(incoming.observedAt)
  );
}

function assertCanonicalOpenRouterSnapshot(snapshot: CatalogSnapshot): void {
  if (!hasCanonicalOpenRouterIdentity(snapshot)) {
    throw new OpenRouterCatalogError(
      "Candidate resolution requires a canonical digest-derived OpenRouter snapshot.",
    );
  }
}

function hasCanonicalOpenRouterIdentity(snapshot: CatalogSnapshot): boolean {
  return (
    snapshot.artifactType === "catalog-snapshot" &&
    snapshot.id ===
      `catalog-snapshot:openrouter--sha256-${snapshot.contentDigest.slice("sha256:".length)}` &&
    snapshot.schemaVersion === VETRYN_ARTIFACT_SCHEMA_VERSION &&
    snapshot.source === "openrouter"
  );
}
