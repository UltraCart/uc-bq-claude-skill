# Enhanced Table Schemas

This directory contains enhanced BigQuery table schemas with human-readable descriptions and `allowed_values` arrays generated from UltraCart's REST objects.

## Structure

```
tables/
├── ultracart_dw/              # Standard dataset (no PII columns)
├── ultracart_dw_medium/       # Medium dataset (includes PII columns)
└── ultracart_dw_streaming/    # Streaming dataset (analytics, screen recordings)
```

Each subdirectory corresponds to a BigQuery dataset. The schema files are organized by dataset so taxonomy-level restrictions are respected — a standard-taxonomy user never sees PII columns.

## File Format

Each file is a JSON array matching the BigQuery schema structure with additional fields:

```json
[
  {
    "name": "column_name",
    "type": "STRING",
    "mode": "NULLABLE",
    "description": "Human-readable description of what this column contains",
    "allowed_values": ["value1", "value2", "value3"],
    "mandatory": true
  }
]
```

- `description` — Helps the LLM understand the column's business meaning
- `allowed_values` — Constrains the LLM to valid values when writing SQL filters
- `mandatory` — If true, this column is always included in schema filtering

## Resolution Priority

When the CLI needs a table schema:
1. Check for an enhanced schema file here (`tables/{dataset}/{table}.json`)
2. Fall back to live BigQuery metadata if no enhanced schema exists

Use `uc-bq schema --tables=TABLE --live` to bypass enhanced schemas and fetch directly from BigQuery.
