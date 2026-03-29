import * as fs from 'fs';
import * as path from 'path';
import { validateConfig } from './config';

const CONFIG_FILENAME = '.ultracart-bq.json';

export function readRawConfig(): Record<string, any> {
  const configPath = path.join(process.cwd(), CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}. Run "uc-bq init" first.`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

export function writeConfig(config: Record<string, any>): void {
  // Ensure $schema is present
  config.$schema = config.$schema || 'https://ultracart.com/schemas/ultracart-bq-config.schema.json';

  // Validate before writing
  const validation = validateConfig(config as any);
  if (!validation.valid) {
    throw new Error(`Config validation failed:\n  ${validation.errors.join('\n  ')}`);
  }

  const configPath = path.join(process.cwd(), CONFIG_FILENAME);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
