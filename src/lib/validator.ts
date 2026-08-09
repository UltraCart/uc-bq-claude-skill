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
  // Walk up from this module until the packaged schemas/ directory turns up.
  //
  // This used to hardcode '../../schemas', which assumed one exact build
  // layout (dist/lib/). Any other output structure resolved to a path that
  // does not exist, and the failure surfaced as an ENOENT from readFileSync
  // rather than anything that named the real problem.
  let dir = __dirname;
  for (;;) {
    const candidate = path.join(dir, 'schemas', schemaFile);
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Schema file "${schemaFile}" not found in any schemas/ directory above ${__dirname}. ` +
        `This usually means the package was installed without its schemas/ directory.`
      );
    }
    dir = parent;
  }
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
