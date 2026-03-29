import type { LlmProvider, ProviderConfig } from './provider';

export { LlmProvider, LlmMessage, LlmContentPart, LlmTextPart, LlmImagePart, LlmCompletionOptions, ProviderConfig } from './provider';
export { getDefaultModels } from './models';

const SDK_PACKAGES: Record<string, string> = {
  anthropic: '@anthropic-ai/sdk',
  openai: 'openai',
  grok: 'openai',
  bedrock: '@aws-sdk/client-bedrock-runtime',
  gemini: '@google/generative-ai',
};

function ensureSdkInstalled(provider: string): void {
  const pkg = SDK_PACKAGES[provider];
  if (!pkg) {
    throw new Error(`Unknown LLM provider "${provider}". Supported: ${Object.keys(SDK_PACKAGES).join(', ')}`);
  }
  try {
    require.resolve(pkg);
  } catch {
    throw new Error(`Provider "${provider}" requires ${pkg}. Run: npm install ${pkg}`);
  }
}

export function createProvider(providerName: string, config: ProviderConfig): LlmProvider {
  ensureSdkInstalled(providerName);

  switch (providerName) {
    case 'anthropic': {
      const { AnthropicProvider } = require('./anthropic') as typeof import('./anthropic');
      if (!config.apiKey) throw new Error('Anthropic provider requires an API key');
      return new AnthropicProvider(config.apiKey);
    }
    case 'openai': {
      const { OpenAIProvider } = require('./openai') as typeof import('./openai');
      if (!config.apiKey) throw new Error('OpenAI provider requires an API key');
      return new OpenAIProvider(config.apiKey, config.baseUrl);
    }
    case 'grok': {
      const { OpenAIProvider } = require('./openai') as typeof import('./openai');
      if (!config.apiKey) throw new Error('Grok provider requires an API key');
      return new OpenAIProvider(config.apiKey, config.baseUrl || 'https://api.x.ai/v1');
    }
    case 'bedrock': {
      const { BedrockProvider } = require('./bedrock') as typeof import('./bedrock');
      return new BedrockProvider(config.region || 'us-east-1');
    }
    case 'gemini': {
      const { GeminiProvider } = require('./gemini') as typeof import('./gemini');
      if (!config.apiKey) throw new Error('Gemini provider requires an API key');
      return new GeminiProvider(config.apiKey);
    }
    default:
      throw new Error(`Unknown LLM provider "${providerName}". Supported: ${Object.keys(SDK_PACKAGES).join(', ')}`);
  }
}
