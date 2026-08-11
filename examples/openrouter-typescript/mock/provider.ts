export type MockOutcome =
  "success" | "invalid-output" | "timeout" | "rate-limit" | "usage" | "budget-exhaustion";

const mockOutcomes = new Set<MockOutcome>([
  "success",
  "invalid-output",
  "timeout",
  "rate-limit",
  "usage",
  "budget-exhaustion",
]);

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
  | { readonly kind: "invalid-request"; readonly reason: "unknown-outcome" }
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
    | "invalid-request"
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

const isMockOutcome = (outcome: unknown): outcome is MockOutcome =>
  typeof outcome === "string" && mockOutcomes.has(outcome as MockOutcome);

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
      if (!isMockOutcome(request.outcome)) {
        return createResult(
          options,
          requestCount,
          0,
          "invalid-request",
          [{ kind: "invalid-request", reason: "unknown-outcome" }],
          EMPTY_USAGE,
        );
      }

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

interface OpenAIRequestObservation {
  readonly endpoint: "/api/v1/chat/completions";
  readonly method: "POST";
  readonly model: string;
  readonly responseFormat: "json_object";
}

export interface OpenAICompatibleMockTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: readonly OpenAIRequestObservation[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", "x-request-id": "golden-request" },
    status,
  });

/**
 * A deterministic fetch substitute for the real OpenAI SDK. It records only the request shape
 * required by the scenario; prompt text, credentials, and model output remain transient.
 */
export const createOpenAICompatibleMockTransport = (
  options: MockProviderOptions,
): OpenAICompatibleMockTransport => {
  const provider = createMockProvider(options);
  const requests: OpenAIRequestObservation[] = [];

  return {
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const body: unknown = JSON.parse(await request.text());
      const responseFormat =
        isRecord(body) && isRecord(body.response_format) ? body.response_format : null;
      const model = isRecord(body) && typeof body.model === "string" ? body.model : null;

      if (
        request.method !== "POST" ||
        url.pathname !== "/api/v1/chat/completions" ||
        model === null ||
        responseFormat?.type !== "json_object"
      ) {
        return createJsonResponse({ error: { message: "invalid golden request" } }, 400);
      }

      const result = await provider.execute({ outcome: "success" });

      if (result.disposition !== "complete") {
        return createJsonResponse(
          { error: { message: `golden provider ${result.code}` } },
          result.code === "budget-exhausted" ? 429 : 500,
        );
      }

      requests.push({
        endpoint: "/api/v1/chat/completions",
        method: "POST",
        model,
        responseFormat: "json_object",
      });

      return createJsonResponse({
        choices: [
          {
            finish_reason: "stop",
            index: 0,
            logprobs: null,
            message: { content: '{"classification":"billing"}', refusal: null, role: "assistant" },
          },
        ],
        created: 1_723_248_000,
        id: "chatcmpl-golden",
        model,
        object: "chat.completion",
        usage: {
          completion_tokens: result.artifact.usage.completionTokens,
          prompt_tokens: result.artifact.usage.promptTokens,
          total_tokens: result.artifact.usage.totalTokens,
        },
      });
    },
    requests,
  };
};
