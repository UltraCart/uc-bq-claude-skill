# Email Newsletter: BigQuery Reporting Skill for Claude Code

> **Subject line options:**
> - New developer tool: BigQuery reporting with Claude Code
> - Build automated BigQuery reports from your terminal — new Claude Code skill
> - For developers: agentic e-commerce reporting against your UltraCart data warehouse

> **Preview text:** A CLI + Claude Code skill for building version-controlled, CI/CD-native BigQuery reports. Design once with AI, replay forever without it.

---

## New: BigQuery Reporting Skill for Claude Code

UltraCart's data warehouse gives you a rich BigQuery dataset — orders, customers, items, analytics, and more. Our built-in AI reporting UI makes it easy for merchants to get insights from a browser.

But if you're a developer — if you live in the terminal, version everything in git, and automate with CI/CD — you want something that fits that workflow. That's what the **BigQuery Reporting Skill** is.

---

## What Is It?

A **Claude Code skill** + **Node.js CLI** (`uc-bq`) for building and replaying UltraCart BigQuery reports programmatically.

- **Design reports in Claude Code** — describe what you want in plain English. Claude Code discovers your schema, writes parameterized SQL, creates ECharts visualizations, writes executive analysis, and saves a replayable report manifest.
- **Replay from the CLI** — `uc-bq run revenue-by-category` executes saved SQL against live data, re-renders the chart, and generates an updated PDF. No AI calls. Pure Node.js.
- **Automate with cron or GitHub Actions** — schedule reports, deliver to Slack and email, define alarms for management by exception.

Report design happens in Claude Code — covered by your existing subscription, no extra API charges. Every replay after that is zero AI cost — just BigQuery compute, typically under $0.01 per run.

---

## Why Developers Choose This Over a Dashboard

**Reports as code.** SQL templates, ECharts configs, and YAML manifests live in your git repo. Review them in PRs, diff them, roll them back.

**Full control.** No abstraction layer hiding the SQL. No predefined report types. Any query, any chart, any analysis — if BigQuery can run it, this tool can automate it.

**Cross-project data.** Register external GCP projects and selectively expose their datasets and tables alongside your UltraCart data. Browse a project's schema before committing to it, control exactly which tables are visible, and build cross-project reports — like joining UltraCart orders with Google Ads spend to calculate ROAS. Works with any BigQuery source: Google Ads, Meta, Funnel.io, DBT models, internal warehouses.

**Multi-client.** Agencies and consultants: one repo, many merchants. Per-client Slack and email delivery. One GitHub Actions workflow runs everything.

**Zero lock-in.** Apache 2.0 open source. Plain files. Standard BigQuery SQL. Standard ECharts JavaScript. If you stop using the tool, your reports are still readable, editable, runnable code.

---

## Quick Tour

```
# Install
npm install -g @ultracart/bq-skill

# Register the Claude Code skill
uc-bq install-skill

# Configure
uc-bq init

# In Claude Code: "Build a revenue-by-category report for the last 90 days"
# Claude Code creates: report.yaml, query.sql, chart.js, chart.png, report.pdf

# Replay anytime
uc-bq run revenue-by-category --deliver

# Combine into a deck
uc-bq deck run weekly-executive --deliver

# Generate interactive dashboard
uc-bq deck dashboard weekly-executive --open

# Schedule (cron)
0 6 * * 1 uc-bq run-all --deliver
```

---

## Reports

Each report is a self-contained directory: `report.yaml` manifest, `query.sql` template, `chart.js` ECharts function, rendered PNG, combined PDF (chart + analysis), and an analysis prompt for scheduled AI-generated summaries. Parameters support relative date expressions (`-90d`, `today`, `start_of_year`, `end_of_last_quarter`) that resolve at runtime. PDFs render in portrait or landscape. Run history is tracked per report — `uc-bq history` shows every execution with parameters, row count, and bytes processed.

## Decks

Combine multiple reports into a single branded PDF. Define a deck in YAML: specify the reports, a cover page (company name, logo, title), and optional parameter overrides. The output is a polished document with a clickable table of contents and each report on its own page. Deck parameters override individual report defaults, and CLI flags override deck parameters — clean priority chain for flexible automation.

## Interactive Dashboards

Generate a self-contained HTML dashboard from any deck with `uc-bq deck dashboard`. ECharts loads from CDN with all data inlined — one `.html` file, no backend, no build step. Responsive two-column grid on wide screens, single column on mobile. Each chart renders in a styled card with interactive tooltips, hover effects, and zoom. Deploy to S3, nginx, or open directly from disk.

## Everything Else

- **Automated delivery** — Slack + email (SendGrid, Postmark, Mailgun, Resend, AWS SES)
- **Smart alarms** — threshold, percent-change, and missing-data alerts with severity escalation, cooldown, Slack `@channel` mentions on critical, and `alarm_only` delivery mode (silence means everything is fine)
- **Cost protection** — every `run` and `deck run` estimates query cost before executing; aborts if it exceeds your safety limit (default 10 GB / ~$0.06)
- **5 LLM providers** — Anthropic, OpenAI, Gemini, Grok, Bedrock for optional scheduled analysis
- **External data sources** — join UltraCart data with any BigQuery project
- **Multi-merchant** — one config, many stores, per-client delivery

---

## Management by Exception with Alarms

You have 10 reports running weekly. Most weeks, everything is fine. Without alarms, you're either reviewing every report manually or ignoring them.

Set `delivery.mode: "alarm_only"` on a report and it only notifies you when something's wrong — revenue dropped 20%, a data pipeline returned zero rows, or a metric crossed a threshold. Three alarm types (threshold, percent-change, missing-data), three severity levels (low, high, critical), and cooldown windows to prevent alert fatigue. Critical alarms trigger Slack `@channel` mentions. When running decks, alarms from all reports aggregate into one summary.

Silence means everything is fine.

---

## How This Complements UltraCart's Built-In Reporting

The built-in AI reporting UI in the UltraCart dashboard is designed for merchants who want insights in a browser. The BigQuery Reporting Skill is for developers who want:

- Reports version-controlled in git
- Full SQL and chart customization
- CI/CD-native scheduling and delivery
- Cross-platform data joins (UltraCart + Google Ads + Meta + anything in BigQuery)
- Multi-client management from a single repo

They're complementary tools for different workflows. Use the dashboard for quick merchant-facing insights. Use the skill for developer-driven automation and infrastructure.

---

## Get Started

1. **Install** — `npm install -g @ultracart/bq-skill`
2. **Register the skill** — `uc-bq install-skill`
3. **Authenticate** — `gcloud auth application-default login`
4. **Configure** — `uc-bq init`
5. **Open Claude Code** and describe the report you want

[Install from npm](https://www.npmjs.com/package/@ultracart/bq-skill) | [View on GitHub](https://github.com/UltraCart/bq-skill) | [Read the Tutorial](https://github.com/UltraCart/bq-skill/blob/main/TUTORIAL.md)

---

*Requires an active UltraCart data warehouse. [Learn more](https://www.ultracart.com/resources/data-warehouse.html) or contact your account manager to enable it.*
