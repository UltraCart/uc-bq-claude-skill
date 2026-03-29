# Multi-Client Setup for Agencies & Consultants

If you manage multiple UltraCart merchants — whether you're an agency, consultant, or multi-brand operator — this guide shows how to run reports across all your clients from a single GitHub repo and deliver results to each client's own Slack workspace and email recipients.

---

## The Scenario

You're a consultancy managing 5 UltraCart merchants. Each client has:
- Their own UltraCart merchant account (and BigQuery project)
- Their own Slack workspace (or a dedicated channel in yours)
- Their own email recipients for report delivery
- Their own set of reports they care about

You want:
- One private GitHub repo with all report definitions
- One scheduled GitHub Action that runs everything
- Each client's reports delivered to their Slack channel and email list, configured in each report's manifest

---

## Repo Structure

```
myconsultingco-reports/
├── .ultracart-bq.json              # All merchants configured
├── .github/
│   └── workflows/
│       └── weekly-reports.yml
├── reports/
│   ├── CLNT1/                      # Client 1
│   │   ├── revenue-by-channel/
│   │   │   └── report.yaml         # delivery: slack + email for CLNT1
│   │   ├── customer-ltv/
│   │   └── product-performance/
│   ├── CLNT2/                      # Client 2
│   │   ├── revenue-by-channel/
│   │   │   └── report.yaml         # delivery: slack + email for CLNT2
│   │   └── subscription-churn/
│   ├── CLNT3/
│   │   ├── revenue-summary/
│   │   └── geo-sales-map/
│   ├── CLNT4/
│   │   └── weekly-kpis/
│   └── CLNT5/
│       ├── revenue-by-category/
│       └── ad-spend-roas/
└── .gitignore
```

Each report's `report.yaml` contains its own `delivery` section with the target Slack channel and email recipients.

---

## Config

One config file with all merchants. This gets committed — it contains no secrets.

```json
{
  "default_merchant": "CLNT1",
  "merchants": {
    "CLNT1": {
      "taxonomy_level": "medium",
      "dataset": "ultracart_dw"
    },
    "CLNT2": {
      "taxonomy_level": "standard",
      "dataset": "ultracart_dw"
    },
    "CLNT3": {
      "taxonomy_level": "medium",
      "dataset": "ultracart_dw",
      "external_projects": {
        "ads": {
          "project_id": "gamma-marketing",
          "description": "Google Ads data",
          "datasets": {
            "google_ads": ["campaigns", "ad_groups"]
          }
        }
      }
    },
    "CLNT4": {
      "taxonomy_level": "standard",
      "dataset": "ultracart_dw"
    },
    "CLNT5": {
      "taxonomy_level": "medium",
      "dataset": "ultracart_dw",
      "external_projects": {
        "ads": {
          "project_id": "epsilon-ads-warehouse",
          "description": "Meta + Google Ads via Funnel.io",
          "datasets": {
            "google_ads": ["campaigns"],
            "meta_ads": ["campaigns", "ad_sets"]
          }
        }
      }
    }
  },
  "default_output_dir": "./reports",
  "output_format": "png",
  "max_query_bytes": 10737418240
}
```

---

## Per-Client Delivery Config

Each report manifest defines where its results go. Here's an example for CLNT1:

```yaml
# reports/CLNT1/revenue-by-channel/report.yaml
name: "Revenue by Channel"
description: "Weekly revenue breakdown by acquisition channel"

delivery:
  slack:
    channels: ["C0111111111"]       # CLNT1's Slack channel(s)
  email:
    to: ["ceo@clnt1-example.com", "analytics@clnt1-example.com"]
    subject: "Weekly: Revenue by Channel"
    provider: "sendgrid"

# ... rest of manifest
```

And for CLNT2:

```yaml
# reports/CLNT2/revenue-by-channel/report.yaml
name: "Revenue by Channel"

delivery:
  slack:
    channels: ["C0222222222"]       # CLNT2's Slack channel(s)
  email:
    to: ["owner@clnt2-example.com"]
    subject: "Weekly: Revenue by Channel"
    provider: "postmark"            # CLNT2 uses a different email provider

# ... rest of manifest
```

The channel IDs and email addresses live in the manifests. API keys and bot tokens live in environment variables / GitHub Secrets.

---

## GitHub Secrets

### Secrets (Settings -> Secrets -> Actions)

| Secret | Value | Purpose |
|--------|-------|---------|
| `GCP_SA_KEY` | Service account JSON | Access to all merchant BigQuery projects |
| `SLACK_BOT_TOKEN` | `xoxb-...` | Shared Slack bot (if all clients are in your workspace) |
| `SLACK_TOKEN_CLNT1` | `xoxb-...` | CLNT1's workspace bot (if separate workspaces) |
| `SLACK_TOKEN_CLNT2` | `xoxb-...` | CLNT2's workspace bot (if separate workspaces) |
| `SLACK_TOKEN_CLNT3` | `xoxb-...` | CLNT3's workspace bot |
| `SLACK_TOKEN_CLNT4` | `xoxb-...` | CLNT4's workspace bot |
| `SLACK_TOKEN_CLNT5` | `xoxb-...` | CLNT5's workspace bot |
| `SENDGRID_API_KEY` | `SG.xxx` | Email delivery via SendGrid |
| `POSTMARK_API_KEY` | `xxx` | Email delivery via Postmark (if some clients use it) |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | For AI analysis (optional) |

### Variables (Settings -> Variables -> Actions)

| Variable | Value | Purpose |
|----------|-------|---------|
| `EMAIL_FROM` | `reports@example.com` | Sender address for email delivery |

**GCP Service Account:** Your service account email needs to be registered in each client's UltraCart account for BigQuery access. One service account can access multiple merchant projects.

---

## Workflow: Same Slack Workspace

If all your clients have channels in YOUR Slack workspace (simplest case), you only need one bot token. Each report manifest has the correct `delivery.slack.channels`, and `--deliver` routes to the right channel(s) automatically.

```yaml
name: Weekly Client Reports

on:
  schedule:
    - cron: '0 11 * * 1'  # Monday 6am ET
  workflow_dispatch:

jobs:
  reports:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      matrix:
        client:
          - { id: 'CLNT1', name: 'Client 1' }
          - { id: 'CLNT2', name: 'Client 2' }
          - { id: 'CLNT3', name: 'Client 3' }
          - { id: 'CLNT4', name: 'Client 4' }
          - { id: 'CLNT5', name: 'Client 5' }

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g @ultracart/bq-skill

      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }

      - name: Run and deliver for ${{ matrix.client.name }}
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --merchant=${{ matrix.client.id }} --deliver --no-analysis
```

All 5 clients run in parallel. Each gets their reports delivered to their own channel and email recipients, as defined in their manifests.

---

## Workflow: Separate Slack Workspaces

If each client has their OWN Slack workspace, you need separate bot tokens. The matrix sets `SLACK_BOT_TOKEN` per client so `--deliver` picks up the right token:

```yaml
name: Weekly Client Reports (Multi-Workspace)

on:
  schedule:
    - cron: '0 11 * * 1'
  workflow_dispatch:

jobs:
  reports:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy:
      matrix:
        client:
          - { id: 'CLNT1', name: 'Client 1' }
          - { id: 'CLNT2', name: 'Client 2' }
          - { id: 'CLNT3', name: 'Client 3' }
          - { id: 'CLNT4', name: 'Client 4' }
          - { id: 'CLNT5', name: 'Client 5' }

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g @ultracart/bq-skill

      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }

      - name: Run and deliver for ${{ matrix.client.name }}
        env:
          SLACK_BOT_TOKEN: ${{ secrets[format('SLACK_TOKEN_{0}', matrix.client.id)] }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
          POSTMARK_API_KEY: ${{ secrets.POSTMARK_API_KEY }}
        run: uc-bq run-all --merchant=${{ matrix.client.id }} --deliver --no-analysis
```

The channel ID is in each manifest. The bot token is set per-client via the `secrets[format(...)]` expression. `--deliver` reads the channel from the manifest and the token from `SLACK_BOT_TOKEN`.

---

## Workflow: With AI Analysis

Add the API key and model selection. Use Haiku for daily, Sonnet for monthly:

```yaml
      - name: Run and deliver with analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SLACK_BOT_TOKEN: ${{ secrets[format('SLACK_TOKEN_{0}', matrix.client.id)] }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --merchant=${{ matrix.client.id }} --deliver --analysis-model=claude-haiku-4-5-20251001
```

The analysis is generated per-report using each report's `analysis_prompt.md`. The prompt was tailored to the specific query and data when you designed the report in Claude Code, so each client gets analysis relevant to their data.

---

## Adding a New Client

1. **Add the merchant to your config:**

```bash
uc-bq config add-merchant CLNT6 --taxonomy=medium
```

2. **Design their reports in Claude Code:**

```
> Show me revenue by product category for the last 30 days
```

Claude Code creates the report files under `reports/CLNT6/`, including the `delivery` section in each manifest.

3. **Add their Slack token to GitHub Secrets** (if separate workspace):

`SLACK_TOKEN_CLNT6` = `xoxb-...`

4. **Add them to the matrix in your workflow:**

```yaml
- { id: 'CLNT6', name: 'Client 6' }
```

5. **Commit and push:**

```bash
git add reports/CLNT6/ .ultracart-bq.json .github/workflows/
git commit -m "Add CLNT6 reports"
git push
```

Next scheduled run picks them up automatically. Delivery config is already in the manifests.

---

## Removing a Client

1. Delete their report directory: `rm -rf reports/CLNT6/`
2. Remove from config: `uc-bq config remove-merchant CLNT6`
3. Remove from the workflow matrix
4. Delete the GitHub secret (`SLACK_TOKEN_CLNT6`)
5. Commit and push

---

## Security Considerations

- **Client isolation:** Each client's reports only contain data from their own BigQuery project. Cross-client data leakage is impossible because BigQuery enforces project-level access.
- **Slack isolation:** Each client's bot token only has access to their workspace. A token for Client A can't post to Client B's workspace.
- **Email isolation:** Each manifest specifies its own recipients. There is no shared recipient list.
- **GCP access:** Your service account needs to be registered in each client's UltraCart account. If a client offboards, they remove your service account and your access stops immediately.
- **Private repo:** Your report definitions (SQL, chart logic, analysis prompts) are in a private repo. Clients can't see each other's report configurations.
- **Audit trail:** Every report change is a git commit. You can trace who changed what and when.

---

## Cost at Scale

Running 5 clients with 3 reports each, weekly:

| Component | Per Run | Weekly (5 clients x 3 reports) | Monthly |
|-----------|---------|-------------------------------|---------|
| GitHub Actions | ~2 min per client | ~10 min | ~40 min (free tier: 2,000 min) |
| BigQuery | ~$0.01/query | ~$0.15 | ~$0.60 |
| Analysis (Haiku) | ~$0.002/report | ~$0.03 | ~$0.12 |
| Analysis (Sonnet) | ~$0.03/report | ~$0.45 | ~$1.80 |
| Slack | Free | Free | Free |
| Email (SendGrid) | Free | Free | Free (100/day free tier) |
| **Total (no analysis)** | | **~$0.15/week** | **$0.60/month** |
| **Total (Haiku)** | | **~$0.18/week** | **$0.72/month** |
| **Total (Sonnet)** | | **~$0.60/week** | **$2.40/month** |

At 20 clients with 5 reports each, you're still under $10/month with Sonnet analysis. Compare that to any reporting SaaS.

---

## Handling Failures

When you're running 10+ clients on a schedule, things will break — a client revokes your service account, BigQuery has a transient error, a Slack token expires. The key is making sure one broken client doesn't take down everyone else.

### Matrix jobs are already isolated

GitHub Actions matrix jobs run independently. If CLNT3's BigQuery auth fails, CLNT1, CLNT2, CLNT4, and CLNT5 still run and deliver their reports. The workflow shows a partial failure (yellow/red icon) but the successful clients aren't affected.

### `uc-bq run-all` continues past failures

Within a single merchant, if report 1 of 5 fails (bad SQL, cost limit exceeded, etc.), reports 2-5 still run. Delivery failures are also non-fatal — if Slack is down for one report, the others still deliver. The CLI logs the failure and prints a summary at the end:

```
[1/5] Revenue by Channel ........... x  Query error: table not found
[2/5] Customer LTV ................. +  (2.4 GB, $0.015)  delivered: slack, email
[3/5] Product Performance .......... +  (890 MB, $0.005)  delivered: slack, email
[4/5] Subscription Churn ........... +  (1.1 GB, $0.007)  delivered: slack
[5/5] Weekly KPIs .................. +  (340 MB, $0.002)  delivery failed: email - 401

Total: 4 reports, 4.7 GB processed, $0.029
Delivered: 4 slack, 3 email (1 email failed)
Failed: 1 report
```

### Alert on failures via Slack

Add a failure notification step that only runs when something breaks:

```yaml
    steps:
      - name: Run and deliver reports
        id: run-reports
        continue-on-error: true  # Don't fail the whole job
        env:
          SLACK_BOT_TOKEN: ${{ secrets[format('SLACK_TOKEN_{0}', matrix.client.id)] }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --merchant=${{ matrix.client.id }} --deliver --no-analysis

      - name: Alert on failure
        if: steps.run-reports.outcome == 'failure'
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_OPS_TOKEN }}  # Your internal Slack, not client's
        run: |
          curl -s -X POST -H 'Content-type: application/json' \
            --data "{
              \"text\": \":rotating_light: Report generation failed for *${{ matrix.client.name }}* (${{ matrix.client.id }})\nWorkflow: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\"
            }" \
            ${{ secrets.SLACK_OPS_WEBHOOK }}
```

This sends failure alerts to YOUR ops channel (not the client's) so you can investigate without the client seeing error messages.

### Retry transient failures

For transient BigQuery or network errors, add retry logic:

```yaml
      - name: Run and deliver reports (with retry)
        uses: nick-fields/retry@v3
        with:
          timeout_minutes: 10
          max_attempts: 2
          retry_wait_seconds: 30
          command: uc-bq run-all --merchant=${{ matrix.client.id }} --deliver --no-analysis
        env:
          SLACK_BOT_TOKEN: ${{ secrets[format('SLACK_TOKEN_{0}', matrix.client.id)] }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
```

This retries once after 30 seconds — enough to survive a transient BigQuery 503.

### Monitor with a summary job

Add a final job that checks all matrix results and sends one summary:

```yaml
  summary:
    needs: reports
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Report summary
        env:
          RESULTS: ${{ toJSON(needs.reports.result) }}
        run: |
          if [ "$RESULTS" = '"success"' ]; then
            echo "All clients succeeded"
          else
            echo "Some clients failed — check individual jobs"
          fi

      - name: Post summary to ops channel
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_OPS_WEBHOOK }}
        run: |
          STATUS="${{ needs.reports.result }}"
          if [ "$STATUS" = "success" ]; then
            EMOJI=":white_check_mark:"
            MSG="All client reports generated and delivered successfully"
          else
            EMOJI=":warning:"
            MSG="Some client reports failed — check Actions"
          fi

          curl -s -X POST -H 'Content-type: application/json' \
            --data "{\"text\": \"$EMOJI Weekly report run: $MSG\n${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\"}" \
            $SLACK_WEBHOOK
```

### Common failure scenarios

| Failure | Blast Radius | Recovery |
|---------|-------------|----------|
| Client revokes service account | That client only | Re-register SA in their UltraCart dashboard |
| Slack token expires | That client's Slack delivery only | Regenerate token, update GitHub Secret |
| Email API key invalid | Email delivery for that provider | Regenerate key, update GitHub Secret |
| BigQuery transient error (503) | That client, that run | Auto-retry handles it |
| Query cost exceeds limit | One report in one client | Adjust `max_query_bytes` or add partition filters |
| Anthropic API rate limit | Analysis only, that client | Use `--no-analysis` or retry |
| GitHub Actions outage | All clients, that run | Wait for GitHub to recover, next scheduled run catches up |
| Bad SQL in a report | One report in one client | Fix the SQL, commit, push — next run picks it up |

---

## Alternative: One Repo Per Client

If you prefer complete isolation (separate repos, separate CI, no shared secrets):

```
github.com/myconsultingco/reports-client1/
github.com/myconsultingco/reports-client2/
github.com/myconsultingco/reports-client3/
```

Each repo has its own config, workflow, and secrets. Simpler per-repo, but more repos to maintain. The single-repo approach above scales better.

---

## FAQ

**Q: Can different clients have different report schedules?**
Yes. Use separate workflow files or add `if` conditions in the matrix:

```yaml
# Only run CLNT3 on the 1st of the month
- name: Run reports
  if: matrix.client.id != 'CLNT3' || github.event.schedule == '0 12 1 * *'
  run: uc-bq run-all --merchant=${{ matrix.client.id }} --deliver
```

Or simpler: two workflow files — `weekly-reports.yml` for weekly clients and `monthly-reports.yml` for monthly clients, each with their own matrix.

**Q: What if a client wants to see the reports but not in Slack or email?**
The workflow also uploads reports as GitHub Actions artifacts (downloadable from the Actions tab). You can share the artifact download link. Reports without a `delivery` section in their manifest are generated but not delivered anywhere.

**Q: Can clients run their own reports on demand?**
Yes. Give them access to the repo and they can trigger the workflow manually via GitHub's "Run workflow" button. Or give them the CLI directly — `npm install -g @ultracart/bq-skill` — and they can run `uc-bq run <report> --deliver` locally.

**Q: What if I need different GCP service accounts per client?**
Add separate secrets (`GCP_SA_KEY_CLNT1`, `GCP_SA_KEY_CLNT2`, etc.) and use `secrets[format('GCP_SA_KEY_{0}', matrix.client.id)]` in the auth step. But typically one service account registered across all clients is simpler.

**Q: Can different clients use different email providers?**
Yes. Each report manifest specifies its own `delivery.email.provider`. Set all provider API keys in the environment and the CLI picks the right one per report.
