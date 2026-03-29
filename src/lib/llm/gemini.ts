import type { LlmProvider, LlmMessage, LlmCompletionOptions, LlmContentPart } from './provider';

export class GeminiProvider implements LlmProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async complete(messages: LlmMessage[], options: LlmCompletionOptions): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GoogleGenerativeAI } = require('@google/generative-ai') as {
      GoogleGenerativeAI: new (apiKey: string) => any;
    };

    const genAI = new GoogleGenerativeAI(this.apiKey);

    // Extract system messages for systemInstruction
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

    const modelConfig: Record<string, unknown> = { model: options.model };
    if (systemParts.length > 0) {
      modelConfig.systemInstruction = systemParts.join('\n\n');
    }

    const model = genAI.getGenerativeModel(modelConfig);

    // Build Gemini content array
    const contents = nonSystemMessages.map((msg) => {
      const role = msg.role === 'assistant' ? 'model' : 'user';

      const parts =
        typeof msg.content === 'string'
          ? [{ text: msg.content }]
          : msg.content.map((part) => {
              if (part.type === 'image') {
                return {
                  inlineData: {
                    mimeType: part.mediaType,
                    data: part.base64Data,
                  },
                };
              }
              return { text: part.text };
            });

      return { role, parts };
    });

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: options.maxTokens,
    };
    if (options.temperature !== undefined) {
      generationConfig.temperature = options.temperature;
    }

    const result = await model.generateContent({ contents, generationConfig });
    const response = result.response;
    return response.text();
  }
}
