import type { LlmProvider, LlmMessage, LlmCompletionOptions, LlmContentPart } from './provider';

export class AnthropicProvider implements LlmProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async complete(messages: LlmMessage[], options: LlmCompletionOptions): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: Anthropic } = require('@anthropic-ai/sdk') as { default: new (opts: { apiKey: string }) => any };
    const client = new Anthropic({ apiKey: this.apiKey });

    // Extract system messages into a single system string
    const systemParts: string[] = [];
    const nonSystemMessages: LlmMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        if (typeof msg.content === 'string') {
          systemParts.push(msg.content);
        } else {
          systemParts.push(
            msg.content
              .filter((p): p is Extract<LlmContentPart, { type: 'text' }> => p.type === 'text')
              .map((p) => p.text)
              .join('\n'),
          );
        }
      } else {
        nonSystemMessages.push(msg);
      }
    }

    const anthropicMessages = nonSystemMessages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content:
        typeof msg.content === 'string'
          ? msg.content
          : msg.content.map((part) => {
              if (part.type === 'image') {
                return {
                  type: 'image' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: part.mediaType,
                    data: part.base64Data,
                  },
                };
              }
              return { type: 'text' as const, text: part.text };
            }),
    }));

    const params: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: anthropicMessages,
    };

    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }

    if (systemParts.length > 0) {
      params.system = systemParts.join('\n\n');
    }

    const response = await client.messages.create(params);

    return (response.content as Array<{ type: string; text?: string }>)
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('');
  }
}
