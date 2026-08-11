export type MockOutcome =
  "success" | "invalid-output" | "timeout" | "rate-limit" | "usage" | "budget-exhaustion";

export interface MockUsage {
  readonly completionTokens: number;
  readonly promptTokens: number;
  readonly totalTokens: number;
}

export interface MockProviderOptions {
  readonly clock: string;
  readonly requestBudget: number;
  readonly retryLimit: number;
}

export interface MockRequest {
  readonly outcome: MockOutcome;
  readonly protectedInput?: string;
  readonly untrustedModelOutput?: string;
  readonly usage?: MockUsage;
}

export type MockEvent =
  | { readonly kind: "completed"; readonly usage: MockUsage }
  | { readonly kind: "invalid-usage"; readonly reason: "usage-accounting-invalid" }
  | { readonly kind: "invalid-output"; readonly reason: "schema-mismatch" }
  | { readonly kind: "timeout"; readonly reason: "timeout" }
  | { readonly kind: "rate-limit"; readonly retry: number }
  | { readonly kind: "budget-exhausted"; readonly reason: "request-budget-exhausted" };

export interface MockResult {
  readonly artifact: {
    readonly artifactType: "golden-provider-report";
    readonly events: readonly MockEvent[];
    readonly finishedAt: string;
    readonly requestCount: number;
    readonly schemaVersion: "1.0.0";
    readonly usage: MockUsage;
  };
  readonly attempts: number;
  readonly code:
    | "budget-exhausted"
    | "invalid-output"
    | "invalid-usage"
    | "rate-limit-exhausted"
    | "success"
    | "timeout";
  readonly disposition: "abstain" | "complete";
}

const EMPTY_USAGE: MockUsage = { completionTokens: 0, promptTokens: 0, totalTokens: 0 };
const DEFAULT_USAGE: MockUsage = { completionTokens: 1, promptTokens: 9, totalTokens: 10 };

const assertNonNegativeInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
};

const isValidUsage = (usage: MockUsage): boolean =>
  [usage.promptTokens, usage.completionTokens, usage.totalTokens].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  ) && usage.totalTokens === usage.promptTokens + usage.completionTokens;

export const evaluatePatchPrecondition = (
  expectedFingerprint: string,
  observedFingerprint: string,
) =>
  expectedFingerprint === observedFingerprint
    ? {
        diagnosticCodes: [] as const,
        disposition: "eligible" as const,
        patch: { operation: "replace-model-literal" as const },
      }
    : {
        diagnosticCodes: ["stale-source-fingerprint"] as const,
        disposition: "refuse" as const,
        patch: null,
      };

const createResult = (
  options: MockProviderOptions,
  requestCount: number,
  attempts: number,
  code: MockResult["code"],
  events: readonly MockEvent[],
  usage: MockUsage,
): MockResult => ({
  artifact: {
    artifactType: "golden-provider-report",
    events,
    finishedAt: options.clock,
    requestCount,
    schemaVersion: "1.0.0",
    usage,
  },
  attempts,
  code,
  disposition: code === "success" ? "complete" : "abstain",
});

/** A deterministic provider substitute. It never sends a request or persists raw test input/output. */
export const createMockProvider = (options: MockProviderOptions) => {
  assertNonNegativeInteger(options.requestBudget, "requestBudget");
  assertNonNegativeInteger(options.retryLimit, "retryLimit");

  let requestCount = 0;

  const budgetResult = (attempts: number, events: readonly MockEvent[]): MockResult =>
    createResult(
      options,
      requestCount,
      attempts,
      "budget-exhausted",
      [...events, { kind: "budget-exhausted", reason: "request-budget-exhausted" }],
      EMPTY_USAGE,
    );

  return {
    async execute(request: MockRequest): Promise<MockResult> {
      if (request.outcome === "budget-exhaustion" || requestCount >= options.requestBudget) {
        return budgetResult(0, []);
      }

      if (request.outcome === "rate-limit") {
        const events: MockEvent[] = [];
        let attempts = 0;

        while (attempts <= options.retryLimit) {
          if (requestCount >= options.requestBudget) {
            return budgetResult(attempts, events);
          }

          attempts += 1;
          requestCount += 1;
          events.push({ kind: "rate-limit", retry: attempts - 1 });
        }

        return createResult(
          options,
          requestCount,
          attempts,
          "rate-limit-exhausted",
          events,
          EMPTY_USAGE,
        );
      }

      requestCount += 1;

      if (request.outcome === "invalid-output") {
        return createResult(
          options,
          requestCount,
          1,
          "invalid-output",
          [{ kind: "invalid-output", reason: "schema-mismatch" }],
          EMPTY_USAGE,
        );
      }

      if (request.outcome === "timeout") {
        return createResult(
          options,
          requestCount,
          1,
          "timeout",
          [{ kind: "timeout", reason: "timeout" }],
          EMPTY_USAGE,
        );
      }

      const usage = request.outcome === "usage" ? (request.usage ?? DEFAULT_USAGE) : DEFAULT_USAGE;

      if (!isValidUsage(usage)) {
        return createResult(
          options,
          requestCount,
          1,
          "invalid-usage",
          [{ kind: "invalid-usage", reason: "usage-accounting-invalid" }],
          EMPTY_USAGE,
        );
      }

      return createResult(
        options,
        requestCount,
        1,
        "success",
        [{ kind: "completed", usage }],
        usage,
      );
    },
  };
};
