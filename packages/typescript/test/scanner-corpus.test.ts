import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSourceFingerprint, scanTypeScript } from "../src/index.js";

interface CorpusCase {
  readonly expected: "ambiguous" | "supported";
  readonly file: string;
  readonly name: string;
  readonly source: string;
  readonly symbol: string;
}

const typedClientCall = (symbol: string, model: string) => `
  import OpenAI from "openai";
  export async function ${symbol}(client: OpenAI) {
    return client.chat.completions.create({ model: "${model}" });
  }
`;

const corpus: readonly CorpusCase[] = [
  {
    expected: "supported",
    file: "src/support.ts",
    name: "typed OpenAI parameter",
    source: typedClientCall("classifySupport", "openai/gpt-4.1-mini"),
    symbol: "classifySupport",
  },
  {
    expected: "supported",
    file: "src/triage.ts",
    name: "different canonical model pin",
    source: typedClientCall("triageTicket", "anthropic/claude-3.7-sonnet"),
    symbol: "triageTicket",
  },
  {
    expected: "supported",
    file: "src/new-client.ts",
    name: "locally constructed OpenAI client",
    source: `
      import OpenAI from "openai";
      const client = new OpenAI({ apiKey: "fixture-only" });
      export async function summarize() {
        return client.chat.completions.create({ model: "openai/gpt-4.1" });
      }
    `,
    symbol: "summarize",
  },
  {
    expected: "supported",
    file: "src/aliased-client.ts",
    name: "aliased default OpenAI import",
    source: `
      import OpenAIClient from "openai";
      export async function draft(client: OpenAIClient) {
        return client.chat.completions.create({ model: "openai/gpt-4.1-nano" });
      }
    `,
    symbol: "draft",
  },
  {
    expected: "supported",
    file: "src/named-import.ts",
    name: "aliased named OpenAI import",
    source: `
      import { OpenAI as OpenAIClient } from "openai";
      export async function extract(client: OpenAIClient) {
        return client.chat.completions.create({ model: "openai/gpt-4o-mini" });
      }
    `,
    symbol: "extract",
  },
  {
    expected: "supported",
    file: "src/arrow.ts",
    name: "typed arrow-function parameter",
    source: `
      import OpenAI from "openai";
      export const route = async (client: OpenAI) =>
        client.chat.completions.create({ model: "openai/gpt-4.1-mini" });
    `,
    symbol: "route",
  },
  {
    expected: "supported",
    file: "src/inline-construction.ts",
    name: "inline OpenAI construction",
    source: `
      import OpenAI from "openai";
      export async function compose() {
        return new OpenAI({ apiKey: "fixture-only" }).chat.completions.create({
          model: "openai/gpt-4.1-mini",
        });
      }
    `,
    symbol: "compose",
  },
  {
    expected: "supported",
    file: "src/options.ts",
    name: "direct call with unrelated options",
    source: `
      import OpenAI from "openai";
      export async function classify(client: OpenAI) {
        return client.chat.completions.create({
          messages: [],
          model: "openai/gpt-4.1-mini",
          response_format: { type: "json_object" },
        });
      }
    `,
    symbol: "classify",
  },
  {
    expected: "ambiguous",
    file: "src/dynamic.ts",
    name: "dynamic model wrapper",
    source: `
      import OpenAI from "openai";
      export async function run(client: OpenAI, model: string) {
        return client.chat.completions.create({ model });
      }
    `,
    symbol: "run",
  },
  {
    expected: "ambiguous",
    file: "src/lookalike.ts",
    name: "unverified lookalike receiver",
    source: `
      export async function run(client: unknown) {
        return (client as { chat: { completions: { create: Function } } }).chat.completions.create({
          model: "openai/gpt-4.1-mini",
        });
      }
    `,
    symbol: "run",
  },
  {
    expected: "ambiguous",
    file: "src/template.ts",
    name: "interpolated model template",
    source: `
      import OpenAI from "openai";
      export async function run(client: OpenAI, suffix: string) {
        return client.chat.completions.create({ model: \`openai/gpt-\${suffix}\` });
      }
    `,
    symbol: "run",
  },
  {
    expected: "ambiguous",
    file: "src/missing-model.ts",
    name: "missing model property",
    source: `
      import OpenAI from "openai";
      export async function run(client: OpenAI) {
        return client.chat.completions.create({ messages: [] });
      }
    `,
    symbol: "run",
  },
  {
    expected: "ambiguous",
    file: "src/duplicate-model.ts",
    name: "duplicate model properties",
    source: `
      import OpenAI from "openai";
      export async function run(client: OpenAI) {
        return client.chat.completions.create({
          model: "openai/gpt-4.1-mini",
          model: "openai/gpt-4.1",
        });
      }
    `,
    symbol: "run",
  },
  {
    expected: "ambiguous",
    file: "src/invalid-model.ts",
    name: "non-canonical model literal",
    source: `
      import OpenAI from "openai";
      export async function run(client: OpenAI) {
        return client.chat.completions.create({ model: "gpt-4.1-mini" });
      }
    `,
    symbol: "run",
  },
  {
    expected: "ambiguous",
    file: "src/syntax-error.ts",
    name: "unparseable source",
    source: "export const broken = (",
    symbol: "<module>",
  },
];

describe("reviewed TypeScript scanner corpus", () => {
  it("meets the high-confidence precision and supported-pattern recall thresholds", () => {
    const results = corpus.map((fixture) => ({
      fixture,
      findings: scanTypeScript({ file: fixture.file, source: fixture.source }),
    }));
    const expectedSupported = results.filter(({ fixture }) => fixture.expected === "supported");
    const highConfidence = results.flatMap(({ findings, fixture }) =>
      findings
        .filter((finding) => finding.confidence === "high")
        .map((finding) => ({ finding, fixture })),
    );
    const truePositives = highConfidence.filter(({ fixture }) => fixture.expected === "supported");
    const precision = truePositives.length / highConfidence.length;
    const recall = truePositives.length / expectedSupported.length;

    expect(precision).toBeGreaterThanOrEqual(0.95);
    expect(recall).toBeGreaterThanOrEqual(0.8);
    expect(highConfidence).toHaveLength(expectedSupported.length);
  });

  it("emits source and structural fingerprints without inventing human-owned call-site IDs", () => {
    for (const fixture of corpus) {
      const findings = scanTypeScript({ file: fixture.file, source: fixture.source });
      expect(findings).toHaveLength(1);

      const finding = findings[0];
      expect(finding).toMatchObject({
        file: fixture.file,
        sourceFingerprint: createSourceFingerprint(fixture.source),
        sourceSymbol: fixture.symbol,
        structuralFingerprint: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      });
      expect(finding).not.toHaveProperty("callSiteId");

      if (fixture.expected === "supported") {
        expect(finding).toMatchObject({
          adapter: "openai.chat.completions.create",
          confidence: "high",
          patchability: "patchable",
          reasonCode: "static-model-literal",
        });
      } else {
        expect(finding).toMatchObject({
          confidence: "ambiguous",
          patchability: "not-patchable",
        });
      }
    }
  });

  it("parses source without executing it", () => {
    const source = `
      import OpenAI from "openai";
      throw new Error("must not execute repository source");
      export async function run(client: OpenAI) {
        return client.chat.completions.create({ model: "openai/gpt-4.1-mini" });
      }
    `;

    expect(scanTypeScript({ file: "src/unexecuted.ts", source })).toMatchObject([
      {
        confidence: "high",
        modelPin: "openai/gpt-4.1-mini",
        patchability: "patchable",
      },
    ]);
  });

  it("binds verified clients lexically instead of trusting a reused identifier name", () => {
    const source = `
      import OpenAI from "openai";
      export async function supported(client: OpenAI) {
        return client.chat.completions.create({ model: "openai/gpt-4.1-mini" });
      }
      export async function lookalike(client: { chat: { completions: { create: Function } } }) {
        return client.chat.completions.create({ model: "openai/gpt-4.1-mini" });
      }
    `;

    expect(scanTypeScript({ file: "src/reused-client.ts", source })).toMatchObject([
      {
        confidence: "high",
        patchability: "patchable",
        sourceSymbol: "supported",
      },
      {
        confidence: "ambiguous",
        patchability: "not-patchable",
        reasonCode: "unverified-client",
        sourceSymbol: "lookalike",
      },
    ]);
  });

  it("discovers the checked-in golden call without assigning its human-owned manifest ID", async () => {
    const fixtureRoot = path.resolve(
      import.meta.dirname,
      "../../../examples/openrouter-typescript",
    );
    const [source, manifestText] = await Promise.all([
      readFile(path.join(fixtureRoot, "src/support-classification.ts"), "utf8"),
      readFile(path.join(fixtureRoot, "fixtures/manifest.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      readonly callSites: readonly {
        readonly id: string;
        readonly sourceBinding: { readonly sourceFingerprint: string };
      }[];
    };

    const findings = scanTypeScript({ file: "src/support-classification.ts", source });

    expect(findings).toMatchObject([
      {
        adapter: "openai.chat.completions.create",
        confidence: "high",
        modelPin: "openai/gpt-4.1-mini",
        patchability: "patchable",
        sourceFingerprint: manifest.callSites[0]?.sourceBinding.sourceFingerprint,
        sourceSymbol: "classifySupportTicket",
      },
    ]);
    expect(findings[0]).not.toHaveProperty("callSiteId");
    expect(manifest.callSites[0]?.id).toBe("support-classification");
  });
});
