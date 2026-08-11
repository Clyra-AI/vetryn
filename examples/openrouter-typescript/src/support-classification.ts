import OpenAI from "openai";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Construction is synchronous; callers may inject an offline OpenAI-compatible transport for replay. */
export const createOpenRouterClient = (apiKey: string, fetch?: typeof globalThis.fetch): OpenAI =>
  new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    ...(fetch === undefined ? {} : { fetch }),
    maxRetries: 0,
  });

/**
 * This direct literal is deliberately scanner-friendly and is replayed through an injected,
 * offline OpenAI-compatible transport by the golden scenario suite.
 */
export const classifySupportTicket = async (client: OpenAI, subject: string): Promise<unknown> =>
  client.chat.completions.create({
    messages: [
      {
        content: `Classify this synthetic support ticket: ${subject}`,
        role: "user",
      },
    ],
    model: "openai/gpt-4.1-mini",
    response_format: { type: "json_object" },
  });
