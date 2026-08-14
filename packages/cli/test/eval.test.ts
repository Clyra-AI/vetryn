import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCurrentCatalogRefresh,
  refreshOpenRouterCatalog,
  type CatalogStore,
} from "@vetryn/openrouter";

import { evaluateFiles } from "../src/evaluation-files.js";
import { createProgram } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("vetryn eval", () => {
  it("emits redacted reproducible artifacts and an authenticated receipt using offline transport", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-eval-cli-"));
    roots.push(root);
    const repositoryRoot = path.join(root, "repo");
    const anchorPath = path.join(root, "trust", "anchor.json");
    const keyPath = path.join(root, "keys", "receipt.key");
    const providerKeyPath = path.join(root, "keys", "provider.key");
    await mkdir(path.dirname(keyPath), { recursive: true });
    await writeFile(keyPath, "offline-test-receipt-key-material");
    await writeFile(providerKeyPath, "offline-provider-key");
    const exampleRoot = path.resolve("examples/openrouter-typescript");
    const cases = (
      await readFile(path.join(exampleRoot, "fixtures/support-classification.evals.jsonl"), "utf8")
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; expectedClass: string });
    const expected = new Map(cases.map((entry) => [entry.id, entry.expectedClass]));
    const times = ["2026-08-10T00:00:01.000Z", "2026-08-10T00:00:02.000Z"];
    const outputPath = path.join(repositoryRoot, ".vetryn", "runs", "result.json");
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-10T00:00:00.000Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  architecture: { output_modalities: ["text"] },
                  context_length: 1_047_576,
                  id: "openai/gpt-4.1-mini",
                  pricing: { completion: "0.0000016", prompt: "0.0000004" },
                  supported_parameters: ["response_format"],
                },
                {
                  architecture: { output_modalities: ["text"] },
                  context_length: 128_000,
                  id: "openai/gpt-4o-mini",
                  pricing: { completion: "0.0000006", prompt: "0.00000015" },
                  supported_parameters: ["response_format"],
                },
              ],
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
        ),
      ),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const program = createProgram({
      clock: { now: () => times.shift() ?? "2026-08-10T00:00:02.000Z" },
      evaluationTransportFactory: () => ({
        async execute(request) {
          return {
            latencyMs: request.model === "openai/gpt-4.1-mini" ? 600 : 300,
            output: { classification: expected.get(request.caseId) },
            route: {
              attempts: [{ model: request.model, providerName: "Azure", statusCode: 200 }],
              selectedProvider: { model: request.model, providerName: "Azure" },
            },
            usage: { completionTokens: 1, promptTokens: 9 },
          };
        },
      }),
    });

    await program.parseAsync([
      "node",
      "vetryn",
      "eval",
      "--manifest",
      path.join(exampleRoot, "fixtures/manifest.json"),
      "--call-site",
      "support-classification",
      "--suite",
      path.join(exampleRoot, "fixtures/eval-suite.json"),
      "--fixture",
      path.join(exampleRoot, "fixtures/support-classification.evals.jsonl"),
      "--catalog-store",
      path.join(repositoryRoot, ".vetryn", "catalog"),
      "--refresh-id",
      "golden-refresh",
      "--candidate",
      "openai/gpt-4o-mini",
      "--run-id",
      "support-classification-golden",
      "--trust-epoch",
      "golden-epoch",
      "--evidence-store",
      path.join(repositoryRoot, ".vetryn", "evidence"),
      "--anchor",
      anchorPath,
      "--receipt-key-file",
      keyPath,
      "--provider-key-file",
      providerKeyPath,
      "--output",
      outputPath,
      "--root",
      repositoryRoot,
      "--evaluator-build",
      "git:golden",
    ]);

    const artifactText = await readFile(outputPath, "utf8");
    const artifact = JSON.parse(artifactText) as {
      candidateRun: {
        executionRecordId: string;
        gateOutcomes: Record<string, string>;
        status: string;
      };
      executionRecord: { startedAt: string };
      receipt: { headDigest: string };
    };
    expect(artifact.candidateRun).toMatchObject({
      executionRecordId: "execution-record:support-classification-golden",
      gateOutcomes: {
        context: "pass",
        cost: "pass",
        latency: "pass",
        privacy: "pass",
        quality: "pass",
      },
      status: "complete",
    });
    expect(artifact.executionRecord.startedAt).toBe("2026-08-10T00:00:01.000Z");
    expect(artifact.receipt.headDigest).toMatch(/^sha256:/);
    expect(artifactText).not.toContain("Synthetic request");
    expect(artifactText).not.toContain("offline-provider-key");
    expect(stdout).toHaveBeenCalled();
  });

  it("does not commit a receipt when the output destination cannot be published", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-eval-output-failure-"));
    roots.push(root);
    const repositoryRoot = path.join(root, "repo");
    const outputPath = path.join(repositoryRoot, "blocked-output");
    await mkdir(outputPath, { recursive: true });
    const exampleRoot = path.resolve("examples/openrouter-typescript");
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-10T00:00:00.000Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  architecture: { output_modalities: ["text"] },
                  context_length: 1_047_576,
                  id: "openai/gpt-4.1-mini",
                  pricing: { completion: "0.0000016", prompt: "0.0000004" },
                  supported_parameters: ["response_format"],
                },
                {
                  architecture: { output_modalities: ["text"] },
                  context_length: 128_000,
                  id: "openai/gpt-4o-mini",
                  pricing: { completion: "0.0000006", prompt: "0.00000015" },
                  supported_parameters: ["response_format"],
                },
              ],
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
        ),
      ),
    );
    const catalogStore: CatalogStore = {
      async hasSnapshot() {
        return false;
      },
      async putObservation() {},
      async putRefresh(snapshot, observation) {
        return { observation: { ...observation, reusedSnapshot: false }, snapshot };
      },
      async putSnapshot(snapshot) {
        return { reused: false, snapshot };
      },
    };
    const refresh = await refreshOpenRouterCatalog({
      acquisition: "live-api",
      refreshId: "output-failure-refresh",
      store: catalogStore,
    });
    if (refresh.status !== "success") throw new Error("Expected offline catalog refresh success.");
    const currentCatalogRefresh = createCurrentCatalogRefresh({
      invocationId: "output-failure-invocation",
      refresh,
    });
    const expected = new Map(
      (
        await readFile(
          path.join(exampleRoot, "fixtures/support-classification.evals.jsonl"),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { id: string; expectedClass: string })
        .map((entry) => [entry.id, entry.expectedClass] as const),
    );

    await expect(
      evaluateFiles({
        anchorPath: path.join(root, "trust", "anchor.json"),
        callSiteId: "support-classification",
        candidateModel: "openai/gpt-4o-mini",
        clock: { now: () => "2026-08-10T00:00:01.000Z" },
        currentCatalogRefresh,
        evaluatorBuild: "git:output-failure",
        evalSuitePath: path.join(exampleRoot, "fixtures/eval-suite.json"),
        evidencePath: path.join(repositoryRoot, ".vetryn", "evidence"),
        executionRecordId: "execution-record:output-failure",
        fixturePath: path.join(exampleRoot, "fixtures/support-classification.evals.jsonl"),
        key: Buffer.from("offline-test-receipt-key-material"),
        manifestPath: path.join(exampleRoot, "fixtures/manifest.json"),
        outputPath,
        repositoryRoot,
        transport: {
          async execute(request) {
            return {
              latencyMs: 100,
              output: { classification: expected.get(request.caseId) },
              route: {
                attempts: [{ model: request.model, providerName: "Azure", statusCode: 200 }],
                selectedProvider: { model: request.model, providerName: "Azure" },
              },
              usage: { completionTokens: 1, promptTokens: 9 },
            };
          },
        },
        trustEpochId: "output-failure-epoch",
      }),
    ).rejects.toThrow();
    await expect(
      readFile(path.join(repositoryRoot, ".vetryn", "evidence", "head.json"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("authenticates a terminal live catalog failure before refusing evaluation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vetryn-eval-failure-"));
    roots.push(root);
    const repositoryRoot = path.join(root, "repo");
    const anchorPath = path.join(root, "trust", "anchor.json");
    const keyPath = path.join(root, "keys", "receipt.key");
    const providerKeyPath = path.join(root, "keys", "provider.key");
    const evidencePath = path.join(repositoryRoot, ".vetryn", "evidence");
    await mkdir(path.dirname(keyPath), { recursive: true });
    await writeFile(keyPath, "offline-test-receipt-key-material");
    await writeFile(providerKeyPath, "offline-provider-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    await expect(
      createProgram().parseAsync([
        "node",
        "vetryn",
        "eval",
        "--manifest",
        "unused-manifest.json",
        "--call-site",
        "support-classification",
        "--suite",
        "unused-suite.json",
        "--fixture",
        "unused-fixture.jsonl",
        "--catalog-store",
        path.join(repositoryRoot, ".vetryn", "catalog"),
        "--refresh-id",
        "failed-refresh",
        "--candidate",
        "openai/gpt-4o-mini",
        "--run-id",
        "failed-evaluation",
        "--trust-epoch",
        "golden-epoch",
        "--evidence-store",
        evidencePath,
        "--anchor",
        anchorPath,
        "--receipt-key-file",
        keyPath,
        "--provider-key-file",
        providerKeyPath,
        "--output",
        path.join(repositoryRoot, "unused-output.json"),
        "--root",
        repositoryRoot,
      ]),
    ).rejects.toThrow(/terminal catalog refresh failed/i);

    const head = JSON.parse(await readFile(path.join(evidencePath, "head.json"), "utf8")) as {
      headDigest: string;
    };
    const entry = JSON.parse(
      await readFile(
        path.join(evidencePath, "receipts", `${head.headDigest.slice("sha256:".length)}.json`),
        "utf8",
      ),
    ) as { artifactType: string; observation: { status: string } };
    expect(entry).toMatchObject({
      artifactType: "authenticated-catalog-refresh-attempt",
      observation: { status: "failure" },
    });
  });
});
