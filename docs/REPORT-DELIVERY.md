# Report Delivery

Reports can be automatically delivered to Slack channels and email recipients after generation. Delivery is configured per-report in the manifest and triggered with the `--deliver` flag.

```bash
# Deliver a single report
uc-bq run revenue-by-payment --deliver

# Deliver all reports
uc-bq run-all --deliver --no-analysis
```

Delivery failures are logged but never crash the run. If Slack is down or an email bounces, the report still generates successfully and the error is printed in the summary.

---

## Manifest Configuration

Add a `delivery` section to any report's `report.yaml`:

```yaml
name: "Revenue by Payment Method"
description: "Weekly revenue breakdown by payment type"
created: 2026-03-28
last_run: 2026-03-28

parameters:
  - name: start_date
    type: date
    required: true
    default: "-7d"
  - name: end_date
    type: date
    required: true
    default: "today"

delivery:
  slack:
    channels: ["C0123456789"]
  email:
    to: ["ceo@example.com", "marketing@example.com"]
    subject: "Weekly: Revenue by Payment Method"
    provider: "sendgrid"

config:
  merchant_id: "DEMO"
  project_id: "ultracart-dw-demo"
  taxonomy_level: "medium"
  dataset: "ultracart_dw"
  tables_used: ["uc_orders"]

sql_file: "query.sql"
chart:
  type: "bar"
  echarts_file: "chart.js"
  output_format: "png"
  width: 1200
  height: 600

analysis:
  include: true
  prompt_file: "analysis_prompt.md"
  output_file: "report.md"
```

The `delivery` section is optional. Reports without it are unaffected by `--deliver`.

### Slack delivery

```yaml
delivery:
  slack:
    channels: ["C0123456789"]    # Channel ID(s) (not channel names)
```

Uploads the report PDF (or chart PNG if no PDF exists) to the specified Slack channel(s) with a formatted message.

### Email delivery

```yaml
delivery:
  email:
    to: ["ceo@example.com", "marketing@example.com"]
    subject: "Weekly: Revenue by Payment Method"
    provider: "sendgrid"       # sendgrid | postmark | mailgun | resend | ses
```

Sends the report PDF as an attachment to the listed recipients. The `subject` field is optional and defaults to the report name. The `provider` field selects which email API to use.

### Both Slack and email

```yaml
delivery:
  slack:
    channels: ["C0123456789"]
  email:
    to: ["reports@example.com"]
    subject: "Weekly Revenue Report"
    provider: "postmark"
```

Both channels fire independently. If Slack delivery fails, email still sends (and vice versa).

---

## Slack Setup

### 1. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" -> "From scratch"
3. Name it (e.g., "UltraCart Reports") and select your workspace

### 2. Add OAuth Scopes

Under "OAuth & Permissions", add these Bot Token Scopes:
- `files:write` -- upload report files
- `chat:write` -- post messages to channels

### 3. Install to Workspace

Click "Install to Workspace" and authorize. Copy the **Bot User OAuth Token** (`xoxb-...`).

### 4. Get the Channel ID

Right-click the channel in Slack -> "View channel details" -> scroll to the bottom. The Channel ID looks like `C0123456789`.

### 5. Invite the Bot

In the target channel, type `/invite @YourBotName` so the bot can post there.

### 6. Set the Environment Variable

```bash
export SLACK_BOT_TOKEN=xoxb-your-token-here
```

Add the channel ID to the report manifest using the CLI:

```bash
uc-bq config add-slack <report> C0123456789
```

---

## Email Provider Setup

All email delivery uses REST APIs. No SMTP, no extra npm dependencies (except `@aws-sdk/client-sesv2` for SES).

Set `EMAIL_FROM` in your environment for the sender address:

```bash
export EMAIL_FROM=reports@example.com
```

Then configure your chosen provider:

### SendGrid

1. Sign up at https://sendgrid.com
2. Go to Settings -> API Keys -> Create API Key (Full Access or Mail Send)
3. Copy the key

```bash
export SENDGRID_API_KEY=SG.xxxxxxxxxx
```

Manifest: `provider: "sendgrid"`

### Postmark

1. Sign up at https://postmarkapp.com
2. Create a Server -> go to API Tokens
3. Copy the Server API Token

```bash
export POSTMARK_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Manifest: `provider: "postmark"`

Note: Your sender address (`EMAIL_FROM`) must be verified in Postmark under Sender Signatures.

### Mailgun

1. Sign up at https://mailgun.com
2. Go to Sending -> Domains -> select your domain
3. Copy the API key and note the domain

```bash
export MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export MAILGUN_DOMAIN=mg.example.com
```

Manifest: `provider: "mailgun"`

Note: Free accounts are limited to verified recipients only. Add a custom domain for production use.

### Resend

1. Sign up at https://resend.com
2. Go to API Keys -> Create API Key
3. Copy the key

```bash
export RESEND_API_KEY=re_xxxxxxxxxx
```

Manifest: `provider: "resend"`

Note: Verify your sending domain in Resend's dashboard before sending.

### AWS SES

1. Set up SES in the AWS Console (verify your domain or email address)
2. Configure AWS credentials via any standard method (env vars, shared credentials file, IAM role)

```bash
# Standard AWS credential environment variables
export AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxx
export AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
export AWS_REGION=us-east-1
```

Manifest: `provider: "ses"`

Note: SES is the only provider that requires an additional dependency (`@aws-sdk/client-sesv2`). Install it if you plan to use SES:

```bash
npm install @aws-sdk/client-sesv2
```

New SES accounts start in sandbox mode (verified recipients only). Request production access to send to any address.

---

## Environment Variable Reference

| Variable | Required For | Description |
|----------|-------------|-------------|
| `SLACK_BOT_TOKEN` | Slack delivery | Bot User OAuth Token (`xoxb-...`) |
| `EMAIL_FROM` | All email providers | Sender email address |
| `SENDGRID_API_KEY` | SendGrid | SendGrid API key (`SG.xxx`) |
| `POSTMARK_API_KEY` | Postmark | Postmark Server API Token |
| `MAILGUN_API_KEY` | Mailgun | Mailgun API key (`key-xxx`) |
| `MAILGUN_DOMAIN` | Mailgun | Mailgun sending domain |
| `RESEND_API_KEY` | Resend | Resend API key (`re_xxx`) |
| `AWS_ACCESS_KEY_ID` | AWS SES | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS SES | AWS secret key |
| `AWS_REGION` | AWS SES | AWS region for SES |

---

## GitHub Actions with `--deliver`

The `--deliver` flag replaces the need for manual curl scripts in your CI workflows. Reports define their own delivery targets in their manifests, so the workflow just runs the reports and delivery happens automatically.

### Weekly reports

```yaml
name: Weekly Reports

on:
  schedule:
    - cron: '0 11 * * 1'
  workflow_dispatch:

jobs:
  generate-reports:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g @ultracart/bq-skill

      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }

      - name: Run and deliver all reports
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --deliver --no-analysis

      - uses: actions/upload-artifact@v4
        with:
          name: weekly-reports-${{ github.run_number }}
          path: |
            reports/**/chart.png
            reports/**/report.pdf
            reports/**/data.json
          retention-days: 30
```

No separate "Post to Slack" or "Send email" steps. Each report's manifest says where it goes, and `--deliver` handles it.

### Monthly deep analysis

```yaml
name: Monthly Deep Analysis

on:
  schedule:
    - cron: '0 12 1 * *'
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
          # Set the API key for your configured LLM provider:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
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

### Secrets to configure

| Secret | Purpose |
|--------|---------|
| `GCP_SA_KEY` | BigQuery authentication |
| `SLACK_BOT_TOKEN` | Slack delivery |
| LLM provider API key | AI-generated analysis (optional) -- set the key matching your `llm.provider` config (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `GOOGLE_API_KEY`, or AWS credentials for Bedrock) |
| Provider API key(s) | Whichever email provider you use |

| Variable | Purpose |
|----------|---------|
| `EMAIL_FROM` | Sender email address |

---

## Multi-Client Delivery Patterns

When managing multiple merchants, each report manifest contains its own delivery config -- different Slack channels, different email recipients, different providers.

### Same Slack workspace

If all clients share a workspace (e.g., channels in your agency's Slack), one `SLACK_BOT_TOKEN` covers everything. Each manifest has the correct `delivery.slack.channels`.

### Separate Slack workspaces

Each workspace needs its own bot token. Use the GitHub Actions matrix approach: set `SLACK_BOT_TOKEN` per matrix entry so `--deliver` picks up the right token for each client.

```yaml
jobs:
  reports:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        client:
          - { id: 'CLNT1', name: 'Client 1' }
          - { id: 'CLNT2', name: 'Client 2' }

    env:
      SLACK_TOKEN_CLNT1: ${{ secrets.SLACK_TOKEN_CLNT1 }}
      SLACK_TOKEN_CLNT2: ${{ secrets.SLACK_TOKEN_CLNT2 }}

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
        run: uc-bq run-all --merchant=${{ matrix.client.id }} --deliver --no-analysis
```

The channel ID lives in each manifest. The bot token is set per-client via the matrix. `--deliver` reads the channel from the manifest and the token from the environment.

### Different email providers per client

Each manifest specifies its own `delivery.email.provider`. Set all the API keys in the environment and the CLI picks the right one per report:

```bash
# All keys available, each report uses what its manifest says
export SENDGRID_API_KEY=SG.xxx        # Used by reports with provider: "sendgrid"
export POSTMARK_API_KEY=xxx           # Used by reports with provider: "postmark"
```

---

## Decks: Delivering Multiple Reports as One PDF

If you're delivering more than a couple of reports to the same audience, consider using a **deck** instead. Decks combine multiple reports into a single PDF with a branded cover page and clickable table of contents. Instead of 5 separate Slack uploads and 5 separate emails, the audience gets one polished document.

```bash
# Deliver a deck (one PDF with all reports combined)
uc-bq deck run weekly-executive --deliver
```

Deck delivery uses the same infrastructure (Slack bot token, email providers, environment variables) as individual report delivery. The `delivery` section in the deck YAML follows the same format as report manifests.

Decks and individual reports have independent delivery configs -- you can deliver both if different audiences need different things. See [DECKS.md](DECKS.md) for full deck documentation.

---

## Managing Delivery via CLI

Instead of hand-editing `report.yaml`, use the `uc-bq config` delivery commands to manage Slack channels and email settings for any report.

### Slack channels

```bash
# Add one or more Slack channels to a report
uc-bq config add-slack revenue-by-payment C0123456789 C9876543210

# Remove a channel
uc-bq config remove-slack revenue-by-payment C9876543210
```

### Email — full setup

```bash
# Set the complete email config at once
uc-bq config set-email revenue-by-payment \
  --to=ceo@example.com,marketing@example.com \
  --provider=sendgrid \
  --subject="Weekly: Revenue by Payment Method"
```

### Email — incremental changes

```bash
# Add recipients
uc-bq config add-email revenue-by-payment ops@example.com

# Remove recipients
uc-bq config remove-email revenue-by-payment ops@example.com

# Change the email provider
uc-bq config set-email-provider revenue-by-payment postmark

# Change the subject line
uc-bq config set-email-subject revenue-by-payment "Monthly: Revenue by Payment Method"
```

### View delivery config

```bash
uc-bq config show-delivery revenue-by-payment
```

```
Delivery config for "revenue-by-payment":
  Slack channels: C0123456789
  Email:
    To: ceo@example.com, marketing@example.com
    Provider: sendgrid
    Subject: Weekly: Revenue by Payment Method
```

---

## Failure Handling

Delivery failures are isolated and non-fatal:

- If Slack delivery fails (bad token, channel not found, network error), the error is logged and the run continues.
- If email delivery fails (bad API key, invalid recipient, provider down), the error is logged and the run continues.
- If both Slack and email are configured and one fails, the other still attempts delivery.
- Report generation itself is never affected by delivery failures.

The `run-all` summary includes delivery status:

```
[1/3] Revenue by Payment     ... OK  (delivered: slack, email)
[2/3] Customer LTV           ... OK  (delivered: slack)
[3/3] Product Performance    ... OK  (delivery failed: email - 401 Unauthorized)

Total: 3 reports, 4.7 GB processed, $0.029
Delivered: 3 slack, 2 email (1 email failed)
```

---

## Example: Full Manifest with Delivery

```yaml
name: "Revenue by Payment Method"
description: "Weekly revenue breakdown by payment type with trend analysis"
created: 2026-03-28
last_run: 2026-03-29

parameters:
  - name: start_date
    type: date
    label: "Start Date"
    required: true
    default: "-7d"
  - name: end_date
    type: date
    label: "End Date"
    required: true
    default: "today"

delivery:
  slack:
    channels: ["C0123456789"]
  email:
    to: ["ceo@example.com", "marketing@example.com"]
    subject: "Weekly: Revenue by Payment Method"
    provider: "sendgrid"

config:
  merchant_id: "DEMO"
  project_id: "ultracart-dw-demo"
  taxonomy_level: "medium"
  dataset: "ultracart_dw"
  tables_used: ["uc_orders"]

sql_file: "query.sql"
chart:
  type: "stacked-bar"
  echarts_file: "chart.js"
  output_format: "png"
  width: 1200
  height: 600

analysis:
  include: true
  prompt_file: "analysis_prompt.md"
  output_file: "report.md"
  landscape: false
```
