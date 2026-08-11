export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const SUPPORT_CLASSIFICATION_MODEL = "openai/gpt-4.1-mini";

interface OpenAICompatibleClient {
  readonly chat: {
    readonly completions: {
      readonly create: (request: {
        readonly messages: readonly {
          readonly content: string;
          readonly role: "system" | "user";
        }[];
        readonly model: string;
        readonly response_format: { readonly type: "json_object" };
      }) => Promise<unknown>;
    };
  };
}

/**
 * This direct literal is deliberately scanner-friendly. The golden suite never invokes this
 * function; deterministic behavior is exercised through mock/provider.ts instead.
 */
export const classifySupportTicket = async (
  client: OpenAICompatibleClient,
  subject: string,
): Promise<unknown> =>
  client.chat.completions.create({
    messages: [
      {
        content: `Classify this synthetic support ticket: ${subject}`,
        role: "user",
      },
    ],
    model: SUPPORT_CLASSIFICATION_MODEL,
    response_format: { type: "json_object" },
  });
