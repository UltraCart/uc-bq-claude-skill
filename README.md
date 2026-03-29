# @ultracart/bq-skill

A Claude Code skill + Node.js CLI for building and replaying UltraCart BigQuery reports with Apache ECharts visualizations.

## What This Is

UltraCart streams e-commerce data (orders, customers, items, analytics, etc.) into a per-merchant BigQuery data warehouse. This package gives merchants two things:

1. **`uc-bq` CLI** — A command-line tool that handles BigQuery queries, ECharts rendering, schema validation, and report replay. No LLM needed for replay.
2. **Claude Code skill prompt** — A comprehensive prompt that teaches Claude Code how to build reports using the CLI. Claude Code does the thinking (SQL generation, chart design, analysis), the CLI does the execution.

The key insight: **design a report once with Claude Code, replay it forever with just the CLI.** The LLM cost is a one-time design expense. Daily/weekly report refreshes are pure Node.js — no AI calls, no subscription needed.

## Prerequisites

- **Node.js** >= 18
- **Google Cloud credentials** — either:
  - `gcloud auth application-default login` (recommended), or
  - `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account JSON
- **BigQuery access** — your UltraCart merchant account must have the data warehouse enabled
- **Puppeteer** — installed automatically with the package (for headless chart rendering)
- **Claude Code** — for creating new reports (not needed for replaying existing ones)

## Installation

```bash
npm install -g @ultracart/bq-skill
```

All LLM provider SDKs (Anthropic, OpenAI, Google Gemini, AWS Bedrock) are bundled — no extra installs needed.

## Authentication

The CLI uses Google Cloud's Application Default Credentials (ADC). You authenticate once, and the BigQuery SDK picks up your credentials automatically — no tokens or keys in your code.

### Option A: gcloud CLI (recommended for development)

This is the simplest path. You sign in with your Google account and the SDK handles the rest.

**1. Install the Google Cloud CLI** (if you don't already have it):

```bash
# macOS
brew install google-cloud-sdk

# Linux (Debian/Ubuntu)
sudo apt-get install google-cloud-cli

# Windows
# Download from https://cloud.google.com/sdk/docs/install
```

**2. Log in to your Google account:**

```bash
gcloud auth login
```

This opens a browser window. Sign in with the Google account that has access to your UltraCart BigQuery project.

**3. Set application default credentials:**

```bash
gcloud auth application-default login
```

This creates a local credential file that the BigQuery SDK finds automatically. You only need to do this once per machine (credentials persist across terminal sessions).

**4. Verify it works:**

```bash
uc-bq init
# Or if you already have a config:
uc-bq schema --list
```

If you see your tables, you're authenticated.

**Logging out:**

```bash
# Revoke application default credentials
gcloud auth application-default revoke

# Revoke your full gcloud login
gcloud auth revoke
```

### Option B: Service Account (recommended for CI/CD and scheduled runs)

Use this for automated/headless environments where you can't open a browser.

**1. Create a GCP project** (if you don't have one):

Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or use an existing one). This is YOUR project — separate from UltraCart's.

**2. Create a service account:**

```bash
# Create the service account
gcloud iam service-accounts create uc-bq-reader \
  --display-name="UltraCart BQ Reader" \
  --project=YOUR_PROJECT_ID

# Download the JSON key
gcloud iam service-accounts keys create ./sa-key.json \
  --iam-account=uc-bq-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

**3. Register the service account in UltraCart:**

Go to the UltraCart dashboard and register the service account email (`uc-bq-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com`) so UltraCart can provision BigQuery access for it. Your UltraCart admin assigns the taxonomy level.

**4. Set the environment variable:**

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/sa-key.json"
```

Add this to your `.bashrc`, `.zshrc`, or CI environment variables for persistence.

**5. Verify it works:**

```bash
uc-bq schema --list
```

### Troubleshooting Authentication

| Error | Fix |
|---|---|
| `Could not load the default credentials` | Run `gcloud auth application-default login` or set `GOOGLE_APPLICATION_CREDENTIALS` |
| `Permission denied` / `Access Denied` | Your Google account or service account hasn't been granted access in UltraCart. Contact your UltraCart admin. |
| `Project not found` | The project ID is derived from your merchant ID (`ultracart-dw-{merchantid}`). Check that your merchant IDs in `.ultracart-bq.json` are correct. |
| `Dataset not found` | Your taxonomy level may not include the dataset you're querying. Standard users can't access `ultracart_dw_medium`. |

## Quick Start

### 1. Configure

```bash
uc-bq init
```

This prompts for your merchant ID(s), taxonomy level, and preferences, then writes `.ultracart-bq.json` and tests the connection. The BigQuery project ID is derived automatically from your merchant ID (`ultracart-dw-{merchantid}`).

Or create the config manually:

```json
{
  "default_merchant": "DEMO",
  "merchants": {
    "DEMO": { "taxonomy_level": "medium", "dataset": "ultracart_dw" }
  },
  "default_output_dir": "./reports",
  "output_format": "png",
  "chart_theme": "default",
  "chart_defaults": { "width": 1200, "height": 600 },
  "max_query_bytes": 10737418240,
  "llm": {
    "provider": "anthropic",
    "api_key_env": "ANTHROPIC_API_KEY",
    "analysis_model": "claude-sonnet-4-5-20250929",
    "schema_filter_model": "claude-haiku-4-5-20251001"
  }
}
```

Add more merchants to manage multiple stores from one config:

```json
{
  "default_merchant": "DEMO",
  "merchants": {
    "DEMO": { "taxonomy_level": "medium", "dataset": "ultracart_dw" },
    "DEMO2": { "taxonomy_level": "standard", "dataset": "ultracart_dw" }
  }
}
```

The `llm` section is optional. All fields within it are optional. If omitted, the CLI defaults to Anthropic. See [LLM Providers](#llm-providers) for details.

Use the global `--merchant` / `-m` flag to target a specific merchant on any command:

```bash
uc-bq schema --list -m DEMO2
uc-bq run revenue-by-category -m DEMO2
```

### 2. Create a Report (with Claude Code)

In Claude Code, use the skill to ask a question:

```
Show me revenue trends by product category for the last 90 days
```

Claude Code will:
1. Discover your schema via `uc-bq schema`
2. Generate and test SQL via `uc-bq query`
3. Create an ECharts visualization
4. Render to PNG via `uc-bq render`
5. Write an executive analysis
6. Save a replayable report manifest

**Result:** A report directory under `./reports/{merchant_id}/{report-name}/` with `report.yaml`, `query.sql`, `chart.js`, `chart.png`, `report.pdf`, and `report.md`.

### 3. Replay a Report (no Claude Code needed)

```bash
# Replay with default date parameters
uc-bq run revenue-by-category

# Replay with custom date range
uc-bq run revenue-by-category --start_date=2026-01-01 --end_date=2026-03-28

# Replay all saved reports
uc-bq run-all --start_date=2026-01-01 --end_date=2026-03-28
```

Replay executes the saved SQL, renders the saved chart config, generates a combined PDF (`report.pdf`) with the chart and executive analysis, and updates run history. Zero LLM calls.

## CLI Reference

### `uc-bq init`

Interactive setup. Creates `.ultracart-bq.json` and tests BigQuery connectivity.

### `uc-bq config`

Manage merchants, external projects, and settings.

```bash
uc-bq config show                                              # Show current config
uc-bq config add-merchant <id> --taxonomy=X [--dataset=Y]      # Add a merchant
uc-bq config remove-merchant <id>                              # Remove a merchant
uc-bq config add-project <alias> --project-id=X [--description=Y]   # Register external project
uc-bq config remove-project <alias>                            # Remove external project
uc-bq config add-dataset <alias> <dataset> [--discover]        # Add dataset to external project
uc-bq config remove-dataset <alias> <dataset>                  # Remove dataset
uc-bq config add-tables <alias> <dataset> <tables...>          # Expose specific tables
uc-bq config remove-tables <alias> <dataset> <tables...>       # Remove table access

# Delivery config
uc-bq config add-slack <report> <channel-id...>                # Add Slack channel(s) to a report
uc-bq config remove-slack <report> <channel-id...>             # Remove Slack channel(s)
uc-bq config set-email <report> --to=a@example.com,b@example.com --provider=sendgrid --subject="Weekly"  # Set full email config
uc-bq config add-email <report> <email...>                     # Add email recipient(s)
uc-bq config remove-email <report> <email...>                  # Remove email recipient(s)
uc-bq config set-email-provider <report> <provider>            # Set email provider
uc-bq config set-email-subject <report> <subject>              # Set email subject line
uc-bq config show-delivery <report>                            # Show delivery config for a report

# Report parameter defaults
uc-bq config set-param <report> <param> <value>                # Set a default parameter on a report
uc-bq config remove-param <report> <param>                     # Remove a default parameter
uc-bq config show-params <report>                              # Show parameter defaults for a report

# Deck parameter overrides
uc-bq config set-deck-param <deck> <param> <value>             # Set a parameter override on a deck
uc-bq config remove-deck-param <deck> <param>                  # Remove a deck parameter override
uc-bq config show-deck-params <deck>                           # Show parameter overrides for a deck
```

### `uc-bq schema`

Explore your BigQuery schema, including external projects.

```bash
# List all available tables
uc-bq schema --list

# Get schema for specific tables
uc-bq schema --tables=uc_orders,uc_items

# Filter schema columns by keyword
uc-bq schema --tables=uc_orders --filter="revenue,date,category"

# Output as JSON (for piping)
uc-bq schema --tables=uc_orders --format=json

# Browse an external GCP project before registering it
uc-bq schema --project=my-marketing-warehouse                          # list datasets
uc-bq schema --project=my-marketing-warehouse --dataset=X --list       # list tables
uc-bq schema --project=my-marketing-warehouse --dataset=X --tables=Y   # get schema

# Refresh cached external table schemas
uc-bq schema --refresh
```

### `uc-bq query`

Execute SQL against BigQuery.

```bash
# Execute from a file with parameters
uc-bq query --file=query.sql --params='{"start_date":"2026-01-01","end_date":"2026-03-28"}'

# Execute inline SQL
uc-bq query --sql="SELECT COUNT(*) as cnt FROM \`ultracart-dw-mymerchant.ultracart_dw.uc_orders\`"

# Save results to JSON
uc-bq query --file=query.sql --params='...' --output=data.json

# Show more sample rows (default: 20)
uc-bq query --file=query.sql --params='...' --sample=50

# Bypass the cost safety check
uc-bq query --file=query.sql --params='...' --force

# Override the cost limit for this command (bytes)
uc-bq query --file=query.sql --params='...' --max-bytes=53687091200
```

### `uc-bq dry-run`

Estimate query cost before executing.

```bash
uc-bq dry-run --file=query.sql --params='{"start_date":"2026-01-01","end_date":"2026-03-28"}'

# Output:
#   Estimated bytes processed: 2.4 GB
#   Estimated cost: $0.015
```

### `uc-bq validate`

Validate configuration or report manifests against JSON Schema.

```bash
# Validate your config
uc-bq validate --config

# Validate a report manifest
uc-bq validate --manifest=./reports/revenue-by-category/report.yaml
```

### `uc-bq render`

Render an ECharts chart to PNG or PDF.

```bash
# Render to PNG
uc-bq render --chart=chart.js --data=data.json --output=chart.png

# Render to PDF
uc-bq render --chart=chart.js --data=data.json --output=chart.pdf --format=pdf

# Render dashboard thumbnail (200x200)
uc-bq render --chart=chart.js --data=data.json --output=chart-thumb.png --dashboard

# Custom dimensions
uc-bq render --chart=chart.js --data=data.json --output=chart.png --width=1600 --height=900
```

### `uc-bq run`

Replay a saved report with fresh data.

```bash
# Run with default parameters
uc-bq run revenue-by-category

# Override parameters
uc-bq run revenue-by-category --start_date=2026-01-01 --end_date=2026-03-28

# Skip analysis generation
uc-bq run revenue-by-category --no-analysis

# Generate PDF in landscape orientation (useful for wide charts)
uc-bq run revenue-by-category --landscape

# Run and deliver to Slack/email (as configured in the report manifest)
uc-bq run revenue-by-category --deliver

# Bypass the cost safety check
uc-bq run revenue-by-category --force

# Override the cost limit for this run (bytes)
uc-bq run revenue-by-category --max-bytes=53687091200
```

### `uc-bq run-all`

Replay all saved reports.

```bash
# Run all with shared date range
uc-bq run-all --start_date=2026-01-01 --end_date=2026-03-28

# Run all without analysis
uc-bq run-all --no-analysis

# Run all in landscape orientation
uc-bq run-all --landscape

# Run all and deliver to Slack/email
uc-bq run-all --deliver --no-analysis

# Bypass the cost safety check for all reports
uc-bq run-all --force

# Override the cost limit for all reports (bytes)
uc-bq run-all --max-bytes=53687091200
```

### `uc-bq deck run <deck-name>`

Run all reports in a deck and generate a combined PDF.

```bash
# Generate the deck PDF
uc-bq deck run weekly-executive

# Generate and deliver the deck
uc-bq deck run weekly-executive --deliver

# Skip analysis generation
uc-bq deck run weekly-executive --no-analysis

# Override parameters for all reports in the deck
uc-bq deck run weekly-executive --start_date=2026-01-01 --end_date=2026-03-31
```

### `uc-bq deck list`

List all defined decks.

```bash
uc-bq deck list
```

### `uc-bq deck create <deck-name>`

Interactive deck creation.

```bash
uc-bq deck create weekly-executive

# Create with inline options
uc-bq deck create weekly --title="Weekly" --reports=rev,ltv --params="start_date=start_of_year,end_date=today"
```

### `uc-bq list`

List all saved reports.

```bash
uc-bq list

# Output:
#   Name                          Last Run      Status  Parameters
#   Revenue by Product Category   2026-03-28    OK      2 req, 2 opt
#   Customer Cohort Analysis      2026-03-25    OK      3 req, 0 opt
```

### `uc-bq history`

Show run history for a report.

```bash
uc-bq history revenue-by-category

# Output:
#   Run Date     Parameters                         Rows   Bytes
#   2026-03-28   start=2025-12-28 end=2026-03-28    1,247  2.4 GB
#   2026-03-21   start=2025-12-21 end=2026-03-21    1,189  2.3 GB
```

## LLM Providers

The CLI supports 5 LLM providers for analysis generation (`uc-bq run` with API key) and schema filtering. All provider SDKs are bundled — just set your provider and API key.

**Note:** When using the skill interactively in Claude Code, the LLM provider config does not matter. Claude Code itself is the LLM doing the thinking. The provider config only applies to headless/scheduled operations (`--analysis-api-key`, `uc-bq run` with an API key, etc.).

### Supported Providers

| Provider | SDK | API Key Env | Analysis Model | Filter Model |
|----------|-----|-------------|----------------|-------------|
| `anthropic` (default) | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-5-20250929` | `claude-haiku-4-5-20251001` |
| `openai` | `openai` | `OPENAI_API_KEY` | `gpt-4o` | `gpt-4o-mini` |
| `grok` | `openai` | `XAI_API_KEY` | `grok-2` | `grok-2` |
| `bedrock` | `@aws-sdk/client-bedrock-runtime` | AWS credential chain | `anthropic.claude-sonnet-4-5-20250929-v1:0` | `anthropic.claude-haiku-4-5-20251001-v1:0` |
| `gemini` | `@google/generative-ai` | `GOOGLE_API_KEY` | `gemini-2.0-flash` | `gemini-2.0-flash-lite` |

### Configuration

Add an `llm` section to `.ultracart-bq.json`:

```json
{
  "llm": {
    "provider": "openai",
    "api_key_env": "OPENAI_API_KEY",
    "analysis_model": "gpt-4o",
    "schema_filter_model": "gpt-4o-mini"
  }
}
```

All fields are optional. If omitted entirely, the CLI defaults to Anthropic.

### `--llm-provider` flag

Override the configured provider for a single command:

```bash
uc-bq run revenue-by-category --llm-provider=openai --analysis-api-key=$OPENAI_API_KEY
uc-bq run-all --llm-provider=gemini --deliver
```

This is a global flag available on all commands. It overrides the `llm.provider` value from your config for that invocation only.

### Provider Installation

All provider SDKs are bundled with the package. Just install `@ultracart/bq-skill` and all providers are available:

```bash
npm install -g @ultracart/bq-skill
```

## Report Structure

Each report is a self-contained directory, scoped by merchant. Decks live in a `decks/` directory alongside reports:

```
./reports/DEMO/
├── revenue-by-category/
│   ├── report.yaml           # Manifest — parameters, config, metadata
│   ├── query.sql             # Parameterized SQL template
│   ├── chart.js              # Battle-hardened ECharts formatChartData() function
│   ├── chart.png             # Full visualization
│   ├── chart-dashboard.png   # 200x200 dashboard thumbnail
│   ├── report.pdf            # Combined PDF with chart + executive analysis
│   ├── analysis_prompt.md    # System prompt for analysis generation
│   ├── report.md             # Executive analysis
│   └── data.json             # Query results (optional)
├── top-products-by-revenue/
│   └── ...
└── decks/
    ├── weekly-executive.yaml # Deck definition (committed to git)
    └── weekly-executive.pdf  # Generated deck output (not committed)
```

The `report.yaml` manifest captures everything needed to replay:

```yaml
name: "Revenue by Product Category"
description: "Daily revenue trends broken down by product category"
created: 2026-03-28
last_run: 2026-03-28
prompt: "Show me revenue trends by product category for the last 90 days"

parameters:
  - name: start_date
    type: date
    label: "Start Date"
    required: true
    default: "-90d"
  - name: end_date
    type: date
    label: "End Date"
    required: true
    default: "today"

delivery:                                # Optional: auto-deliver on --deliver
  slack:
    channels: ["C0123456789", "C9876543210"]
  email:
    to: ["ceo@example.com", "marketing@example.com"]
    subject: "Weekly: Revenue by Product Category"
    provider: "sendgrid"

config:
  merchant_id: "DEMO"
  project_id: "ultracart-dw-DEMO"
  taxonomy_level: "medium"
  dataset: "ultracart_dw"
  tables_used: ["uc_orders"]

sql_file: "query.sql"
chart:
  type: "stacked-area"
  echarts_file: "chart.js"
  output_format: "png"
  width: 1200
  height: 600

analysis:
  landscape: true              # Optional: generate PDF in landscape orientation
```

## Report Delivery

Reports can be automatically delivered to Slack channels and email recipients after generation. Add a `delivery` section to any report's `report.yaml`:

```yaml
delivery:
  slack:
    channels: ["C0123456789", "C9876543210"]
  email:
    to: ["ceo@example.com", "marketing@example.com"]
    subject: "Weekly: Revenue by Payment Method"
    provider: "sendgrid"
```

Then use `--deliver` on `run` or `run-all`:

```bash
uc-bq run revenue-by-category --deliver
uc-bq run-all --deliver --no-analysis
```

Supported email providers: SendGrid, Postmark, Mailgun, Resend, AWS SES. All via REST APIs, no SMTP, no extra npm dependencies (except optional `@aws-sdk/client-sesv2` for SES). Slack delivery uses the Slack API with a bot token.

Delivery failures are logged but never crash the run. If Slack is down or an email bounces, the report still generates successfully.

See [docs/REPORT-DELIVERY.md](docs/REPORT-DELIVERY.md) for full setup instructions, provider configuration, environment variables, and multi-client delivery patterns.

## Report Decks

Decks combine multiple reports into a single PDF with a branded cover page, clickable table of contents, and all charts + analyses in one document. Instead of sending N separate files, deliver one polished deck.

### Deck definition

Create a deck YAML file in `reports/{merchant_id}/decks/`:

```yaml
# reports/DEMO/decks/weekly-executive.yaml
name: "Weekly Executive Briefing"
title: "DEMO Weekly Report Deck"
cover:
  company: "DEMO Commerce Inc."
  logo_url: "https://example.com/logo.png"
parameters:                              # Optional: override defaults for all reports
  start_date: "start_of_year"
  end_date: "today"
reports:
  - revenue-by-payment-method
  - ltv-by-monthly-cohort
  - top-products-by-revenue
landscape: true
delivery:
  slack:
    channels: ["C0123456789"]
  email:
    to: ["ceo@example.com", "cfo@example.com"]
    subject: "Weekly Executive Briefing"
    provider: "sendgrid"
```

Deck parameters flow down to all reports as overrides. Priority: CLI flags > deck parameters > report defaults.

### Deck CLI commands

```bash
uc-bq deck run weekly-executive              # Run all reports and generate combined PDF
uc-bq deck run weekly-executive --deliver    # Run and deliver the deck PDF
uc-bq deck list                              # List defined decks
uc-bq deck create weekly-executive           # Interactive deck creation
```

Decks don't replace individual report delivery -- they're an additional option. Each report is still independently runnable via `uc-bq run`. When `--deliver` is used on a deck, ONE combined PDF is sent instead of N individual files.

See [docs/DECKS.md](docs/DECKS.md) for full deck documentation including cover page customization, multi-client patterns, and GitHub Actions integration.

## Scheduling Reports

Since `uc-bq run` is pure Node.js with no LLM dependency, you can schedule it with cron or CI/CD. If you want AI-generated analysis on scheduled runs, set the appropriate API key for your configured LLM provider:

```bash
# Crontab: refresh all reports every Monday at 6am (no analysis)
0 6 * * 1 cd /path/to/project && uc-bq run-all --no-analysis --start_date=-7d --end_date=today

# With analysis using your configured provider (set the matching API key)
0 6 * * 1 cd /path/to/project && ANTHROPIC_API_KEY=sk-... uc-bq run-all
0 6 * * 1 cd /path/to/project && OPENAI_API_KEY=sk-... uc-bq run-all --llm-provider=openai
```

```yaml
# GitHub Actions
name: Weekly Reports
on:
  schedule:
    - cron: '0 6 * * 1'
jobs:
  reports:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g @ultracart/bq-skill
      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }
      - run: uc-bq run-all --deliver --no-analysis
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
          # Set the API key matching your configured LLM provider (if using analysis):
          # ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          # XAI_API_KEY: ${{ secrets.XAI_API_KEY }}
          # GOOGLE_API_KEY: ${{ secrets.GOOGLE_API_KEY }}
      - uses: actions/upload-artifact@v4
        with: { name: reports, path: './reports/**/chart.png' }
```

## Cost Protection

Every query execution (`query`, `run`, `run-all`) automatically runs a BigQuery dry-run first to check the estimated bytes processed. If the estimate exceeds the safety limit, the query is aborted before it runs.

**Default limit: 10 GB** (~$0.06 at BigQuery on-demand pricing of $6.25/TB).

Example error:

```
Error: Query would process 45.2 GB (estimated cost: $0.2825), which exceeds the
safety limit of 10.0 GB. Use --force to execute anyway, or set a higher limit
with --max-bytes.
```

### Overriding the limit

| Method | Scope | Example |
|---|---|---|
| `--force` flag | Single command | `uc-bq query --file=q.sql --force` |
| `--max-bytes` flag | Single command | `uc-bq query --file=q.sql --max-bytes=53687091200` (50 GB) |
| `max_query_bytes` in config | All commands | Set in `.ultracart-bq.json` (bytes). Set to `0` to disable the check entirely. |

The `--force` and `--max-bytes` flags are available on `query`, `run`, and `run-all`.

## Taxonomy Levels

UltraCart controls data access via taxonomy levels assigned by your account administrator:

| Level | Access |
|---|---|
| `standard` | No PII — order totals, item data, analytics |
| `low` | Minimal PII |
| `medium` | Includes email, addresses, customer details |
| `high` | Full access to all fields |

Your taxonomy level determines which BigQuery datasets and columns are available. The CLI and skill automatically respect these boundaries.

## Available Datasets

| Dataset | Description | Access |
|---|---|---|
| `ultracart_dw` | Standard tables — no PII | All users |
| `ultracart_dw_medium` | Includes PII fields | Medium/High taxonomy |
| `ultracart_dw_streaming` | Analytics sessions, screen recordings | All users |
| `ultracart_dw_linked` | Parent/child aggregated data | Parent accounts only |

## External Projects

Merchants can register external GCP projects (e.g., marketing data from Funnel.io, DBT warehouses) alongside their UltraCart data. You explicitly choose which datasets and tables to expose.

### Browsing before registering

Use `uc-bq schema --project` to explore an external project before adding it to your config:

```bash
uc-bq schema --project=my-marketing-warehouse                                        # list datasets
uc-bq schema --project=my-marketing-warehouse --dataset=google_ads_data --list   # list tables
uc-bq schema --project=my-marketing-warehouse --dataset=google_ads_data --tables=funnel_data  # get schema
```

### Registering an external project

Use the `config` commands to add the project, datasets, and tables:

```bash
uc-bq config add-project marketing --project-id=my-marketing-warehouse --description="Marketing data from Funnel.io"
uc-bq config add-dataset marketing google_ads_data
uc-bq config add-tables marketing google_ads_data funnel_data
```

Or add it directly in `.ultracart-bq.json`:

```json
{
  "default_merchant": "DEMO",
  "merchants": {
    "DEMO": {
      "taxonomy_level": "medium",
      "dataset": "ultracart_dw",
      "external_projects": {
        "marketing": {
          "project_id": "my-marketing-warehouse",
          "description": "Marketing data from Funnel.io",
          "datasets": {
            "google_ads_data": ["funnel_data"]
          }
        }
      }
    }
  }
}
```

Once registered, external tables appear alongside UltraCart tables in `uc-bq schema --list` and are available for queries and reports.

### Schema caching

External table schemas are cached on-demand at `.ultracart-bq-cache/` to avoid repeated BigQuery metadata lookups. To refresh the cache:

```bash
uc-bq schema --refresh
```

## Relative Date Expressions

Report parameters support relative date expressions that resolve at replay time:

| Expression | Meaning |
|---|---|
| `today` | Current date |
| `yesterday` | Previous day |
| `-Nd` | N days ago (e.g., `-90d`) |
| `-Nw` | N weeks ago |
| `-Nm` | N months ago |
| `-Ny` | N years ago |
| `start_of_week` | Monday of the current week |
| `start_of_last_month` | First day of previous month |
| `start_of_last_quarter` | First day of previous quarter |
| `start_of_last_year` | January 1 of previous year |
| `end_of_last_month` | Last day of previous month |
| `end_of_last_quarter` | Last day of previous quarter |
| `end_of_last_year` | December 31 of previous year |

## Development

```bash
git clone https://github.com/UltraCart/bq-skill.git
cd bq-skill
npm install
npm run build        # Compile TypeScript
npm run dev          # Watch mode
node dist/cli.js     # Run locally
```

## License

MIT
