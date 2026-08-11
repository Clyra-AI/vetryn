import { describe, expect, it } from "vitest";

import {
  VETRYN_ARTIFACT_SCHEMA_VERSION,
  canonicalizeArtifact,
  initializeCallSiteManifest,
} from "../src/index.js";

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

describe("initializeCallSiteManifest", () => {
  it("requires an explicit manifest ID and a human-reviewed call-site record", () => {
    expect(() => initializeCallSiteManifest({ callSite })).toThrow(
      /explicit human-owned manifest ID/i,
    );
    expect(() =>
      initializeCallSiteManifest({
        callSite: {
          ...callSite,
          representativeUsage: { ...callSite.representativeUsage, reviewed: false },
        },
        manifestId: "call-site-manifest:sample-app",
      }),
    ).toThrow(/reviewed/i);
  });

  it("creates a versioned manifest with stable ownership and reviewed usage provenance", () => {
    const manifest = initializeCallSiteManifest({
      callSite,
      manifestId: "call-site-manifest:sample-app",
    });

    expect(manifest).toMatchObject({
      artifactType: "call-site-manifest",
      callSites: [callSite],
      id: "call-site-manifest:sample-app",
      schemaVersion: VETRYN_ARTIFACT_SCHEMA_VERSION,
    });
  });

  it("is idempotent for an unchanged call site", () => {
    const initial = initializeCallSiteManifest({
      callSite,
      manifestId: "call-site-manifest:sample-app",
    });
    const replayed = initializeCallSiteManifest({ callSite, existingManifest: initial });

    expect(canonicalizeArtifact(replayed)).toBe(canonicalizeArtifact(initial));
  });

  it("rejects a same-ID change without replacing the existing human-owned record", () => {
    const initial = initializeCallSiteManifest({
      callSite,
      manifestId: "call-site-manifest:sample-app",
    });

    expect(() =>
      initializeCallSiteManifest({
        callSite: { ...callSite, owner: "another-team" },
        existingManifest: initial,
      }),
    ).toThrow(/ID collision/i);
    expect(canonicalizeArtifact(initial)).toContain('"owner":"support-platform"');
  });

  it("rejects an invalid or renamed manifest before creating an artifact", () => {
    const initial = initializeCallSiteManifest({
      callSite,
      manifestId: "call-site-manifest:sample-app",
    });

    expect(() =>
      initializeCallSiteManifest({
        callSite: { ...callSite, id: "Support Classification" },
        manifestId: "call-site-manifest:sample-app",
      }),
    ).toThrow(/lowercase kebab-case/i);
    expect(() =>
      initializeCallSiteManifest({
        callSite,
        existingManifest: initial,
        manifestId: "call-site-manifest:renamed-app",
      }),
    ).toThrow(/cannot silently rename/i);
  });
});
