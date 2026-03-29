import type { LlmProvider, LlmMessage, LlmCompletionOptions, LlmContentPart } from './provider';

export class BedrockProvider implements LlmProvider {
  private region: string;

  constructor(region: string) {
    this.region = region;
  }

  async complete(messages: LlmMessage[], options: LlmCompletionOptions): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {
      BedrockRuntimeClient,
      ConverseCommand,
    } = require('@aws-sdk/client-bedrock-runtime') as {
      BedrockRuntimeClient: new (opts: { region: string }) => any;
      ConverseCommand: new (input: Record<string, unknown>) => any;
    };

    const client = new BedrockRuntimeClient({ region: this.region });

    // Extract system messages
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

    const converseMessages = nonSystemMessages.map((msg) => ({
      role: msg.role,
      content:
        typeof msg.content === 'string'
          ? [{ text: msg.content }]
          : msg.content.map((part) => {
              if (part.type === 'image') {
                return {
                  image: {
                    format: 'png' as const,
                    source: {
                      bytes: Buffer.from(part.base64Data, 'base64'),
                    },
                  },
                };
              }
              return { text: part.text };
            }),
    }));

    const input: Record<string, unknown> = {
      modelId: options.model,
      messages: converseMessages,
      inferenceConfig: {
        maxTokens: options.maxTokens,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    };

    if (systemParts.length > 0) {
      input.system = [{ text: systemParts.join('\n\n') }];
    }

    const command = new ConverseCommand(input);
    const response = await client.send(command);

    return response.output?.message?.content?.[0]?.text ?? '';
  }
}
