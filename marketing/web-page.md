# BigQuery Reporting Skill for Claude Code

**A developer tool for building automated e-commerce reports with AI — right from your terminal.**

UltraCart already has a built-in AI reporting interface for merchants. This isn't that. This is for developers who live in Claude Code and want programmatic, version-controlled, CI/CD-native reporting against UltraCart's BigQuery data warehouse.

[Get Started](#get-started) | [View on GitHub](https://github.com/UltraCart/bq-skill)

---

## Why a Developer Tool?

UltraCart's built-in reporting UI is great for merchants who want dashboards in a browser. But if you're a developer building reporting infrastructure, integrating e-commerce analytics into existing workflows, or automating deliverables for clients — you need something that fits the way you already work.

- **CLI-native** — `uc-bq` runs in your terminal, pipes into scripts, and works in any CI/CD environment
- **Git-versioned reports** — SQL, chart configs, and manifests are plain files in your repo. Review them in PRs, diff them, roll them back
- **AI-assisted design, zero-AI replay** — Claude Code helps you build a report once — covered by your existing Claude Code subscription, no extra API charges. After that, replay is pure Node.js. No API keys, no per-run AI costs
- **Infrastructure-as-code** — report definitions are YAML manifests with parameterized SQL, not opaque dashboard configs trapped in a SaaS tool
- **Composable** — reports are building blocks. Combine them into decks, attach alarms, wire up delivery, schedule via cron or GitHub Actions

---

## How It Works

The tool is a **Claude Code skill** — a prompt that teaches Claude Code how to interact with UltraCart's BigQuery schema — paired with a **Node.js CLI** that handles execution, rendering, and delivery.

**1. Install the CLI**

```
npm install -g @ultracart/bq-skill
uc-bq install-skill
uc-bq init
```

`install-skill` copies the skill prompt to `~/.claude/skills/uc-bq/SKILL.md` so Claude Code knows how to work with UltraCart's BigQuery schema. You can inspect the file before and after — it's a markdown prompt, not executable code.

**2. Design a report in Claude Code**

Open Claude Code in your project directory. The skill is available automatically after installation. Describe what you want:

*"Build a report showing revenue by product category for the last 90 days with a stacked area chart"*

Claude Code will:
- Discover your BigQuery schema via `uc-bq schema`
- Write and test parameterized SQL via `uc-bq query`
- Create an ECharts `formatChartData()` function
- Render to PNG via `uc-bq render`
- Write an executive analysis and a reusable analysis prompt
- Save a `report.yaml` manifest with parameters, config, and metadata

The output is a self-contained report directory you can commit to git.

**3. Replay without AI**

```
uc-bq run revenue-by-category
uc-bq run revenue-by-category --start_date=2026-01-01 --end_date=2026-03-31
uc-bq run-all --deliver
```

Replay executes the saved SQL, renders the saved chart config, and generates a PDF. Zero LLM calls. Relative date expressions (`-90d`, `today`, `start_of_year`) resolve at runtime.

**4. Automate**

```
# Cron
0 6 * * 1 uc-bq run-all --deliver

# GitHub Actions
- run: uc-bq deck run weekly-executive --deliver --no-analysis
```

Reports live in a private repo. GitHub Actions runs them on a schedule with free compute. Credentials stay in GitHub Secrets. Full audit trail via git history.

---

## What You Get

### Report as Code

Each report is a directory of plain files — no databases, no proprietary formats.

```
reports/DEMO/revenue-by-category/
├── report.yaml           # Manifest — parameters, config, metadata
├── query.sql             # Parameterized SQL template
├── chart.js              # ECharts formatChartData() function
├── chart.png             # Rendered visualization
├── report.pdf            # Combined PDF (chart + analysis)
├── analysis_prompt.md    # System prompt for AI analysis
├── report.md             # Executive analysis
└── data.json             # Query results
```

Everything is diffable, reviewable, and version-controlled. The manifest captures the full lineage: what tables were queried, what parameters were used, when it last ran. Parameters support relative date expressions (`-90d`, `today`, `start_of_year`, `end_of_last_quarter`, etc.) that resolve at runtime — so a report designed with "last 90 days" always means the most recent 90 days, no matter when you replay it.

PDFs render in portrait or landscape mode (per-report or per-command with `--landscape`). Run history is tracked per report via `uc-bq history`, showing every execution with its parameters, row count, and bytes processed.

### Claude Code Skill

The skill prompt teaches Claude Code the UltraCart BigQuery schema conventions, SQL patterns, ECharts best practices, and the full CLI API. Claude Code doesn't just write SQL — it follows partition pruning strategies, handles UNNEST patterns for nested records, excludes test orders, and writes chart functions that handle both full-size and 200x200 dashboard thumbnail modes.

### Report Decks

Combine reports into a single branded PDF. Each deck is defined by a YAML file that specifies which reports to include, a branded cover page (company name, logo URL, title), and a clickable table of contents. Each report renders on its own page with chart and executive analysis.

Deck-level parameters override individual report defaults, and CLI flags override deck parameters — giving you a clean priority chain: **CLI > deck > report defaults**. Set `start_of_year` on the deck, and every report in it uses year-to-date data without editing each manifest individually.

```yaml
# reports/DEMO/decks/weekly-executive.yaml
name: "Weekly Executive Briefing"
cover:
  company: "DEMO Commerce Inc."
  logo_url: "https://example.com/logo.png"
parameters:
  start_date: "start_of_year"
  end_date: "today"
reports:
  - revenue-by-category
  - top-products-by-revenue
  - customer-ltv-by-cohort
landscape: true
```

```
uc-bq deck run weekly-executive --deliver
uc-bq deck list
uc-bq deck create weekly-executive
```

### Interactive HTML Dashboards

Generate a self-contained HTML file from any deck definition. ECharts loads from CDN with all chart data and config inlined — a single `.html` file, no backend, no build step. The layout is responsive: two-column grid on wide screens, single column on mobile. Each chart renders in a styled card with interactive tooltips, hover effects, and zoom.

Deploy to S3 (set `Content-Type: text/html`), drop it into nginx or Apache, or just open it from disk. Add `--open` to launch the browser immediately after generation.

```
uc-bq deck dashboard weekly-executive --open
```

### Automated Delivery

Wire up Slack and email delivery per-report or per-deck via the manifest. Supports SendGrid, Postmark, Mailgun, Resend, and AWS SES — all REST APIs, no SMTP, no extra dependencies. Delivery failures are logged but never crash the run.

### Smart Alarms

Define conditions on your data that trigger notifications — then stop watching. Alarms evaluate as part of the normal `uc-bq run` pipeline. If nothing fires, silence means everything is fine.

**Three alarm types:**
- **Threshold** — alert when a metric crosses a static value (e.g., revenue < $10K)
- **Percent change** — alert when a metric shifts by more than X% vs. the previous run (e.g., revenue dropped 20%)
- **Missing data** — alert when a query returns zero rows (e.g., no orders processed today)

**Severity levels** control escalation: `low` is inline in the normal delivery, `high` gets a distinct notification, `critical` triggers Slack `@channel` mentions via `mention_on_alarm`. Cooldown windows prevent repeated notifications for persistent conditions — a revenue dip doesn't ping the channel every hour.

**`alarm_only` delivery mode** is the key feature for management by exception. Set `delivery.mode: "alarm_only"` on a report and it only delivers when an alarm fires. Ten reports run every Monday — you only hear about the ones with problems.

When running decks, alarms from all reports in the deck aggregate into the deck-level notification. One summary, not N separate alerts.

```yaml
alarms:
  - name: "Revenue Drop"
    type: pct_change
    metric: "total_revenue"
    aggregate: "sum"
    operator: "<"
    value: -20
    severity: high
    cooldown: "24h"

delivery:
  mode: "alarm_only"
  slack:
    channels: ["C0123456789"]
    mention_on_alarm: "@channel"
```

### External Data Sources

Register external GCP projects alongside your UltraCart data warehouse and build cross-project reports that join e-commerce data with marketing, analytics, or any other BigQuery source.

**Browse before you commit.** Explore any GCP project's datasets and tables without registering it — useful for evaluating what's available before wiring it into your config.

```
uc-bq schema --project=my-marketing-warehouse                          # list datasets
uc-bq schema --project=my-marketing-warehouse --dataset=google_ads     # list tables
uc-bq schema --project=my-marketing-warehouse --dataset=google_ads --tables=campaigns  # get schema
```

**Selectively expose datasets and tables.** You control exactly what the tool can see. Register a project, add specific datasets, and optionally restrict to specific tables. Use `--discover` to auto-detect all tables in a dataset, or add them individually for tighter control.

```
uc-bq config add-project marketing --project-id=my-marketing-warehouse --description="Google Ads + Meta"
uc-bq config add-dataset marketing google_ads_data --discover        # expose all tables
uc-bq config add-tables marketing meta_ads_data campaigns ad_sets    # expose only these two tables
```

Once registered, external tables appear alongside UltraCart tables in `uc-bq schema --list` and are available for queries. Claude Code sees them during schema discovery, so it can write cross-project JOINs — e.g., UltraCart orders joined with Google Ads campaign spend to calculate ROAS.

External schemas are cached locally (`.ultracart-bq-cache/`) to avoid repeated BigQuery metadata lookups. Refresh with `uc-bq schema --refresh`.

### Multi-Merchant & Agency Patterns

One repo, many merchants. Target any store with `--merchant`. Agencies run all client reports from a single GitHub Actions workflow with per-client Slack and email delivery configured in each report's manifest.

### Cost Protection

Every `run`, `run-all`, and `deck run` automatically estimates query cost before executing. If the estimate exceeds your safety limit (default: 10 GB / ~$0.06), the query aborts. Override with `--force` or `--max-bytes`, or set `max_query_bytes` globally in config. No surprise BigQuery bills.

---

## How This Differs from UltraCart's Built-In Reporting

| | Built-In AI Reports | BigQuery Reporting Skill |
|---|---|---|
| **Audience** | Merchants, business users | Developers, agencies, technical teams |
| **Interface** | Web UI in UltraCart dashboard | CLI + Claude Code |
| **Reports live in** | UltraCart platform | Your git repo |
| **Customization** | Predefined report types | Unlimited — any SQL, any chart, any analysis |
| **Scheduling** | Managed by UltraCart | Your cron, GitHub Actions, or CI/CD |
| **Delivery** | UltraCart dashboard | Slack, email, S3, anywhere you script |
| **External data** | UltraCart data only | Any BigQuery project |
| **Multi-client** | Per-merchant | One repo, many merchants |

They're complementary. The built-in UI is ideal for merchants who want quick insights without leaving the dashboard. The skill is for developers who want full programmatic control, version history, and automation.

---

## LLM Provider Flexibility

Interactive design uses Claude Code. For optional AI-generated analysis on scheduled runs, the CLI supports five bundled providers — configure once, no extra installs:

| Provider | Model | API Key Env |
|----------|-------|-------------|
| Anthropic (default) | Claude Sonnet / Haiku | `ANTHROPIC_API_KEY` |
| OpenAI | GPT-4o / GPT-4o-mini | `OPENAI_API_KEY` |
| Google | Gemini 2.0 Flash | `GOOGLE_API_KEY` |
| xAI | Grok-2 | `XAI_API_KEY` |
| AWS Bedrock | Claude via Bedrock | AWS credential chain |

Or skip analysis entirely with `--no-analysis` for zero-cost replay.

---

## Get Started

1. **Install** — `npm install -g @ultracart/bq-skill`
2. **Register the skill** — `uc-bq install-skill`
3. **Authenticate** — `gcloud auth application-default login`
4. **Configure** — `uc-bq init`
5. **Open Claude Code** and describe the report you want in plain English

Your UltraCart data warehouse must be enabled. If it's not, contact your UltraCart account manager.

[Install from npm](https://www.npmjs.com/package/@ultracart/bq-skill) | [View on GitHub](https://github.com/UltraCart/bq-skill) | [Read the Tutorial](https://github.com/UltraCart/bq-skill/blob/main/TUTORIAL.md)

---

## FAQ

**How does this relate to UltraCart's built-in AI reporting?**

They're different tools for different audiences. The built-in reporting is a web UI for merchants. This is a CLI + Claude Code skill for developers who want programmatic control, git-versioned reports, and CI/CD automation. Use whichever fits your workflow — or both.

**Do I need Claude Code?**

You need Claude Code (or a compatible AI coding assistant) to *design* new reports. Once a report is designed and committed, anyone can replay it with `uc-bq run` — no AI tooling required. Scheduled and CI/CD runs are pure Node.js.

**Can I customize the SQL and charts?**

Completely. Reports are plain files — edit the SQL, modify the ECharts function, change parameters, adjust the analysis prompt. There's no abstraction layer hiding the implementation. You can also ask Claude Code to iterate on any part of an existing report.

**What data is available?**

Everything in your UltraCart BigQuery data warehouse — orders, items, customers, coupons, auto orders (subscriptions), analytics sessions, screen recordings, and more. Plus any external BigQuery projects you register (Google Ads, Meta, Funnel.io, DBT, etc.).

**What does it cost to run?**

The tool is free and open source (Apache 2.0). Designing reports is done interactively in Claude Code — covered by your existing Claude Code subscription with no extra API charges or per-report billing. Report replay has zero AI cost (pure Node.js). BigQuery compute is typically under $0.01 per run. Optional AI analysis on scheduled runs costs ~$0.002-$0.03 per report depending on the model.

**Can I manage reports for multiple merchants?**

Yes. The config supports multiple merchants. Agencies and consultants can run all client reports from a single repo with per-client delivery configured in each report manifest.
