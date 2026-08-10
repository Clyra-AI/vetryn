import { describe, expect, it } from "vitest";

import { parseCallSiteSpec, recommendationStatusSchema } from "../src/index.js";

const validSpec = {
  binding: {
    adapter: "openai.chat.completions.create",
    file: "src/support/classify.ts",
    symbol: "classifyTicket",
  },
  evalFixture: ".vetryn/evals/support-classification.jsonl",
  gates: {
    maxQualityRegression: 0.01,
    minCases: 30,
    minPassRate: 0.98,
    minSavingsPercent: 20,
  },
  id: "support-classification",
  name: "Support classification",
  owner: "support-platform",
};

describe("parseCallSiteSpec", () => {
  it("accepts a valid call-site specification", () => {
    expect(parseCallSiteSpec(validSpec)).toMatchObject(validSpec);
  });

  it("rejects unstable call-site identifiers", () => {
    expect(() => parseCallSiteSpec({ ...validSpec, id: "Support Classification" })).toThrow(
      /lowercase kebab-case/,
    );
  });
});

describe("recommendationStatusSchema", () => {
  it("includes abstention as a first-class outcome", () => {
    expect(recommendationStatusSchema.parse("insufficient-evidence")).toBe("insufficient-evidence");
  });
});
