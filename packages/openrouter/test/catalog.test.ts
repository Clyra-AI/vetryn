import { readFile } from "node:fs/promises";

import {
  createCatalogContentDigest,
  parseCatalogSnapshot,
  type CatalogSnapshot,
} from "@vetryn/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FileCatalogStore,
  OpenRouterCatalogError,
  normalizeOpenRouterCatalog,
  refreshOpenRouterCatalog,
  resolveCandidates,
  type CatalogStore,
  type RefreshObservation,
} from "../src/index.js";

const observedAt = "2026-08-11T12:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}`;

const rawModel = (
  id: string,
  options: {
    readonly completion?: string;
    readonly context?: number;
    readonly outputModalities?: readonly string[];
    readonly parameters?: readonly string[];
    readonly prompt?: string;
  } = {},
) => ({
  architecture: { output_modalities: options.outputModalities ?? ["text"] },
  context_length: options.context ?? 128_000,
  id,
  pricing: {
    completion: options.completion ?? "0.0000006",
    prompt: options.prompt ?? "0.00000015",
  },
  supported_parameters: options.parameters ?? ["response_format"],
});

const callSite = {
  currentModel: "mock/baseline",
  evalSuiteId: "eval-suite:support-classification",
  gates: {
    maxQualityRegression: 0,
    minCases: 30,
    minPassRate: 0.98,
    minRecommendationConfidence: 0.8,
    minSavingsPercent: 20,
  },
  id: "support-classification",
  name: "Support classification",
  owner: "support-platform",
  providerPolicy: { allowedProviders: ["mock"] },
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
};

const catalogModel = (
  id: string,
  input: string,
  output: string,
  contextWindowTokens: number,
  options: {
    readonly provider?: string;
    readonly retired?: boolean;
    readonly tools?: boolean;
  } = {},
) => ({
  capabilities: {
    structuredOutput: true,
    textGeneration: true,
    toolCalls: options.tools ?? false,
  },
  contextWindowTokens,
  id,
  inputPricePerMillionUsd: input,
  outputPricePerMillionUsd: output,
  provider: options.provider ?? id.slice(0, id.indexOf("/")),
  retired: options.retired ?? false,
});

class MemoryStore implements CatalogStore {
  readonly observations: RefreshObservation[] = [];
  readonly snapshots = new Map<string, CatalogSnapshot>();

  async hasSnapshot(contentDigest: string): Promise<boolean> {
    return this.snapshots.has(contentDigest);
  }

  async putObservation(observation: RefreshObservation): Promise<void> {
    if (this.observations.some(({ id }) => id === observation.id)) {
      throw new OpenRouterCatalogError("duplicate observation");
    }
    this.observations.push(observation);
  }

  async putSnapshot(
    snapshot: CatalogSnapshot,
  ): Promise<{ readonly reused: boolean; readonly snapshot: CatalogSnapshot }> {
    const existing = this.snapshots.get(snapshot.contentDigest);
    if (existing !== undefined) return { reused: true, snapshot: existing };
    this.snapshots.set(snapshot.contentDigest, snapshot);
    return { reused: false, snapshot };
  }
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("OpenRouter catalog normalization", () => {
  it("normalizes complete metadata into a deterministic content-addressed snapshot", () => {
    const input = {
      data: [
        rawModel("openai/gpt-small", {
          completion: "0.00000060",
          context: 128_000,
          parameters: ["response_format", "tools"],
          prompt: "0.00000015",
        }),
        rawModel("anthropic/claude-small", {
          completion: "0.000004",
          context: 200_000,
          prompt: "0.0000008",
        }),
      ],
    };
    const first = normalizeOpenRouterCatalog(input, observedAt);
    const second = normalizeOpenRouterCatalog({ data: [...input.data].reverse() }, observedAt);

    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.snapshot.id).toBe(
      `catalog-snapshot:openrouter--sha256-${first.snapshot.contentDigest.slice(7)}`,
    );
    expect(first.snapshot.models).toEqual([
      expect.objectContaining({
        id: "anthropic/claude-small",
        inputPricePerMillionUsd: "0.8",
        outputPricePerMillionUsd: "4",
      }),
      expect.objectContaining({
        capabilities: expect.objectContaining({ structuredOutput: true, toolCalls: true }),
        id: "openai/gpt-small",
        inputPricePerMillionUsd: "0.15",
        outputPricePerMillionUsd: "0.6",
      }),
    ]);
  });

  it("fails closed on missing, malformed, or ambiguous pricing and capabilities", () => {
    const result = normalizeOpenRouterCatalog(
      {
        data: [
          rawModel("mock/valid"),
          { ...rawModel("mock/no-price"), pricing: { prompt: "0.1" } },
          { ...rawModel("mock/negative-price"), pricing: { completion: "-1", prompt: "0" } },
          { ...rawModel("mock/no-capabilities"), supported_parameters: undefined },
          { ...rawModel("mock/no-modalities"), architecture: {} },
          { ...rawModel("mock/no-context"), context_length: undefined },
          rawModel("INVALID MODEL"),
        ],
      },
      observedAt,
    );

    expect(result.snapshot.models.map(({ id }) => id)).toEqual(["mock/valid"]);
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        { modelId: "mock/no-price", reason: "invalid-pricing" },
        { modelId: "mock/negative-price", reason: "invalid-pricing" },
        { modelId: "mock/no-capabilities", reason: "invalid-capabilities" },
        { modelId: "mock/no-modalities", reason: "invalid-capabilities" },
        { modelId: "mock/no-context", reason: "invalid-context-window" },
        { modelId: "INVALID MODEL", reason: "invalid-model-id" },
      ]),
    );
  });
});

describe("candidate resolution", () => {
  it("filters first, computes exact weighted costs, and applies the locked ranking tuple", () => {
    const snapshot = createRankingSnapshot();
    const shortlist = resolveCandidates({ callSite, snapshot });

    expect(shortlist.candidates).toEqual([
      expect.objectContaining({ modelId: "mock/alpha", projectedCostUsd: "10.9" }),
      expect.objectContaining({ modelId: "mock/bravo", projectedCostUsd: "11" }),
      expect.objectContaining({ modelId: "mock/charlie", projectedCostUsd: "11" }),
      expect.objectContaining({ modelId: "mock/delta", projectedCostUsd: "11" }),
      expect.objectContaining({ modelId: "mock/echo", projectedCostUsd: "11.8" }),
    ]);
    expect(shortlist.catalogSnapshotId).toBe(snapshot.id);
    expect(shortlist.catalogContentDigest).toBe(snapshot.contentDigest);
    expect(shortlist.exclusions).toEqual(
      expect.arrayContaining([
        { modelId: "mock/baseline", reason: "baseline-model" },
        { modelId: "mock/retired", reason: "retired" },
        { modelId: "other/blocked", reason: "provider-blocked" },
      ]),
    );
  });

  it("allows only a lower repository bound and fails closed on invalid usage", () => {
    const snapshot = createRankingSnapshot();
    expect(
      resolveCandidates({ callSite, limit: 2, snapshot }).candidates.map(({ modelId }) => modelId),
    ).toEqual(["mock/alpha", "mock/bravo"]);
    for (const limit of [0, 6, 1.5, Number.NaN]) {
      expect(() => resolveCandidates({ callSite, limit, snapshot })).toThrow(/limit/i);
    }
    for (const representativeUsage of [
      undefined,
      { ...callSite.representativeUsage, reviewed: false },
      { ...callSite.representativeUsage, provenanceRef: "" },
      { ...callSite.representativeUsage, promptTokens: -1 },
      { ...callSite.representativeUsage, promptTokens: 0, completionTokens: 0 },
      { ...callSite.representativeUsage, promptTokens: 0.5 },
    ]) {
      expect(() =>
        resolveCandidates({
          callSite: { ...callSite, representativeUsage },
          snapshot,
        }),
      ).toThrow();
    }
  });
});

describe("refresh evidence", () => {
  it("reuses unchanged content while recording every successful observation", async () => {
    const store = new MemoryStore();
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [rawModel("mock/alpha")] })),
    );

    const first = await refreshOpenRouterCatalog({
      fetch,
      observedAt,
      refreshId: "refresh-1",
      store,
    });
    const second = await refreshOpenRouterCatalog({
      fetch,
      observedAt: "2026-08-11T13:00:00.000Z",
      refreshId: "refresh-2",
      store,
    });

    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    if (first.status !== "success" || second.status !== "success") throw new Error("unexpected");
    expect(second.snapshot).toEqual(first.snapshot);
    expect(first.observation.reusedSnapshot).toBe(false);
    expect(second.observation.reusedSnapshot).toBe(true);
    expect(store.snapshots.size).toBe(1);
    expect(store.observations.map(({ id }) => id)).toEqual(["refresh-1", "refresh-2"]);
  });

  it("records failure without presenting an older snapshot as current", async () => {
    const store = new MemoryStore();
    await refreshOpenRouterCatalog({
      fetch: async () => new Response(JSON.stringify({ data: [rawModel("mock/old")] })),
      observedAt,
      refreshId: "refresh-old",
      store,
    });
    const failure = await refreshOpenRouterCatalog({
      fetch: async () => new Response("unavailable", { status: 503 }),
      observedAt: "2026-08-11T14:00:00.000Z",
      refreshId: "refresh-failed",
      store,
    });

    expect(failure).toMatchObject({
      observation: {
        contentDigest: null,
        errorCode: "http-error",
        reusedSnapshot: false,
        snapshotId: null,
        status: "failure",
      },
      snapshot: null,
      status: "failure",
    });
    expect(store.snapshots.size).toBe(1);
  });

  it("persists immutable content-addressed snapshots and observations", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(`${tmpdir()}/vetryn-openrouter-`);
    temporaryDirectories.push(root);
    const store = new FileCatalogStore(root);
    const result = await refreshOpenRouterCatalog({
      fetch: async () => new Response(JSON.stringify({ data: [rawModel("mock/alpha")] })),
      observedAt,
      refreshId: "refresh-file",
      store,
    });
    if (result.status !== "success") throw new Error("unexpected refresh failure");
    const snapshotPath = `${root}/snapshots/${result.snapshot.contentDigest.slice(7)}.json`;
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toEqual(result.snapshot);
    expect(JSON.parse(await readFile(`${root}/observations/refresh-file.json`, "utf8"))).toEqual(
      result.observation,
    );
    await expect(
      store.putObservation({ ...result.observation, observedAt: "2026-08-11T15:00:00.000Z" }),
    ).rejects.toThrow(/already exists/i);
  });
});

function createRankingSnapshot(): CatalogSnapshot {
  const models = [
    catalogModel("mock/baseline", "9", "9", 10_000),
    catalogModel("mock/alpha", "0.1", "10", 32_768),
    catalogModel("mock/bravo", "1", "2", 65_536),
    catalogModel("mock/charlie", "1", "2", 65_536),
    catalogModel("mock/delta", "1", "2", 32_768),
    catalogModel("mock/echo", "1.2", "1", 131_072),
    catalogModel("mock/foxtrot", "0.2", "10.2", 131_072),
    catalogModel("mock/golf", "2", "0.1", 131_072),
    catalogModel("mock/retired", "0", "0", 1_000_000, { retired: true }),
    catalogModel("other/blocked", "0", "0", 1_000_000, { provider: "other" }),
  ];
  const contentDigest = createCatalogContentDigest(models);
  return parseCatalogSnapshot({
    artifactType: "catalog-snapshot",
    contentDigest,
    id: `catalog-snapshot:openrouter--sha256-${contentDigest.slice(7)}`,
    models,
    observedAt,
    schemaVersion: "1.0.0",
    source: "openrouter",
  });
}
