const MODEL_DEFAULTS: Record<string, { analysis: string; schemaFilter: string }> = {
  anthropic: {
    analysis: 'claude-sonnet-4-5-20250929',
    schemaFilter: 'claude-haiku-4-5-20251001',
  },
  openai: {
    analysis: 'gpt-4o',
    schemaFilter: 'gpt-4o-mini',
  },
  grok: {
    analysis: 'grok-2',
    schemaFilter: 'grok-2',
  },
  bedrock: {
    analysis: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
    schemaFilter: 'anthropic.claude-haiku-4-5-20251001-v1:0',
  },
  gemini: {
    analysis: 'gemini-2.0-flash',
    schemaFilter: 'gemini-2.0-flash-lite',
  },
};

export function getDefaultModels(provider: string): { analysis: string; schemaFilter: string } {
  const defaults = MODEL_DEFAULTS[provider];
  if (!defaults) {
    throw new Error(`Unknown provider "${provider}". Supported: ${Object.keys(MODEL_DEFAULTS).join(', ')}`);
  }
  return { ...defaults };
}
