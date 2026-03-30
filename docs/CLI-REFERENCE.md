# CLI Reference

Complete reference for the `uc-bq` command-line tool.

---

## Global Options

These flags are available on all commands.

| Flag | Description |
|------|-------------|
| `-m, --merchant <id>` | Target a specific merchant (overrides `default_merchant` in config) |
| `--llm-provider <provider>` | LLM provider override: `anthropic`, `openai`, `grok`, `bedrock`, `gemini` |

---

## uc-bq init

Interactive setup. Creates `.ultracart-bq.json` and tests BigQuery connectivity.

```bash
uc-bq init
```

No arguments or options.

---

## uc-bq schema

Explore your BigQuery schema — UltraCart tables and external projects.

| Option | Description |
|--------|-------------|
| `--list` | List all available tables/views at your taxonomy level |
| `--tables <tables>` | Comma-separated table names to get schema for |
| `--filter <query>` | Filter columns by keyword (or by LLM if `--api-key` provided) |
| `--api-key <key>` | API key for LLM-powered schema filtering |
| `--format <format>` | Output format: `text` (default) or `json` |
| `--dataset <dataset>` | Dataset to query |
| `--project <project>` | Browse any GCP project (for exploration before registering) |
| `--refresh` | Clear and re-fetch all cached external table schemas |
| `--live` | Force fetching schema from BigQuery (bypass enhanced schemas) |

**Examples:**

```bash
# List all tables
uc-bq schema --list

# Get schema for specific tables
uc-bq schema --tables=uc_orders,uc_items

# Filter columns by keyword
uc-bq schema --tables=uc_orders --filter="revenue,date,category"

# Output as JSON
uc-bq schema --tables=uc_orders --format=json

# Browse an external GCP project before registering
uc-bq schema --project=my-marketing-warehouse
uc-bq schema --project=my-marketing-warehouse --dataset=google_ads --list
uc-bq schema --project=my-marketing-warehouse --dataset=google_ads --tables=campaigns

# Refresh cached external schemas
uc-bq schema --refresh
```

---

## uc-bq query

Execute SQL against BigQuery.

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to SQL file |
| `--sql <sql>` | Inline SQL string |
| `--params <json>` | JSON string of parameter values |
| `--sample <rows>` | Max rows to display (default: `20`) |
| `--output <path>` | Save full results to JSON file |
| `--force` | Skip cost safety check |
| `--max-bytes <bytes>` | Override cost limit in bytes (default: 10 GB) |

Provide either `--file` or `--sql`, not both.

**Examples:**

```bash
# Execute from a file with parameters
uc-bq query --file=query.sql --params='{"start_date":"2026-01-01","end_date":"2026-03-28"}'

# Execute inline SQL
uc-bq query --sql="SELECT COUNT(*) as cnt FROM \`ultracart-dw-demo.ultracart_dw.uc_orders\`"

# Save results to JSON
uc-bq query --file=query.sql --params='...' --output=data.json

# Show more rows
uc-bq query --file=query.sql --params='...' --sample=50

# Skip cost check
uc-bq query --file=query.sql --params='...' --force
```

---

## uc-bq dry-run

Estimate query cost without executing.

| Option | Description |
|--------|-------------|
| `--file <path>` | Path to SQL file |
| `--sql <sql>` | Inline SQL string |
| `--params <json>` | JSON string of parameter values |

**Example:**

```bash
uc-bq dry-run --file=query.sql --params='{"start_date":"2026-01-01","end_date":"2026-03-28"}'

# Output:
#   Estimated bytes processed: 2.4 GB
#   Estimated cost: $0.015
```

---

## uc-bq validate

Validate configuration or report manifests against JSON Schema.

| Option | Description |
|--------|-------------|
| `--config` | Validate `.ultracart-bq.json` |
| `--manifest <path>` | Validate a `report.yaml` manifest file |

**Examples:**

```bash
uc-bq validate --config
uc-bq validate --manifest=./reports/DEMO/revenue-by-category/report.yaml
```

---

## uc-bq render

Render an ECharts chart to PNG or PDF via headless browser.

| Option | Description |
|--------|-------------|
| `--chart <path>` | Path to ECharts `chart.js` file (required) |
| `--data <path>` | Path to `data.json` file (required) |
| `--output <path>` | Output file path (required unless `--preview`) |
| `--width <pixels>` | Chart width (default: `1200`) |
| `--height <pixels>` | Chart height (default: `600`) |
| `--format <format>` | Output format: `png` (default) or `pdf` |
| `--dashboard` | Render in dashboard thumbnail mode (200x200) |
| `--preview` | Open in browser instead of headless rendering |

**Examples:**

```bash
# Render to PNG
uc-bq render --chart=chart.js --data=data.json --output=chart.png

# Render to PDF
uc-bq render --chart=chart.js --data=data.json --output=chart.pdf --format=pdf

# Dashboard thumbnail
uc-bq render --chart=chart.js --data=data.json --output=thumb.png --dashboard

# Custom dimensions
uc-bq render --chart=chart.js --data=data.json --output=chart.png --width=1600 --height=900

# Preview in browser (no file output)
uc-bq render --chart=chart.js --data=data.json --preview
```

---

## uc-bq run

Replay a saved report with fresh data.

**Argument:** `<report-name>` — report directory name under `./reports/{merchant}/`

| Option | Description |
|--------|-------------|
| `--no-analysis` | Skip analysis generation |
| `--analysis-api-key <key>` | API key for headless analysis generation |
| `--analysis-model <model>` | Model for analysis (default: `claude-sonnet-4-5-20250929`) |
| `--deliver` | Deliver report via Slack/email as configured in manifest |
| `--no-deliver` | Skip delivery even if configured |
| `--skip-alarms` | Skip alarm evaluation |
| `--landscape` | Generate PDF in landscape orientation |
| `--force` | Skip cost safety check |
| `--max-bytes <bytes>` | Override cost limit in bytes (default: 10 GB) |

Parameter overrides are passed as extra flags: `--param_name=value`

**Examples:**

```bash
# Run with default parameters
uc-bq run revenue-by-category

# Override date range
uc-bq run revenue-by-category --start_date=2026-01-01 --end_date=2026-03-31

# Skip analysis, deliver to Slack/email
uc-bq run revenue-by-category --deliver --no-analysis

# Landscape PDF
uc-bq run revenue-by-category --landscape

# Headless analysis with specific model
uc-bq run revenue-by-category --analysis-api-key=$ANTHROPIC_API_KEY --analysis-model=claude-haiku-4-5-20251001

# Use a different LLM provider for analysis
uc-bq run revenue-by-category --llm-provider=openai --analysis-api-key=$OPENAI_API_KEY
```

---

## uc-bq run-all

Replay all saved reports for the current merchant.

| Option | Description |
|--------|-------------|
| `--no-analysis` | Skip analysis generation |
| `--analysis-api-key <key>` | API key for headless analysis generation |
| `--analysis-model <model>` | Model for analysis (default: `claude-sonnet-4-5-20250929`) |
| `--deliver` | Deliver reports via Slack/email as configured |
| `--no-deliver` | Skip delivery even if configured |
| `--skip-alarms` | Skip alarm evaluation |
| `--landscape` | Generate PDFs in landscape orientation |
| `--force` | Skip cost safety check |
| `--max-bytes <bytes>` | Override cost limit in bytes (default: 10 GB) |

Parameter overrides are passed as extra flags: `--param_name=value`

**Examples:**

```bash
# Run all with shared date range
uc-bq run-all --start_date=2026-01-01 --end_date=2026-03-31

# Run all, deliver, skip analysis
uc-bq run-all --deliver --no-analysis

# Run all for a specific merchant
uc-bq run-all -m DEMO2
```

---

## uc-bq list

List all saved reports with status and parameters.

```bash
uc-bq list

# Output:
#   Name                          Last Run      Status  Parameters
#   Revenue by Product Category   2026-03-28    OK      2 req, 2 opt
#   Customer Cohort Analysis      2026-03-25    OK      3 req, 0 opt
```

No arguments or options.

---

## uc-bq history

Show run history for a report.

**Argument:** `<report-name>` — report directory name

```bash
uc-bq history revenue-by-category

# Output:
#   Run Date     Parameters                         Rows   Bytes
#   2026-03-28   start=2025-12-28 end=2026-03-28    1,247  2.4 GB
#   2026-03-21   start=2025-12-21 end=2026-03-21    1,189  2.3 GB
```

---

## uc-bq config

Manage configuration — merchants, external projects, delivery, alarms, and parameters.

### config show

Display current configuration.

```bash
uc-bq config show
```

---

### config add-merchant

Add a merchant to the config.

**Argument:** `<id>` — Merchant ID

| Option | Description |
|--------|-------------|
| `--taxonomy <level>` | Taxonomy level: `standard`, `low`, `medium`, `high` (required) |
| `--dataset <dataset>` | BigQuery dataset name (default: `ultracart_dw`) |

```bash
uc-bq config add-merchant DEMO2 --taxonomy=standard
uc-bq config add-merchant DEMO3 --taxonomy=medium --dataset=ultracart_dw
```

### config remove-merchant

Remove a merchant from the config.

**Argument:** `<id>` — Merchant ID

```bash
uc-bq config remove-merchant DEMO2
```

---

### config add-project

Register an external BigQuery project.

**Argument:** `<alias>` — Short alias for the project

| Option | Description |
|--------|-------------|
| `--project-id <id>` | GCP project ID (required) |
| `--description <desc>` | Description of the project |

```bash
uc-bq config add-project marketing --project-id=my-marketing-warehouse --description="Google Ads + Meta"
```

### config remove-project

Remove an external project.

**Argument:** `<alias>` — Project alias

```bash
uc-bq config remove-project marketing
```

---

### config add-dataset

Add a dataset from an external project.

**Arguments:** `<alias>` — Project alias, `<dataset>` — Dataset name

| Option | Description |
|--------|-------------|
| `--discover` | Auto-discover and add all tables from the dataset |

```bash
uc-bq config add-dataset marketing google_ads_data --discover
uc-bq config add-dataset marketing meta_ads_data
```

### config remove-dataset

Remove a dataset from an external project.

**Arguments:** `<alias>` — Project alias, `<dataset>` — Dataset name

```bash
uc-bq config remove-dataset marketing meta_ads_data
```

---

### config add-tables

Expose specific tables in an external dataset.

**Arguments:** `<alias>` — Project alias, `<dataset>` — Dataset name, `<tables...>` — Table names

```bash
uc-bq config add-tables marketing meta_ads_data campaigns ad_sets ads
```

### config remove-tables

Remove specific tables from an external dataset.

**Arguments:** `<alias>` — Project alias, `<dataset>` — Dataset name, `<tables...>` — Table names

```bash
uc-bq config remove-tables marketing meta_ads_data ads
```

---

### config add-slack

Add Slack channel(s) to a report's delivery config.

**Arguments:** `<report>` — Report name, `<channels...>` — Slack channel IDs

```bash
uc-bq config add-slack revenue-by-category C0123456789
uc-bq config add-slack revenue-by-category C0123456789 C9876543210
```

### config remove-slack

Remove Slack channel(s) from a report's delivery config.

**Arguments:** `<report>` — Report name, `<channels...>` — Slack channel IDs

```bash
uc-bq config remove-slack revenue-by-category C9876543210
```

---

### config set-email

Set full email delivery config for a report.

**Argument:** `<report>` — Report name

| Option | Description |
|--------|-------------|
| `--to <emails>` | Comma-separated recipient email addresses |
| `--provider <provider>` | Email provider: `sendgrid`, `postmark`, `mailgun`, `resend`, `ses` |
| `--subject <subject>` | Email subject line |

```bash
uc-bq config set-email revenue-by-category \
  --to=ceo@example.com,marketing@example.com \
  --provider=sendgrid \
  --subject="Weekly: Revenue by Category"
```

### config add-email

Add email recipient(s) to a report.

**Arguments:** `<report>` — Report name, `<emails...>` — Email addresses

```bash
uc-bq config add-email revenue-by-category analyst@example.com
```

### config remove-email

Remove email recipient(s) from a report.

**Arguments:** `<report>` — Report name, `<emails...>` — Email addresses

```bash
uc-bq config remove-email revenue-by-category analyst@example.com
```

### config set-email-provider

Update the email provider for a report.

**Arguments:** `<report>` — Report name, `<provider>` — Provider name

```bash
uc-bq config set-email-provider revenue-by-category postmark
```

### config set-email-subject

Update the email subject for a report.

**Arguments:** `<report>` — Report name, `<subject>` — Subject line

```bash
uc-bq config set-email-subject revenue-by-category "Monthly: Revenue by Category"
```

### config show-delivery

Display the delivery configuration for a report.

**Argument:** `<report>` — Report name

```bash
uc-bq config show-delivery revenue-by-category
```

---

### config add-alarm

Add an alarm to a report.

**Argument:** `<report>` — Report name

| Option | Description |
|--------|-------------|
| `--name <name>` | Alarm name (required) |
| `--type <type>` | Alarm type: `threshold`, `pct_change`, `missing_data` (required) |
| `--metric <metric>` | Column name in data.json to evaluate |
| `--aggregate <agg>` | Aggregation: `sum`, `avg`, `min`, `max`, `first`, `last` (default: `sum`) |
| `--operator <op>` | Comparison operator: `<`, `>`, `<=`, `>=`, `==`, `!=` |
| `--value <value>` | Threshold value or percent |
| `--severity <sev>` | Severity: `low`, `high`, `critical` (default: `high`) |
| `--cooldown <dur>` | Cooldown duration, e.g. `24h`, `7d`, `1h` (default: `24h`) |

```bash
uc-bq config add-alarm revenue-by-category \
  --name "Revenue Drop" \
  --type pct_change \
  --metric total_revenue \
  --aggregate sum \
  --operator "<" \
  --value -20 \
  --severity high \
  --cooldown 24h
```

### config show-alarms

Display all alarms on a report.

**Argument:** `<report>` — Report name

```bash
uc-bq config show-alarms revenue-by-category
```

### config remove-alarm

Remove an alarm from a report.

**Arguments:** `<report>` — Report name, `<alarm-name>` — Alarm name

```bash
uc-bq config remove-alarm revenue-by-category "Revenue Drop"
```

---

### config set-delivery-mode

Set delivery mode for a report.

**Arguments:** `<report>` — Report name, `<mode>` — `always` or `alarm_only`

```bash
uc-bq config set-delivery-mode revenue-by-category alarm_only
```

### config set-mention-on-alarm

Set the Slack mention for critical alarms.

**Arguments:** `<report>` — Report name, `<mention>` — Slack mention (e.g. `@channel`, `@here`)

```bash
uc-bq config set-mention-on-alarm revenue-by-category "@channel"
```

### config set-deck-delivery-mode

Set delivery mode for a deck.

**Arguments:** `<deck>` — Deck name, `<mode>` — `always` or `alarm_only`

```bash
uc-bq config set-deck-delivery-mode weekly-executive alarm_only
```

---

### config set-param

Set the default value for a report parameter.

**Arguments:** `<report>` — Report name, `<param>` — Parameter name, `<value>` — Default value

```bash
uc-bq config set-param revenue-by-category start_date -90d
uc-bq config set-param revenue-by-category end_date today
```

### config remove-param

Remove the default value for a report parameter.

**Arguments:** `<report>` — Report name, `<param>` — Parameter name

```bash
uc-bq config remove-param revenue-by-category start_date
```

### config show-params

Display all parameters and their defaults for a report.

**Argument:** `<report>` — Report name

```bash
uc-bq config show-params revenue-by-category
```

---

### config set-deck-param

Set a parameter override on a deck.

**Arguments:** `<deck>` — Deck name, `<param>` — Parameter name, `<value>` — Value

```bash
uc-bq config set-deck-param weekly-executive start_date start_of_year
```

### config remove-deck-param

Remove a parameter override from a deck.

**Arguments:** `<deck>` — Deck name, `<param>` — Parameter name

```bash
uc-bq config remove-deck-param weekly-executive start_date
```

### config show-deck-params

Display all parameter overrides for a deck.

**Argument:** `<deck>` — Deck name

```bash
uc-bq config show-deck-params weekly-executive
```

---

## uc-bq deck

Manage and generate report decks.

### deck run

Run all reports in a deck and generate a combined PDF.

**Argument:** `<deck-name>` — Deck definition name (without `.yaml`)

| Option | Description |
|--------|-------------|
| `--deliver` | Deliver the deck PDF via Slack/email |
| `--no-analysis` | Skip analysis generation for contained reports |
| `--landscape` | Generate PDF in landscape orientation |
| `--force` | Skip cost safety check |
| `--analysis-api-key <key>` | API key for headless analysis generation |
| `--analysis-model <model>` | Model for analysis (default: `claude-sonnet-4-5-20250929`) |
| `--max-bytes <bytes>` | Override cost limit in bytes (default: 10 GB) |
| `--skip-alarms` | Skip alarm evaluation |

Parameter overrides are passed as extra flags: `--param_name=value`

```bash
uc-bq deck run weekly-executive
uc-bq deck run weekly-executive --deliver --no-analysis
uc-bq deck run weekly-executive --start_date=2026-01-01 --end_date=2026-03-31
uc-bq deck run weekly-executive --llm-provider=openai --analysis-api-key=$OPENAI_API_KEY
```

### deck dashboard

Generate an interactive HTML dashboard from a deck.

**Argument:** `<deck-name>` — Deck definition name (without `.yaml`)

| Option | Description |
|--------|-------------|
| `--open` | Open the dashboard in the default browser |

```bash
uc-bq deck dashboard weekly-executive
uc-bq deck dashboard weekly-executive --open
```

### deck list

List all defined decks.

```bash
uc-bq deck list
```

### deck create

Create a new deck definition interactively, or with inline options.

**Argument:** `<deck-name>` — Name for the deck file (without `.yaml`)

| Option | Description |
|--------|-------------|
| `--title <title>` | Deck title |
| `--reports <reports>` | Comma-separated report directory names |
| `--company <company>` | Company name for cover page |
| `--logo-url <url>` | Logo URL for cover page |
| `--landscape` | Generate deck in landscape orientation |
| `--params <params>` | Comma-separated `param=value` pairs |

```bash
# Interactive
uc-bq deck create weekly-executive

# Inline
uc-bq deck create weekly-executive \
  --title="Weekly Executive Briefing" \
  --reports=revenue-by-category,top-products,customer-ltv \
  --company="DEMO Commerce Inc." \
  --logo-url="https://example.com/logo.png" \
  --landscape \
  --params="start_date=start_of_year,end_date=today"
```

---

## uc-bq alarm

Test and inspect report alarms.

### alarm test

Evaluate alarms against current `data.json` without running the query or triggering delivery. Useful for testing alarm definitions before deploying.

**Argument:** `<report-name>` — Report directory name

```bash
uc-bq alarm test revenue-by-category
```

### alarm history

Show alarm history from `alarm_state.json`.

**Argument:** `<report-name>` — Report directory name

```bash
uc-bq alarm history revenue-by-category
```

---

## Relative Date Expressions

Report parameters support relative date expressions that resolve at runtime:

| Expression | Meaning |
|---|---|
| `today` | Current date |
| `yesterday` | Previous day |
| `-Nd` | N days ago (e.g., `-90d`) |
| `-Nw` | N weeks ago |
| `-Nm` | N months ago |
| `-Ny` | N years ago |
| `start_of_week` | Monday of the current week |
| `start_of_month` | First day of the current month |
| `start_of_quarter` | First day of the current quarter |
| `start_of_year` | January 1 of the current year |
| `start_of_last_month` | First day of previous month |
| `start_of_last_quarter` | First day of previous quarter |
| `start_of_last_year` | January 1 of previous year |
| `end_of_last_month` | Last day of previous month |
| `end_of_last_quarter` | Last day of previous quarter |
| `end_of_last_year` | December 31 of previous year |

---

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Analysis (Anthropic) | API key for Claude models |
| `OPENAI_API_KEY` | Analysis (OpenAI) | API key for GPT models |
| `XAI_API_KEY` | Analysis (Grok) | API key for xAI Grok models |
| `GOOGLE_API_KEY` | Analysis (Gemini) | API key for Google Gemini models |
| `GOOGLE_APPLICATION_CREDENTIALS` | BigQuery auth | Path to service account JSON (alternative to gcloud ADC) |
| `SLACK_BOT_TOKEN` | Slack delivery | Slack bot token (`xoxb-...`) |
| `EMAIL_FROM` | Email delivery | Sender email address |
| `SENDGRID_API_KEY` | Email (SendGrid) | SendGrid API key |
| `POSTMARK_SERVER_TOKEN` | Email (Postmark) | Postmark server token |
| `MAILGUN_API_KEY` | Email (Mailgun) | Mailgun API key |
| `MAILGUN_DOMAIN` | Email (Mailgun) | Mailgun sending domain |
| `RESEND_API_KEY` | Email (Resend) | Resend API key |
