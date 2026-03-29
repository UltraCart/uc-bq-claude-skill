# Report Decks

Decks combine multiple reports into a single PDF with a branded cover page, clickable table of contents, and all charts + analyses in one document. Instead of delivering 10 separate files to Slack and email, send one polished deck.

---

## Why Decks

Individual reports are great for focused analysis, but stakeholders often want a single document that covers everything. A weekly executive briefing shouldn't arrive as 5 separate emails with 5 separate PDFs. Decks solve this by bundling reports into one deliverable.

- **One file, not N files** -- Slack channels and email inboxes stay clean
- **Branded cover page** -- company name, logo, title, date range
- **Clickable table of contents** -- jump to any report in the deck
- **Each report on its own page** -- chart + executive analysis, consistently formatted
- **Independent from individual reports** -- decks don't replace per-report delivery, they're an additional option

---

## Directory Structure

Deck definitions live in a `decks/` directory alongside individual reports:

```
reports/DEMO/
├── revenue-by-payment-method/
│   ├── report.yaml
│   ├── query.sql
│   ├── chart.js
│   └── ...
├── ltv-by-monthly-cohort/
│   └── ...
├── top-products-by-revenue/
│   └── ...
└── decks/
    ├── weekly-executive.yaml       # Deck definition
    └── weekly-executive.pdf        # Generated deck output
```

Each merchant has their own `decks/` directory under `reports/{merchant_id}/decks/`.

---

## Deck YAML Format

A deck definition is a YAML file in `reports/{merchant_id}/decks/`:

```yaml
name: "Weekly Executive Briefing"
title: "DEMO Weekly Report Deck"
cover:
  company: "DEMO Commerce Inc."
  logo_url: "https://example.com/logo.png"
parameters:
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

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable deck name |
| `title` | Yes | Title displayed on the cover page |
| `cover.company` | No | Company name on the cover page |
| `cover.logo_url` | No | URL to a logo image for the cover page |
| `parameters` | No | Parameter overrides applied to all reports in the deck (see [Parameters](#parameters)) |
| `reports` | Yes | Ordered list of report names to include (must exist in `reports/{merchant_id}/`) |
| `landscape` | No | `true` for landscape orientation (default: portrait) |
| `delivery` | No | Delivery config (same format as individual report delivery) |

### Cover Page Customization

The cover page renders:
1. Company logo (from `cover.logo_url`, if provided)
2. Company name (from `cover.company`, if provided)
3. Deck title (from `title`)
4. Date range (resolved from the report parameters at runtime)

If `cover` is omitted entirely, the cover page shows only the title and date range.

---

## Parameters

Decks support an optional `parameters` section that sets parameter overrides for all reports in the deck. This is useful when every report in a deck should share the same date range or other settings.

### YAML definition

```yaml
parameters:
  start_date: "start_of_year"
  end_date: "today"
```

Parameters use the same relative date expressions as report defaults (`today`, `-90d`, `start_of_year`, etc.). They resolve at runtime.

### Priority chain

When a deck runs, parameters are resolved in this order (highest priority first):

1. **CLI flags** -- `uc-bq deck run weekly-executive --start_date=2026-01-01`
2. **Deck parameters** -- the `parameters` section in the deck YAML
3. **Report defaults** -- each report's own parameter defaults from its `report.yaml`

CLI flags always win. Deck parameters override report defaults but are overridden by CLI flags. If a parameter is not set at any level and is required, the user is prompted.

### CLI overrides on `deck run`

Pass parameters directly on the command line to override both deck and report defaults:

```bash
uc-bq deck run weekly-executive --start_date=2026-01-01 --end_date=2026-03-31
```

### Managing deck parameters

Use the `config` commands to manage deck parameters without editing YAML by hand:

```bash
# Set a parameter override on a deck
uc-bq config set-deck-param weekly-executive start_date start_of_year

# Remove a parameter override
uc-bq config remove-deck-param weekly-executive start_date

# Show all parameter overrides for a deck
uc-bq config show-deck-params weekly-executive
```

### Managing report parameter defaults

You can also manage individual report parameter defaults via the CLI:

```bash
# Set a default parameter on a report
uc-bq config set-param revenue-by-category start_date -90d

# Remove a default parameter
uc-bq config remove-param revenue-by-category start_date

# Show parameter defaults for a report
uc-bq config show-params revenue-by-category
```

---

## CLI Commands

### `uc-bq deck run <deck-name>`

Run all reports in the deck and generate a combined PDF.

```bash
# Generate the deck PDF
uc-bq deck run weekly-executive

# Generate and deliver the deck
uc-bq deck run weekly-executive --deliver

# Skip analysis generation for faster runs
uc-bq deck run weekly-executive --no-analysis

# Override date parameters for all reports in the deck
uc-bq deck run weekly-executive --start_date=2026-01-01 --end_date=2026-03-28

# Run for a specific merchant
uc-bq deck run weekly-executive -m DEMO2
```

When `--deliver` is used, the deck PDF is sent as ONE file to the configured Slack channels and email recipients. Individual report PDFs are NOT delivered separately -- the deck replaces them.

### `uc-bq deck list`

List all defined decks for the current merchant.

```bash
uc-bq deck list

# Output:
#   Deck                       Reports  Last Run
#   Weekly Executive Briefing  3        2026-03-28
#   Monthly Deep Dive          7        2026-03-01
```

### `uc-bq deck create <deck-name>`

Interactive deck creation. Prompts for title, cover details, and which reports to include.

```bash
uc-bq deck create weekly-executive

# Create with inline options including parameters
uc-bq deck create weekly --title="Weekly" --reports=rev,ltv --params="start_date=start_of_year,end_date=today"
```

---

## Deck Output

The generated deck PDF includes:

1. **Cover page** -- company name, logo, title, date range
2. **Clickable table of contents** -- links to each report section
3. **Each report on its own page** -- chart image + executive analysis text

Output file location: `reports/{merchant_id}/decks/{deck-name}.pdf`

```
reports/DEMO/decks/
├── weekly-executive.yaml       # Definition (committed to git)
└── weekly-executive.pdf        # Generated output (not committed)
```

---

## Delivery

Deck delivery works the same as individual report delivery but sends ONE file instead of N files. The `delivery` section in the deck YAML uses the same format as report manifests:

```yaml
delivery:
  slack:
    channels: ["C0123456789"]
  email:
    to: ["ceo@example.com", "cfo@example.com"]
    subject: "Weekly Executive Briefing"
    provider: "sendgrid"
```

Environment variables are the same as for individual report delivery:
- `SLACK_BOT_TOKEN` for Slack
- `EMAIL_FROM` + provider API key for email

See [REPORT-DELIVERY.md](REPORT-DELIVERY.md) for full provider setup.

### Deck delivery vs report delivery

Decks and individual reports have independent delivery configs. You can:
- Deliver individual reports to one set of channels/recipients
- Deliver the deck to a different set (e.g., the executive team)
- Use both -- some stakeholders get the full deck, others get specific reports

---

## GitHub Actions Integration

Add deck runs to your CI workflows alongside or instead of `run-all`:

```yaml
name: Weekly Executive Deck

on:
  schedule:
    - cron: '0 11 * * 1'  # Monday 6am ET
  workflow_dispatch:

jobs:
  generate-deck:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g @ultracart/bq-skill

      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }

      - name: Generate and deliver executive deck
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq deck run weekly-executive --deliver --no-analysis

      - uses: actions/upload-artifact@v4
        with:
          name: executive-deck-${{ github.run_number }}
          path: reports/DEMO/decks/weekly-executive.pdf
          retention-days: 30
```

### Combining deck runs with individual report runs

You can run both in the same workflow -- generate individual reports first, then build the deck:

```yaml
      - name: Run all reports
        run: uc-bq run-all --no-analysis

      - name: Generate and deliver deck
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq deck run weekly-executive --deliver --no-analysis
```

---

## Multi-Client Deck Patterns

Each client can have their own decks with their own reports and delivery targets:

```
reports/
├── CLNT1/
│   ├── revenue-by-channel/
│   ├── customer-ltv/
│   ├── product-performance/
│   └── decks/
│       └── weekly-summary.yaml       # CLNT1's deck -> their Slack + email
├── CLNT2/
│   ├── revenue-by-channel/
│   ├── subscription-churn/
│   └── decks/
│       └── weekly-summary.yaml       # CLNT2's deck -> their Slack + email
```

Each deck YAML has its own `delivery` section targeting that client's channels and recipients. In a GitHub Actions matrix workflow:

```yaml
    steps:
      - name: Generate and deliver deck for ${{ matrix.client.name }}
        env:
          SLACK_BOT_TOKEN: ${{ secrets[format('SLACK_TOKEN_{0}', matrix.client.id)] }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq deck run weekly-summary --merchant=${{ matrix.client.id }} --deliver --no-analysis
```

---

## Example: Building a Deck

Suppose you have three reports already created:

```bash
uc-bq list

# Reports for merchant: DEMO
#
# Name                          Last Run    Description
# Revenue by Payment Method     2026-03-28  Weekly revenue by payment type
# LTV by Monthly Cohort         2026-03-28  Customer lifetime value by acquisition month
# Top Products by Revenue       2026-03-28  Highest-revenue products
```

Create a deck that combines them:

```bash
uc-bq deck create weekly-executive
```

Or write the YAML directly:

```yaml
# reports/DEMO/decks/weekly-executive.yaml
name: "Weekly Executive Briefing"
title: "DEMO Weekly Report Deck"
cover:
  company: "DEMO Commerce Inc."
  logo_url: "https://example.com/logo.png"
parameters:
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

Generate the deck:

```bash
uc-bq deck run weekly-executive

# Running deck: Weekly Executive Briefing
# ──────────────────────────────────────────────────
# [1/3] Revenue by Payment Method ... OK
# [2/3] LTV by Monthly Cohort ....... OK
# [3/3] Top Products by Revenue ..... OK
#
# Generating deck PDF...
# Deck: reports/DEMO/decks/weekly-executive.pdf
#
# Done.
```

Generate and deliver:

```bash
uc-bq deck run weekly-executive --deliver

# Running deck: Weekly Executive Briefing
# ──────────────────────────────────────────────────
# [1/3] Revenue by Payment Method ... OK
# [2/3] LTV by Monthly Cohort ....... OK
# [3/3] Top Products by Revenue ..... OK
#
# Generating deck PDF...
# Deck: reports/DEMO/decks/weekly-executive.pdf
# Delivering to Slack... OK
# Delivering via email (sendgrid)... OK (2 recipients)
#
# Done.
```

---

## .gitignore

Deck definitions (YAML) should be committed. Generated deck PDFs should not:

```
# In .gitignore
reports/**/decks/*.pdf
```
