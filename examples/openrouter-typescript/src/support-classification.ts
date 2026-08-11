import OpenAI from "openai";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Construction is synchronous; the offline scenario suite never invokes the returned client. */
export const createOpenRouterClient = (apiKey: string): OpenAI =>
  new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL, maxRetries: 0 });

/**
 * This direct literal is deliberately scanner-friendly. The golden suite never invokes this
 * function; deterministic behavior is exercised through mock/provider.ts instead.
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
