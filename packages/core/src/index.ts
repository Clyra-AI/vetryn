import { z } from "zod";

export const recommendationStatusSchema = z.enum([
  "recommend",
  "no-change",
  "incompatible",
  "regression",
  "insufficient-evidence",
]);

export type RecommendationStatus = z.infer<typeof recommendationStatusSchema>;

export const sourceBindingSchema = z.object({
  adapter: z.string().min(1),
  file: z.string().min(1),
  symbol: z.string().min(1),
});

export type SourceBinding = z.infer<typeof sourceBindingSchema>;

export const evaluationGatesSchema = z
  .object({
    maxP95LatencyMs: z.number().int().positive().optional(),
    maxQualityRegression: z.number().min(0).max(1).default(0),
    minCases: z.number().int().positive().default(30),
    minPassRate: z.number().min(0).max(1),
    minSavingsPercent: z.number().min(0).max(100).default(0),
  })
  .strict();

export type EvaluationGates = z.infer<typeof evaluationGatesSchema>;

export const callSiteSpecSchema = z
  .object({
    binding: sourceBindingSchema,
    evalFixture: z.string().min(1),
    gates: evaluationGatesSchema,
    id: z
      .string()
      .min(1)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "Use a lowercase kebab-case call-site ID."),
    name: z.string().min(1),
    owner: z.string().min(1),
  })
  .strict();

export type CallSiteSpec = z.infer<typeof callSiteSpecSchema>;

export function parseCallSiteSpec(value: unknown): CallSiteSpec {
  return callSiteSpecSchema.parse(value);
}
