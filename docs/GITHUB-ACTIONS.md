# Automated Reports with GitHub Actions

Run your UltraCart BigQuery reports on a schedule using GitHub Actions — no servers, no infrastructure, no maintenance. Your reports live in a private GitHub repo, run on a cron schedule, and deliver results via `--deliver` to Slack, email, or wherever you configure them.

**What this gives you:**
- Scheduled report generation (daily, weekly, monthly)
- Secure credential management via GitHub Secrets
- Free compute (GitHub Actions free tier: 2,000 min/month)
- No servers to maintain
- Full audit trail via git history
- Built-in delivery to Slack and email via `--deliver`

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Your Private GitHub Repo                   │
│                                                              │
│  .ultracart-bq.json          (config — committed, no secrets) │
│  reports/                                                    │
│  ├── DEMO/                                                   │
│  │   ├── revenue-by-payment/                                 │
│  │   │   ├── report.yaml     (manifest with delivery config) │
│  │   │   ├── query.sql       (parameterized SQL)             │
│  │   │   ├── chart.js        (ECharts function)              │
│  │   │   └── analysis_prompt.md                              │
│  │   ├── ltv-by-cohort/                                      │
│  │   │   └── ...                                             │
│  │   └── top-products/                                       │
│  │       └── ...                                             │
│  .github/                                                    │
│  └── workflows/                                              │
│      ├── weekly-reports.yml                                  │
│      └── monthly-deep-analysis.yml                           │
└──────────────────────────────────────────────────────────────┘
          │
          │  Cron trigger (e.g., every Monday 6am UTC)
          ▼
┌──────────────────────────────────────────────────────────────┐
│                    GitHub Actions Runner                      │
│                                                              │
│  1. Checkout repo (includes config + report definitions)     │
│  2. Install Node.js + uc-bq CLI                              │
│  3. Authenticate to BigQuery (GCP service account)           │
│  4. uc-bq run-all --deliver                                  │
│     (generates reports + delivers to Slack/email per manifest)│
└──────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Slack Channel   │  │  Email Inbox     │  │  GitHub Artifact │
│  #analytics      │  │  ceo@example.com │  │  (downloadable)  │
│                  │  │                  │  │                  │
│  chart.png       │  │  report.pdf      │  │  report.pdf      │
│  report.pdf      │  │  (attachment)    │  │  data.json       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Step 1: Create the GitHub Repo

Create a private repo for your reports. You can use the same repo where you designed the reports with Claude Code, or create a dedicated one.

```bash
# If starting fresh
mkdir my-ultracart-reports
cd my-ultracart-reports
git init

# Copy your config and reports from your Claude Code project
cp /path/to/project/.ultracart-bq.json .
cp -r /path/to/project/reports/ ./reports/

# Don't commit output files — they're regenerated each run
cat > .gitignore << 'EOF'
node_modules/
dist/
.ultracart-bq-cache/
*.png
*.pdf
data.json
report.md
EOF

git add .
git commit -m "Add report definitions"
git remote add origin git@github.com:yourorg/my-ultracart-reports.git
git push -u origin main
```

**What gets committed:** `.ultracart-bq.json` (config — contains merchant IDs and taxonomy levels, no secrets), `report.yaml`, `query.sql`, `chart.js`, `analysis_prompt.md`.

**What doesn't get committed:** Output files (regenerated each run), cache directory, credentials (handled via GitHub Secrets).

---

## Step 2: Set Up Secrets

Go to your repo -> Settings -> Secrets and variables -> Actions, and add:

| Secret | Value | Purpose |
|--------|-------|---------|
| `GCP_SA_KEY` | Your service account JSON key (entire file contents) | BigQuery authentication |
| `SLACK_BOT_TOKEN` | `xoxb-...` | Slack delivery (if using Slack) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | AI-generated analysis (optional) |
| Email provider key | e.g., `SENDGRID_API_KEY` | Email delivery (if using email) |

| Variable | Value | Purpose |
|----------|-------|---------|
| `EMAIL_FROM` | `reports@example.com` | Sender address for email delivery |

Note: The Slack channel ID and email recipients are in each report's `report.yaml` manifest, not in GitHub variables. The merchant ID and taxonomy level are in `.ultracart-bq.json`.

---

## Step 3: Create the Workflow

### Weekly Full Reports

Create `.github/workflows/weekly-reports.yml`:

```yaml
name: Weekly Reports

on:
  schedule:
    # Every Monday at 11:00 UTC (6am ET, 3am PT)
    - cron: '0 11 * * 1'
  workflow_dispatch:  # Allow manual trigger from GitHub UI

jobs:
  generate-reports:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout report definitions
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install uc-bq CLI
        run: npm install -g @ultracart/bq-skill

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Run and deliver all reports
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --deliver --no-analysis

      - name: Upload reports as artifacts
        uses: actions/upload-artifact@v4
        with:
          name: weekly-reports-${{ github.run_number }}
          path: |
            reports/**/chart.png
            reports/**/report.pdf
            reports/**/data.json
          retention-days: 30
```

### Weekly Reports with AI Analysis

If you want the executive analysis regenerated with fresh data each week, add the API key:

```yaml
      - name: Run and deliver all reports with analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --deliver --analysis-model=claude-haiku-4-5-20251001
```

Use Haiku for scheduled runs — it's cheap (~$0.002/report) and good enough for recurring analysis. Save Sonnet/Opus for interactive sessions.

### Daily Chart Snapshots (Lightweight)

For a lightweight daily update, just refresh the charts without analysis:

Create `.github/workflows/daily-snapshots.yml`:

```yaml
name: Daily Chart Snapshots

on:
  schedule:
    - cron: '0 12 * * *'  # Every day at noon UTC
  workflow_dispatch:

jobs:
  snapshots:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      - run: npm install -g @ultracart/bq-skill

      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }

      - name: Run and deliver all reports (no analysis)
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --deliver --no-analysis
```

### Monthly Deep Analysis

For a thorough monthly report with Sonnet-quality analysis:

```yaml
name: Monthly Deep Analysis

on:
  schedule:
    - cron: '0 12 1 * *'  # 1st of every month at noon UTC
  workflow_dispatch:

jobs:
  monthly:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g @ultracart/bq-skill
      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }

      - name: Run and deliver with deep analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --deliver --analysis-model=claude-sonnet-4-5-20250929

      - uses: actions/upload-artifact@v4
        with:
          name: monthly-reports-${{ github.run_number }}
          path: reports/**/report.pdf
          retention-days: 90
```

---

## Step 4: Test It

You don't have to wait for the cron schedule. Every workflow has `workflow_dispatch` enabled, so you can trigger it manually:

1. Go to your repo -> Actions tab
2. Select the workflow (e.g., "Weekly Reports")
3. Click "Run workflow"
4. Watch it execute in real time

---

## Step 5: Add More Reports

When you want a new report:

1. Open Claude Code in your project
2. Ask for the report you want
3. Claude Code creates the report files using `uc-bq` (including delivery config in the manifest)
4. Commit and push the new report definition
5. Next scheduled run picks it up automatically — delivery included

```bash
git add reports/DEMO/new-report-name/
git commit -m "Add new-report-name report"
git push
```

That's it. No workflow changes needed — `uc-bq run-all --deliver` automatically discovers all reports and delivers those that have a `delivery` section in their manifest.

---

## Cost Breakdown

For a merchant running 5 reports weekly:

| Component | Cost | Notes |
|-----------|------|-------|
| GitHub Actions | Free | Well within 2,000 min/month free tier (~2 min per run) |
| BigQuery | ~$0.01-0.05/run | Depends on data scanned per query |
| Anthropic API (Haiku) | ~$0.01/run | 5 reports x ~$0.002 each |
| Anthropic API (Sonnet) | ~$0.15/run | 5 reports x ~$0.03 each |
| Slack | Free | Bot tokens are free |
| Email (SendGrid) | Free | Free tier: 100 emails/day |
| **Total (no analysis)** | **~$0.05/week** | **$2.60/year** |
| **Total (Haiku analysis)** | **~$0.06/week** | **$3.12/year** |
| **Total (Sonnet analysis)** | **~$0.20/week** | **$10.40/year** |

---

## Multiple Merchants

If you manage multiple UltraCart accounts, use a matrix strategy:

```yaml
jobs:
  reports:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        merchant:
          - { id: 'DEMO', taxonomy: 'medium' }
          - { id: 'DEMO2', taxonomy: 'standard' }

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g @ultracart/bq-skill
      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }

      - name: Run and deliver for ${{ matrix.merchant.id }}
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --merchant=${{ matrix.merchant.id }} --deliver --no-analysis
```

Each merchant's reports have their own delivery config in their manifests (different Slack channels, different email recipients). The `--deliver` flag handles routing automatically. See [MULTI-CLIENT.md](MULTI-CLIENT.md) for the full multi-workspace Slack setup.

---

## Puppeteer / Chart Rendering in GitHub Actions

Yes, Puppeteer works in GitHub Actions out of the box. The `ubuntu-latest` runners have the Chromium system dependencies pre-installed, and Puppeteer bundles its own Chromium binary.

The only downside: Puppeteer downloads ~400MB of Chromium on each run via `npm install`. To avoid this, cache the Puppeteer browser between runs:

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }

      # Cache Puppeteer's Chromium download
      - name: Cache Puppeteer browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/puppeteer
          key: puppeteer-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
          restore-keys: puppeteer-${{ runner.os }}-

      - run: npm install -g @ultracart/bq-skill

      # ... rest of workflow
```

This caches `~/.cache/puppeteer` (where Chromium is stored) and restores it on subsequent runs. First run downloads Chromium (~30s), subsequent runs skip the download entirely.

If you're running into issues with Chromium on a specific runner, you can set the environment variable to use the system-installed Chromium instead:

```yaml
      - name: Run reports
        env:
          PUPPETEER_EXECUTABLE_PATH: /usr/bin/chromium-browser
        run: uc-bq run-all --deliver --no-analysis
```

---

## Security Notes

- **GCP credentials** are stored as GitHub Secrets — never exposed in logs or workflow files
- **Slack tokens** are stored as GitHub Secrets
- **Anthropic API keys** are stored as GitHub Secrets
- **Email provider API keys** are stored as GitHub Secrets
- **The config file** contains only merchant IDs and taxonomy levels — no secrets
- **Delivery config** in manifests contains channel IDs and email addresses but no tokens or keys
- **BigQuery access** is read-only — the service account can't modify data
- **Report definitions** (SQL, chart.js) are version-controlled — you can audit every change
- **Private repo** — nobody outside your org can see your report definitions or data
