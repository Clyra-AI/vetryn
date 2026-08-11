import { mkdir, readFile, readdir, symlink, truncate, writeFile } from "node:fs/promises";

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
  type RefreshCatalogOptions,
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

  async putRefresh(
    snapshot: CatalogSnapshot,
    observationInput: Omit<RefreshObservation, "reusedSnapshot">,
  ): Promise<{ readonly observation: RefreshObservation; readonly snapshot: CatalogSnapshot }> {
    const existing = this.snapshots.get(snapshot.contentDigest);
    const observation = {
      ...observationInput,
      reusedSnapshot: existing !== undefined,
    } as RefreshObservation;
    await this.putObservation(observation);
    if (existing !== undefined) return { observation, snapshot: existing };
    this.snapshots.set(snapshot.contentDigest, snapshot);
    return { observation, snapshot };
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  it("requires explicit tools support before advertising tool-call capability", () => {
    const result = normalizeOpenRouterCatalog(
      {
        data: [
          rawModel("mock/tool-choice-only", {
            parameters: ["response_format", "tool_choice"],
          }),
        ],
      },
      observedAt,
    );
    expect(result.snapshot.models[0]?.capabilities.toolCalls).toBe(false);

    const shortlist = resolveCandidates({
      callSite: {
        ...callSite,
        requiredCapabilities: { ...callSite.requiredCapabilities, toolCalls: true },
      },
      snapshot: result.snapshot,
    });
    expect(shortlist.candidates).toEqual([]);
    expect(shortlist.exclusions).toContainEqual({
      modelId: "mock/tool-choice-only",
      reason: "capability-incompatible",
    });
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
          {
            ...rawModel("mock/oversized-price"),
            pricing: { completion: `0.${"1".repeat(101)}`, prompt: "0" },
          },
          {
            ...rawModel("mock/oversized-capabilities"),
            supported_parameters: Array.from({ length: 201 }, () => "tools"),
          },
          rawModel("bad_provider/model"),
          rawModel("mock/overflow-price", { completion: "9".repeat(100) }),
          rawModel("mock/conflict", { prompt: "0.0000001" }),
          rawModel("mock/conflict", { prompt: "0.0000002" }),
          rawModel("mock/mixed-duplicate-valid-first"),
          { ...rawModel("mock/mixed-duplicate-valid-first"), pricing: { prompt: "0.1" } },
          { ...rawModel("mock/mixed-duplicate-invalid-first"), architecture: {} },
          rawModel("mock/mixed-duplicate-invalid-first"),
          rawModel("mock/identical"),
          rawModel("mock/identical"),
          rawModel("INVALID MODEL"),
        ],
      },
      observedAt,
    );

    expect(result.snapshot.models.map(({ id }) => id)).toEqual(["mock/identical", "mock/valid"]);
    expect(result.exclusions).toEqual(
      expect.arrayContaining([
        { modelId: "mock/no-price", reason: "invalid-pricing" },
        { modelId: "mock/negative-price", reason: "invalid-pricing" },
        { modelId: "mock/no-capabilities", reason: "invalid-capabilities" },
        { modelId: "mock/no-modalities", reason: "invalid-capabilities" },
        { modelId: "mock/no-context", reason: "invalid-context-window" },
        { modelId: "mock/oversized-price", reason: "invalid-pricing" },
        { modelId: "mock/oversized-capabilities", reason: "invalid-capabilities" },
        { modelId: "bad_provider/model", reason: "invalid-model-id" },
        { modelId: "mock/overflow-price", reason: "invalid-pricing" },
        { modelId: "mock/conflict", reason: "ambiguous-model-id" },
        { modelId: "mock/mixed-duplicate-valid-first", reason: "ambiguous-model-id" },
        { modelId: "mock/mixed-duplicate-invalid-first", reason: "ambiguous-model-id" },
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
      expect.objectContaining({ modelId: "mock/alpha", projectedCostUsd: "0.0000109" }),
      expect.objectContaining({ modelId: "mock/bravo", projectedCostUsd: "0.000011" }),
      expect.objectContaining({ modelId: "mock/charlie", projectedCostUsd: "0.000011" }),
      expect.objectContaining({ modelId: "mock/delta", projectedCostUsd: "0.000011" }),
      expect.objectContaining({ modelId: "mock/echo", projectedCostUsd: "0.0000118" }),
    ]);
    expect(shortlist.catalogSnapshotId).toBe(snapshot.id);
    expect(shortlist.catalogContentDigest).toBe(snapshot.contentDigest);
    expect(shortlist.exclusions).toEqual(
      expect.arrayContaining([
        { modelId: "mock/baseline", reason: "baseline-model" },
        { modelId: "mock/too-small", reason: "context-window-insufficient" },
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

  it("rejects noncanonical snapshot identity during offline replay", () => {
    const snapshot = createRankingSnapshot();
    for (const forged of [
      { ...snapshot, source: "evil" },
      { ...snapshot, id: "catalog-snapshot:forged" },
    ]) {
      expect(() => resolveCandidates({ callSite, snapshot: forged })).toThrow(/canonical/i);
    }
  });
});

describe("refresh evidence", () => {
  it("records failure evidence when response headers exceed the acquisition deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(observedAt));
    const store = new MemoryStore();
    const fetch = vi.fn(
      async (
        _input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1],
      ): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const pending = refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch,
      observedAt,
      refreshId: "headers-timeout",
      store,
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toMatchObject({
      observation: { errorCode: "fetch-failed", status: "failure" },
      snapshot: null,
      status: "failure",
    });
    expect(store.observations).toHaveLength(1);
  });

  it("records failure evidence when response body consumption exceeds the deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(observedAt));
    const store = new MemoryStore();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });

    const pending = refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch: async () => new Response(body),
      observedAt,
      refreshId: "body-timeout",
      store,
    });
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toMatchObject({
      observation: { errorCode: "fetch-failed", status: "failure" },
      snapshot: null,
      status: "failure",
    });
    expect(store.observations).toHaveLength(1);
  });

  it("rejects future-dated captured observations before fetching or persistence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(observedAt));
    const store = new MemoryStore();
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [rawModel("mock/alpha")] })),
    );

    await expect(
      refreshOpenRouterCatalog({
        acquisition: "captured-response",
        fetch,
        observedAt: "2099-01-01T00:00:00.000Z",
        refreshId: "future-capture",
        store,
      }),
    ).rejects.toThrow(/trusted clock/i);
    expect(fetch).not.toHaveBeenCalled();
    expect(store.observations).toEqual([]);
    expect(store.snapshots.size).toBe(0);
  });

  it("reuses unchanged content while recording every successful observation", async () => {
    const store = new MemoryStore();
    const fetch = vi.fn(
      async (_input: string | URL | Request) =>
        new Response(JSON.stringify({ data: [rawModel("mock/alpha")] })),
    );

    const first = await refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch,
      observedAt,
      refreshId: "refresh-1",
      store,
    });
    const second = await refreshOpenRouterCatalog({
      acquisition: "captured-response",
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
    expect(first.observation).toMatchObject({
      acquisition: "captured-response",
      source: "openrouter",
      sourceRef: "repository-captured-response",
    });
    expect(fetch.mock.calls.every(([url]) => url === "https://openrouter.ai/api/v1/models")).toBe(
      true,
    );
    expect(store.snapshots.size).toBe(1);
    expect(store.observations.map(({ id }) => id)).toEqual(["refresh-1", "refresh-2"]);
  });

  it("records failure without presenting an older snapshot as current", async () => {
    const store = new MemoryStore();
    await refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch: async () => new Response(JSON.stringify({ data: [rawModel("mock/old")] })),
      observedAt,
      refreshId: "refresh-old",
      store,
    });
    const failure = await refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch: async () => new Response("unavailable", { status: 503 }),
      observedAt: "2026-08-11T14:00:00.000Z",
      refreshId: "refresh-failed",
      store,
    });

    expect(failure).toMatchObject({
      observation: {
        acquisition: "captured-response",
        contentDigest: null,
        errorCode: "http-error",
        reusedSnapshot: false,
        snapshotId: null,
        sourceRef: "repository-captured-response",
        status: "failure",
      },
      snapshot: null,
      status: "failure",
    });
    expect(store.snapshots.size).toBe(1);
  });

  it("stops streaming an oversized catalog before buffering the full response", async () => {
    const store = new MemoryStore();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array(20_000_001));
      },
    });

    const result = await refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch: async () => new Response(body),
      observedAt,
      refreshId: "refresh-oversized-stream",
      store,
    });

    expect(result).toMatchObject({
      observation: { errorCode: "invalid-catalog", status: "failure" },
      snapshot: null,
      status: "failure",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(store.snapshots.size).toBe(0);
  });

  it("refuses to label injected transport data as a live OpenRouter acquisition", async () => {
    const forged = {
      acquisition: "live-api",
      fetch: async () => new Response(JSON.stringify({ data: [rawModel("attacker/model")] })),
      observedAt,
      refreshId: "forged-live",
      store: new MemoryStore(),
    } as unknown as RefreshCatalogOptions;

    await expect(refreshOpenRouterCatalog(forged)).rejects.toThrow(/injected transport/i);

    await expect(
      refreshOpenRouterCatalog({
        acquisition: "captured-response",
        observedAt,
        refreshId: "missing-capture",
        store: new MemoryStore(),
      } as unknown as RefreshCatalogOptions),
    ).rejects.toThrow(/capture transport/i);
  });

  it("derives live freshness from the acquisition clock instead of caller input", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T16:00:00.000Z"));
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [rawModel("mock/live")] })),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await refreshOpenRouterCatalog({
      acquisition: "live-api",
      refreshId: "trusted-live-time",
      store: new MemoryStore(),
    });

    expect(result).toMatchObject({
      observation: { observedAt: "2026-08-11T16:00:00.000Z", status: "success" },
      snapshot: { observedAt: "2026-08-11T16:00:00.000Z" },
      status: "success",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("persists immutable content-addressed snapshots and observations", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(`${tmpdir()}/vetryn-openrouter-`);
    temporaryDirectories.push(root);
    const store = new FileCatalogStore(root);
    const result = await refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch: async () => new Response(JSON.stringify({ data: [rawModel("mock/alpha")] })),
      observedAt,
      refreshId: "refresh-file",
      store,
    });
    if (result.status !== "success") throw new Error("unexpected refresh failure");
    const snapshotPath = `${root}/snapshots/${result.snapshot.contentDigest.slice(7)}.json`;
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toEqual(result.snapshot);
    expect(await readdir(`${root}/snapshots`)).toEqual([
      `${result.snapshot.contentDigest.slice(7)}.json`,
    ]);
    expect(JSON.parse(await readFile(`${root}/observations/refresh-file.json`, "utf8"))).toEqual(
      result.observation,
    );
    await expect(
      store.putObservation({ ...result.observation, observedAt: "2026-08-11T15:00:00.000Z" }),
    ).rejects.toThrow(/already exists/i);
  });

  it("does not publish a snapshot when its refresh observation cannot be committed", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(`${tmpdir()}/vetryn-openrouter-atomic-`);
    temporaryDirectories.push(root);
    const store = new FileCatalogStore(root);
    const refreshId = "same-refresh-id";

    const failed = await refreshOpenRouterCatalog({
      acquisition: "captured-response",
      fetch: async () => new Response(JSON.stringify({ data: [] })),
      observedAt,
      refreshId,
      store,
    });
    expect(failed.status).toBe("failure");

    const validInput = { data: [rawModel("mock/alpha")] };
    const contentDigest = normalizeOpenRouterCatalog(validInput, observedAt).snapshot.contentDigest;
    await expect(
      refreshOpenRouterCatalog({
        acquisition: "captured-response",
        fetch: async () => new Response(JSON.stringify(validInput)),
        observedAt,
        refreshId,
        store,
      }),
    ).rejects.toThrow(/already exists/i);
    await expect(store.hasSnapshot(contentDigest)).resolves.toBe(false);
  });

  it("rolls back a new observation when snapshot publication fails", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(`${tmpdir()}/vetryn-openrouter-rollback-`);
    temporaryDirectories.push(root);
    class FailingSnapshotStore extends FileCatalogStore {
      override async putSnapshot(): Promise<{
        readonly reused: boolean;
        readonly snapshot: CatalogSnapshot;
      }> {
        throw new Error("injected snapshot write failure");
      }
    }
    const store = new FailingSnapshotStore(root);
    const validInput = { data: [rawModel("mock/alpha")] };
    const contentDigest = normalizeOpenRouterCatalog(validInput, observedAt).snapshot.contentDigest;

    await expect(
      refreshOpenRouterCatalog({
        acquisition: "captured-response",
        fetch: async () => new Response(JSON.stringify(validInput)),
        observedAt,
        refreshId: "snapshot-write-fails",
        store,
      }),
    ).rejects.toThrow(/injected snapshot write failure/i);
    await expect(
      readFile(`${root}/observations/snapshot-write-fails.json`, "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.hasSnapshot(contentDigest)).resolves.toBe(false);
  });

  it("refuses a symlinked snapshot directory before publishing outside the store", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(`${tmpdir()}/vetryn-openrouter-symlink-store-`);
    const outside = await mkdtemp(`${tmpdir()}/vetryn-openrouter-symlink-outside-`);
    temporaryDirectories.push(root, outside);
    await symlink(outside, `${root}/snapshots`, "dir");

    await expect(
      refreshOpenRouterCatalog({
        acquisition: "captured-response",
        fetch: async () => new Response(JSON.stringify({ data: [rawModel("mock/alpha")] })),
        observedAt,
        refreshId: "symlinked-snapshot-directory",
        store: new FileCatalogStore(root),
      }),
    ).rejects.toThrow(/symbolic-link/i);
    expect(await readdir(outside)).toEqual([]);
  });

  it("refuses a symlinked observation directory before recording outside the store", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(`${tmpdir()}/vetryn-openrouter-symlink-store-`);
    const outside = await mkdtemp(`${tmpdir()}/vetryn-openrouter-symlink-outside-`);
    temporaryDirectories.push(root, outside);
    await symlink(outside, `${root}/observations`, "dir");

    await expect(
      refreshOpenRouterCatalog({
        acquisition: "captured-response",
        fetch: async () => new Response(JSON.stringify({ data: [] })),
        observedAt,
        refreshId: "symlinked-observation-directory",
        store: new FileCatalogStore(root),
      }),
    ).rejects.toThrow(/symbolic-link/i);
    expect(await readdir(outside)).toEqual([]);
  });

  it("rejects same-digest snapshots with forged identity or future provenance", async () => {
    const canonical = normalizeOpenRouterCatalog(
      { data: [rawModel("mock/alpha")] },
      observedAt,
    ).snapshot;
    const variants = [
      { ...canonical, source: "evil" },
      { ...canonical, id: "catalog-snapshot:forged" },
      { ...canonical, observedAt: "2099-01-01T00:00:00.000Z" },
    ];

    for (const [index, forged] of variants.entries()) {
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const root = await mkdtemp(`${tmpdir()}/vetryn-openrouter-forged-${index}-`);
      temporaryDirectories.push(root);
      const snapshotDirectory = `${root}/snapshots`;
      await mkdir(snapshotDirectory, { recursive: true });
      await writeFile(
        `${snapshotDirectory}/${canonical.contentDigest.slice(7)}.json`,
        `${JSON.stringify(forged)}\n`,
      );

      await expect(new FileCatalogStore(root).putSnapshot(canonical)).rejects.toThrow(
        /invalid provenance/i,
      );
    }
  });

  it("bounds preseeded snapshot files before parsing or reuse", async () => {
    const canonical = normalizeOpenRouterCatalog(
      { data: [rawModel("mock/alpha")] },
      observedAt,
    ).snapshot;
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const root = await mkdtemp(`${tmpdir()}/vetryn-openrouter-oversized-`);
    temporaryDirectories.push(root);
    const snapshotDirectory = `${root}/snapshots`;
    const snapshotPath = `${snapshotDirectory}/${canonical.contentDigest.slice(7)}.json`;
    await mkdir(snapshotDirectory, { recursive: true });
    await writeFile(snapshotPath, "{");
    await truncate(snapshotPath, 20_000_001);

    await expect(new FileCatalogStore(root).putSnapshot(canonical)).rejects.toThrow(/byte limit/i);
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
    catalogModel("mock/too-small", "0", "0", 9),
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
