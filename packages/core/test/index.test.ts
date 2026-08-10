import fc from "fast-check";
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

const letters = [..."abcdefghijklmnopqrstuvwxyz"];
const identifierCharacters = [..."abcdefghijklmnopqrstuvwxyz0123456789"];
const identifierSegment = fc
  .array(fc.constantFrom(...identifierCharacters), { maxLength: 12, minLength: 1 })
  .map((characters) => characters.join(""));
const firstIdentifierSegment = fc
  .tuple(
    fc.constantFrom(...letters),
    fc.array(fc.constantFrom(...identifierCharacters), { maxLength: 11 }),
  )
  .map(([first, rest]) => `${first}${rest.join("")}`);
const validIdentifier = fc
  .tuple(firstIdentifierSegment, fc.array(identifierSegment, { maxLength: 4 }))
  .map(([first, rest]) => [first, ...rest].join("-"));

describe("parseCallSiteSpec", () => {
  it("accepts a valid call-site specification", () => {
    expect(parseCallSiteSpec(validSpec)).toMatchObject(validSpec);
  });

  it("rejects unstable call-site identifiers", () => {
    expect(() => parseCallSiteSpec({ ...validSpec, id: "Support Classification" })).toThrow(
      /lowercase kebab-case/,
    );
  });

  it("accepts generated stable identifiers", () => {
    fc.assert(
      fc.property(validIdentifier, (id) => {
        expect(parseCallSiteSpec({ ...validSpec, id }).id).toBe(id);
      }),
      { numRuns: 500 },
    );
  });

  it("rejects generated identifiers outside the grammar", () => {
    fc.assert(
      fc.property(
        fc.string().filter((id) => !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)),
        (id) => {
          expect(() => parseCallSiteSpec({ ...validSpec, id })).toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("recommendationStatusSchema", () => {
  it("includes abstention as a first-class outcome", () => {
    expect(recommendationStatusSchema.parse("insufficient-evidence")).toBe("insufficient-evidence");
  });
});
