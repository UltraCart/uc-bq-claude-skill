import type { LlmProvider, LlmMessage, LlmCompletionOptions } from './provider';

export class OpenAIProvider implements LlmProvider {
  private apiKey: string;
  private baseUrl?: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async complete(messages: LlmMessage[], options: LlmCompletionOptions): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: OpenAI } = require('openai') as { default: new (opts: Record<string, unknown>) => any };

    const clientOpts: Record<string, unknown> = { apiKey: this.apiKey };
    if (this.baseUrl) {
      clientOpts.baseURL = this.baseUrl;
    }
    const client = new OpenAI(clientOpts);

    const openaiMessages = messages.map((msg) => ({
      role: msg.role,
      content:
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((part) => {
              if (part.type === 'image') {
                return {
                  type: 'image_url' as const,
                  image_url: {
                    url: `data:${part.mediaType};base64,${part.base64Data}`,
                  },
                };
              }
              return { type: 'text' as const, text: part.text };
            }),
    }));

    const params: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: openaiMessages,
    };

    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    const response = await client.chat.completions.create(params);
    return response.choices[0].message.content ?? '';
  }
}
