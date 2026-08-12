import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scanRepository } from "../src/index.js";

const temporaryRoots: string[] = [];

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-scan-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "src", "classify.ts"),
    `
      import OpenAI from "openai";
      export async function classify(client: OpenAI) {
        return client.chat.completions.create({ model: "openai/gpt-4.1-mini" });
      }
    `,
  );
  await mkdir(path.join(root, "node_modules", "ignored"), { recursive: true });
  await writeFile(
    path.join(root, "node_modules", "ignored", "untrusted.ts"),
    "throw new Error('must not scan dependency source');\n",
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("scanRepository", () => {
  it("reads only repository TypeScript files and returns deterministic, relative findings", async () => {
    const root = await createFixture();

    await expect(scanRepository({ repositoryRoot: root })).resolves.toMatchObject({
      assessment: {
        files: { considered: 1, parseErrors: 0, parsed: 1 },
        observations: {
          ambiguous: 0,
          highConfidence: 1,
          nonPatchable: 0,
          patchable: 1,
          reasonCounts: { "static-model-literal": 1 },
          total: 1,
        },
        scope: "supported-direct-openai-compatible-typescript-calls",
      },
      files: ["src/classify.ts"],
      findings: [
        {
          confidence: "high",
          file: "src/classify.ts",
          modelPin: "openai/gpt-4.1-mini",
          patchability: "patchable",
          sourceSymbol: "classify",
        },
      ],
    });
  });

  it("reconciles parsed files, parse errors, and disjoint finding dispositions", async () => {
    const root = await createFixture();
    await writeFile(path.join(root, "src", "empty.ts"), "export const untouched = true;\n");
    await writeFile(
      path.join(root, "src", "broken.ts"),
      'import OpenAI from "openai";\nconst client = new OpenAI({\n',
    );

    const result = await scanRepository({ repositoryRoot: root });

    expect(result.assessment.files).toEqual({ considered: 3, parseErrors: 1, parsed: 2 });
    expect(result.assessment.observations.total).toBe(
      result.findings.filter(({ reasonCode }) => reasonCode !== "parse-error").length,
    );
    expect(result.assessment.observations).not.toMatchObject({
      reasonCounts: { "parse-error": expect.any(Number) },
    });
    expect(
      result.assessment.observations.patchable + result.assessment.observations.nonPatchable,
    ).toBe(result.assessment.observations.total);
    expect(
      result.assessment.observations.highConfidence + result.assessment.observations.ambiguous,
    ).toBe(result.assessment.observations.total);
    expect(
      Object.values(result.assessment.observations.reasonCounts).reduce(
        (total, count) => total + (count ?? 0),
        0,
      ),
    ).toBe(result.assessment.observations.total);
  });

  it("rejects requests that escape the repository root", async () => {
    const root = await createFixture();

    await expect(
      scanRepository({ paths: ["../outside.ts"], repositoryRoot: root }),
    ).rejects.toThrow(/outside repository root/i);
  });
});
