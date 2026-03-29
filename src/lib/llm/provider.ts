export interface LlmTextPart {
  type: 'text';
  text: string;
}

export interface LlmImagePart {
  type: 'image';
  mediaType: 'image/png';
  base64Data: string;
}

export type LlmContentPart = LlmTextPart | LlmImagePart;

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | LlmContentPart[];
}

export interface LlmCompletionOptions {
  model: string;
  maxTokens: number;
  temperature?: number;
}

export interface LlmProvider {
  complete(messages: LlmMessage[], options: LlmCompletionOptions): Promise<string>;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  region?: string;
}
