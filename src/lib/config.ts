import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateConfig as schemaValidateConfig } from './validator';

export interface ExternalProject {
  project_id: string;
  description?: string;
  datasets: Record<string, string[]>;
}

export interface MerchantConfig {
  taxonomy_level: 'standard' | 'low' | 'medium' | 'high';
  dataset: string;
  external_projects?: Record<string, ExternalProject>;
}

export interface UcBqConfig {
  default_merchant: string;
  merchants: Record<string, MerchantConfig>;
  default_output_dir: string;
  output_format: 'png' | 'pdf' | 'both';
  chart_theme: string;
  chart_defaults: {
    width: number;
    height: number;
  };
  max_query_bytes?: number;  // Max bytes before aborting (default: 10 GB). Set to 0 to disable.
  llm?: {
    provider?: string;
    api_key_env?: string;
    analysis_model?: string;
    schema_filter_model?: string;
    region?: string;
  };
}

export interface LlmConfig {
  provider: string;        // 'anthropic' | 'openai' | 'grok' | 'bedrock' | 'gemini'
  apiKey?: string;
  apiKeyEnv?: string;
  analysisModel?: string;
  schemaFilterModel?: string;
  region?: string;
}

export interface ResolvedMerchantConfig {
  merchant_id: string;
  project_id: string;
  taxonomy_level: 'standard' | 'low' | 'medium' | 'high';
  dataset: string;
  default_output_dir: string;
  output_format: 'png' | 'pdf' | 'both';
  chart_theme: string;
  chart_defaults: {
    width: number;
    height: number;
  };
  external_projects?: Record<string, ExternalProject>;
  max_query_bytes: number;
}

const CONFIG_FILENAME = '.ultracart-bq.json';

const DEFAULT_MAX_QUERY_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

const DEFAULTS: Partial<UcBqConfig> = {
  default_output_dir: './reports',
  output_format: 'png',
  chart_theme: 'default',
  chart_defaults: { width: 1200, height: 600 },
  max_query_bytes: DEFAULT_MAX_QUERY_BYTES,
};

/**
 * Detects old single-merchant config format (has `project_id`) and migrates
 * it to the new multi-merchant format in memory. Logs a deprecation warning.
 */
function migrateConfigIfNeeded(raw: Record<string, unknown>): Record<string, unknown> {
  if (!('project_id' in raw)) {
    return raw;
  }

  const projectId = raw.project_id as string;
  const prefix = 'ultracart-dw-';
  const merchantId = projectId.startsWith(prefix)
    ? projectId.substring(prefix.length)
    : projectId;

  const taxonomyLevel = (raw.taxonomy_level as string) || 'standard';
  const dataset = (raw.dataset as string) || 'ultracart_dw';

  console.error(
    `[WARNING] Old config format detected (project_id: "${projectId}"). ` +
    `Auto-migrating to multi-merchant format with merchant "${merchantId}". ` +
    `Please update your ${CONFIG_FILENAME} to the new format.`
  );

  const migrated: Record<string, unknown> = { ...raw };
  delete migrated.project_id;
  delete migrated.taxonomy_level;
  delete migrated.dataset;

  migrated.default_merchant = merchantId;
  migrated.merchants = {
    [merchantId]: {
      taxonomy_level: taxonomyLevel,
      dataset: dataset,
    },
  };

  return migrated;
}

export function loadConfig(): UcBqConfig {
  const candidates = [
    path.join(process.cwd(), CONFIG_FILENAME),
    path.join(os.homedir(), CONFIG_FILENAME),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const migrated = migrateConfigIfNeeded(raw);
      const config: UcBqConfig = { ...DEFAULTS, ...migrated } as UcBqConfig;
      return config;
    }
  }

  throw new Error(
    `Config file not found. Create ${CONFIG_FILENAME} in the current directory or home directory.\n` +
    `Required fields: default_merchant, merchants`
  );
}

export function resolveMerchant(config: UcBqConfig, merchantId?: string): ResolvedMerchantConfig {
  const id = merchantId || config.default_merchant;

  const merchantConfig = config.merchants[id];
  if (!merchantConfig) {
    const available = Object.keys(config.merchants).join(', ');
    throw new Error(
      `Merchant "${id}" not found in config. Available merchants: ${available}`
    );
  }

  return {
    merchant_id: id,
    project_id: `ultracart-dw-${id.toLowerCase()}`,
    taxonomy_level: merchantConfig.taxonomy_level,
    dataset: merchantConfig.dataset,
    default_output_dir: path.join(config.default_output_dir, id),
    output_format: config.output_format,
    chart_theme: config.chart_theme,
    chart_defaults: config.chart_defaults,
    external_projects: merchantConfig.external_projects,
    max_query_bytes: config.max_query_bytes ?? DEFAULT_MAX_QUERY_BYTES,
  };
}

export function validateConfig(config: UcBqConfig): { valid: boolean; errors: string[] } {
  return schemaValidateConfig(config);
}

const DEFAULT_API_KEY_ENV: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  grok: 'XAI_API_KEY',
  bedrock: '', // Uses AWS credential chain, no API key
  gemini: 'GOOGLE_API_KEY',
};

export function resolveLlmConfig(config: UcBqConfig, overrides?: { provider?: string; apiKey?: string }): LlmConfig {
  const provider = overrides?.provider || config.llm?.provider || 'anthropic';

  // Resolve API key: CLI override > env var from config > default env var for provider
  let apiKey = overrides?.apiKey;
  let apiKeyEnv = config.llm?.api_key_env;

  if (!apiKey) {
    const envVarName = apiKeyEnv || DEFAULT_API_KEY_ENV[provider] || '';
    if (envVarName) {
      apiKey = process.env[envVarName];
      apiKeyEnv = envVarName;
    }
  }

  return {
    provider,
    apiKey,
    apiKeyEnv,
    analysisModel: config.llm?.analysis_model,
    schemaFilterModel: config.llm?.schema_filter_model,
    region: config.llm?.region,
  };
}
