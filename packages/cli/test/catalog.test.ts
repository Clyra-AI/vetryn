import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCatalogShortlistFile, refreshCatalogFile } from "../src/index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("catalog CLI operations", () => {
  it("imports local provider metadata, persists evidence, and replays an offline shortlist", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-catalog-cli-"));
    temporaryRoots.push(root);
    const catalogPath = path.join(root, "catalog.json");
    const manifestPath = path.join(root, "manifest.json");
    await writeFile(
      catalogPath,
      JSON.stringify({
        data: [
          rawModel("openai/baseline", "0.000001", "0.000002", 128_000),
          rawModel("openai/candidate", "0.0000001", "0.0000002", 64_000),
        ],
      }),
    );
    await writeFile(manifestPath, JSON.stringify(manifest));

    const refresh = await refreshCatalogFile({
      catalogFile: catalogPath,
      observedAt: "2026-08-11T12:00:00.000Z",
      refreshId: "cli-refresh",
      storePath: path.join(root, "store"),
    });
    expect(refresh.status).toBe("success");
    if (refresh.status !== "success") throw new Error("unexpected refresh failure");
    const snapshotPath = path.join(
      root,
      "store",
      "snapshots",
      `${refresh.snapshot.contentDigest.slice(7)}.json`,
    );
    const shortlist = await createCatalogShortlistFile({
      callSiteId: "support-classification",
      manifestPath,
      snapshotPath,
    });

    expect(shortlist).toMatchObject({
      baselineModel: "openai/baseline",
      candidates: [{ modelId: "openai/candidate", projectedCostUsd: "0.0000011" }],
      catalogSnapshotId: refresh.snapshot.id,
      limit: 5,
    });
    expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toEqual(refresh.snapshot);
  });

  it("streams captured files through the catalog byte limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-catalog-cli-"));
    temporaryRoots.push(root);
    const catalogPath = path.join(root, "oversized-catalog.json");
    await writeFile(catalogPath, "{");
    await truncate(catalogPath, 20_000_001);

    const refresh = await refreshCatalogFile({
      catalogFile: catalogPath,
      observedAt: "2026-08-11T12:00:00.000Z",
      refreshId: "cli-oversized-capture",
      storePath: path.join(root, "store"),
    });

    expect(refresh).toMatchObject({
      observation: { errorCode: "invalid-catalog", status: "failure" },
      snapshot: null,
      status: "failure",
    });
  });

  it("reserves caller-supplied observation times for captured responses", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-catalog-cli-"));
    temporaryRoots.push(root);

    await expect(
      refreshCatalogFile({
        observedAt: "2099-01-01T00:00:00.000Z",
        refreshId: "forged-live-time",
        storePath: path.join(root, "store"),
      }),
    ).rejects.toThrow(/reserved for captured/i);
  });

  it("requires the acquisition timestamp for captured responses", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-catalog-cli-"));
    temporaryRoots.push(root);
    const catalogPath = path.join(root, "catalog.json");
    await writeFile(catalogPath, JSON.stringify({ data: [] }));

    await expect(
      refreshCatalogFile({
        catalogFile: catalogPath,
        refreshId: "capture-without-time",
        storePath: path.join(root, "store"),
      }),
    ).rejects.toThrow(/observed-at is required/i);
  });

  it("bounds repository snapshot input before JSON parsing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-catalog-cli-"));
    temporaryRoots.push(root);
    const manifestPath = path.join(root, "manifest.json");
    const snapshotPath = path.join(root, "oversized-snapshot.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(snapshotPath, "{");
    await truncate(snapshotPath, 20_000_001);

    await expect(
      createCatalogShortlistFile({
        callSiteId: "support-classification",
        manifestPath,
        snapshotPath,
      }),
    ).rejects.toThrow(/exceeds the .*byte limit/i);
  });
});

const rawModel = (id: string, prompt: string, completion: string, context: number) => ({
  architecture: { output_modalities: ["text"] },
  context_length: context,
  id,
  pricing: { completion, prompt },
  supported_parameters: ["response_format"],
});

const manifest = {
  artifactType: "call-site-manifest",
  callSites: [
    {
      currentModel: "openai/baseline",
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
      providerPolicy: { allowedProviders: ["openai"] },
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
        sourceFingerprint: `sha256:${"a".repeat(64)}`,
        symbol: "classifySupportTicket",
      },
    },
  ],
  id: "call-site-manifest:openrouter-cli-test",
  schemaVersion: "1.0.0",
};
