import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
              attempts: [{ providerName: "Azure", statusCode: 200 }],
              selectedProvider: { providerName: "Azure" },
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
});
