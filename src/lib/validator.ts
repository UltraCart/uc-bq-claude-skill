import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import * as fs from 'fs';
import * as path from 'path';

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function createAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  return ajv;
}

function getSchemaPath(schemaFile: string): string {
  // Resolve relative to the package root (two levels up from dist/lib/)
  return path.resolve(__dirname, '..', '..', 'schemas', schemaFile);
}

function loadSchema(schemaFile: string): Record<string, unknown> {
  const schemaPath = getSchemaPath(schemaFile);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  // Remove $schema and $id — Ajv doesn't support 2020-12 meta-schema natively
  delete schema.$schema;
  delete schema.$id;
  return schema;
}

function formatErrors(ajv: Ajv): string[] {
  if (!ajv.errors) return [];
  return ajv.errors.map((e) => {
    const path = e.instancePath || '/';
    return `${path}: ${e.message}`;
  });
}

export function validateConfig(config: unknown): ValidationResult {
  const ajv = createAjv();
  const schema = loadSchema('ultracart-bq-config.schema.json');
  const valid = ajv.validate(schema, config);
  return {
    valid: valid as boolean,
    errors: valid ? [] : formatErrors(ajv),
  };
}

export function validateManifest(manifest: unknown): ValidationResult {
  const ajv = createAjv();
  const schema = loadSchema('report-manifest.schema.json');
  const valid = ajv.validate(schema, manifest);
  return {
    valid: valid as boolean,
    errors: valid ? [] : formatErrors(ajv),
  };
}
