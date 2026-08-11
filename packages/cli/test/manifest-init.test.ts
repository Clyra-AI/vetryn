import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeManifestFile } from "../src/index.js";

const temporaryRoots: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;

const callSite = {
  currentModel: "openai/gpt-4.1-mini",
  evalSuiteId: "eval-suite:support-classification",
  gates: {
    maxQualityRegression: 0.01,
    minCases: 30,
    minPassRate: 0.98,
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
    sourceFingerprint: digest("a"),
    symbol: "classifySupportTicket",
  },
};

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "vetryn-manifest-init-"));
  temporaryRoots.push(root);
  const callSitePath = path.join(root, "call-site.json");
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(callSitePath, `${JSON.stringify(callSite)}\n`);
  return { callSitePath, manifestPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("initializeManifestFile", () => {
  it("writes a reviewed manifest once and leaves an unchanged re-initialization untouched", async () => {
    const { callSitePath, manifestPath } = await createFixture();

    await expect(
      initializeManifestFile({
        callSitePath,
        manifestId: "call-site-manifest:sample-app",
        manifestPath,
      }),
    ).resolves.toMatchObject({
      callSiteId: "support-classification",
      changed: true,
      wouldChange: true,
    });
    const initialContents = await readFile(manifestPath, "utf8");

    await expect(initializeManifestFile({ callSitePath, manifestPath })).resolves.toMatchObject({
      callSiteId: "support-classification",
      changed: false,
      wouldChange: false,
    });
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(initialContents);
  });

  it("rejects invalid or colliding IDs without partially writing the manifest", async () => {
    const { callSitePath, manifestPath } = await createFixture();
    await initializeManifestFile({
      callSitePath,
      manifestId: "call-site-manifest:sample-app",
      manifestPath,
    });
    const initialContents = await readFile(manifestPath, "utf8");

    await writeFile(callSitePath, `${JSON.stringify({ ...callSite, owner: "another-team" })}\n`);
    await expect(initializeManifestFile({ callSitePath, manifestPath })).rejects.toThrow(
      /ID collision/i,
    );
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(initialContents);

    const invalidPath = path.join(path.dirname(manifestPath), "invalid-call-site.json");
    const untouchedPath = path.join(path.dirname(manifestPath), "untouched-manifest.json");
    await writeFile(
      invalidPath,
      `${JSON.stringify({ ...callSite, id: "Support Classification" })}\n`,
    );
    await expect(
      initializeManifestFile({
        callSitePath: invalidPath,
        manifestId: "call-site-manifest:sample-app",
        manifestPath: untouchedPath,
      }),
    ).rejects.toThrow(/lowercase kebab-case/i);
    await expect(readFile(untouchedPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports the requested call site and makes dry-run writes explicit", async () => {
    const { callSitePath, manifestPath } = await createFixture();
    await initializeManifestFile({
      callSitePath,
      manifestId: "call-site-manifest:sample-app",
      manifestPath,
    });

    await writeFile(
      callSitePath,
      `${JSON.stringify({
        ...callSite,
        evalSuiteId: "eval-suite:account-classification",
        id: "account-classification",
        name: "Account classification",
      })}\n`,
    );
    await expect(initializeManifestFile({ callSitePath, manifestPath })).resolves.toMatchObject({
      callSiteId: "account-classification",
      changed: true,
      wouldChange: true,
    });

    const dryRunPath = path.join(path.dirname(manifestPath), "dry-run-manifest.json");
    await expect(
      initializeManifestFile({
        callSitePath,
        dryRun: true,
        manifestId: "call-site-manifest:dry-run",
        manifestPath: dryRunPath,
      }),
    ).resolves.toMatchObject({
      callSiteId: "account-classification",
      changed: false,
      wouldChange: true,
    });
    await expect(readFile(dryRunPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
