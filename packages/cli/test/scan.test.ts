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

  it("rejects requests that escape the repository root", async () => {
    const root = await createFixture();

    await expect(
      scanRepository({ paths: ["../outside.ts"], repositoryRoot: root }),
    ).rejects.toThrow(/outside repository root/i);
  });
});
