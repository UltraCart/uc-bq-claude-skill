# Report Alarms

Alarms let you define conditions on your report data that trigger notifications when something needs attention. Instead of watching every report, configure alarms and get notified only when metrics cross thresholds or change unexpectedly -- management by exception.

---

## Why Alarms

You have 10 reports running on a weekly schedule. Most weeks, everything is fine. Without alarms, you're either reviewing every report manually (tedious) or ignoring them (risky). Alarms solve this by watching the data for you and only raising a signal when something's wrong.

- **Don't watch every report** -- silence means everything is fine
- **Catch problems early** -- revenue drops, zero orders, budget overruns
- **Same delivery channels** -- alarms go to the same Slack/email as your reports
- **Different signal** -- alarm notifications are visually distinct so recipients don't go report-blind
- **No extra infrastructure** -- alarms evaluate as part of the normal `uc-bq run` pipeline

---

## Quick Start

Add an alarm to an existing report:

```bash
uc-bq config add-alarm revenue-by-payment \
  --name "Revenue Drop" \
  --type pct_change \
  --metric total_revenue \
  --aggregate sum \
  --operator "<" \
  --value -20 \
  --severity high \
  --cooldown 24h
```

Run the report and alarms evaluate automatically:

```bash
uc-bq run revenue-by-payment --deliver
```

If revenue dropped more than 20% compared to the previous run, a distinct alarm notification fires to the report's configured delivery channels.

Test alarms against existing data without running the query or sending notifications:

```bash
uc-bq alarm test revenue-by-payment
```

---

## Alarm Types

### Threshold

Evaluates an aggregated metric against a static value.

```yaml
alarms:
  - name: "Low Revenue"
    type: threshold
    metric: "total_revenue"
    aggregate: "sum"
    operator: "<"
    value: 10000
    severity: critical
    cooldown: "24h"
```

**How it works:** Aggregates the `total_revenue` column from all rows in `data.json` using the specified function (sum, avg, min, max, first, last), then compares against the threshold value using the operator.

**Operators:** `<`, `>`, `<=`, `>=`, `==`, `!=`

**Aggregate functions:**

| Function | Description |
|----------|-------------|
| `sum` | Sum all values in the column (default) |
| `avg` | Average of all values |
| `min` | Minimum value |
| `max` | Maximum value |
| `first` | First row's value |
| `last` | Last row's value |

**Common examples:**

```yaml
# Alert if total orders drop below 50
- name: "Low Order Volume"
  type: threshold
  metric: "order_count"
  aggregate: "sum"
  operator: "<"
  value: 50
  severity: high
  cooldown: "24h"

# Alert if average order value exceeds $500 (possible fraud signal)
- name: "High AOV"
  type: threshold
  metric: "avg_order_value"
  aggregate: "avg"
  operator: ">"
  value: 500
  severity: high
  cooldown: "24h"

# Alert if any row has negative margin
- name: "Negative Margin"
  type: threshold
  metric: "margin"
  aggregate: "min"
  operator: "<"
  value: 0
  severity: critical
  cooldown: "24h"
```

### Percent Change

Compares an aggregated metric against the previous run's value.

```yaml
alarms:
  - name: "Revenue Drop"
    type: pct_change
    metric: "total_revenue"
    aggregate: "sum"
    operator: "<"
    value: -20
    compare_to: "previous_run"
    severity: high
    cooldown: "24h"
```

**How it works:** Aggregates the metric from the current run, then compares it as a percentage change from the most recent entry in `alarm_state.json`. A value of `-20` with operator `<` means "alert if revenue declined more than 20%."

**First run behavior:** On the first run (no previous data), percent change alarms are skipped -- there's nothing to compare against. The metric is recorded for future comparisons.

**Previous value of zero:** If the previous value was 0, any non-zero current value triggers the alarm (infinite percent change). If both are 0, the alarm does not trigger.

**Common examples:**

```yaml
# Alert if orders drop more than 30% from last run
- name: "Order Volume Drop"
  type: pct_change
  metric: "order_count"
  aggregate: "sum"
  operator: "<"
  value: -30
  compare_to: "previous_run"
  severity: critical
  cooldown: "24h"

# Alert if ad spend jumps more than 50%
- name: "Ad Spend Spike"
  type: pct_change
  metric: "total_spend"
  aggregate: "sum"
  operator: ">"
  value: 50
  compare_to: "previous_run"
  severity: high
  cooldown: "7d"
```

### Missing Data

Fires when the query returns zero rows or encounters an error.

```yaml
alarms:
  - name: "No Orders"
    type: missing_data
    severity: critical
    cooldown: "24h"
```

**How it works:** Checks if `data.json` has zero rows. No `metric`, `operator`, or `value` fields needed.

**Use cases:**
- Detect broken data pipelines (orders should never be zero for an active merchant)
- Catch SQL errors that silently return empty result sets
- Monitor for data freshness issues

---

## Severity Levels

Severity controls how aggressively the notification cuts through.

| Severity | Notification style | Mention/ping |
|----------|-------------------|--------------|
| `low` | Included in normal report delivery, no special formatting | No |
| `high` | Separate distinct alarm notification -- red Slack attachment, `[ALARM]` email subject | No |
| `critical` | Same as high, plus `mention_on_alarm` fires (e.g., `@channel`) | Yes |

Choose severity based on how urgently someone needs to act:

- **`low`** -- informational, worth noting but not urgent. "Ad spend is 10% above budget."
- **`high`** -- needs attention within the day. "Revenue dropped 25% week-over-week."
- **`critical`** -- act now. "Zero orders in the last 24 hours."

---

## Cooldown

Cooldown prevents the same alarm from firing repeatedly when a condition persists.

```yaml
cooldown: "24h"    # Don't re-fire within 24 hours (default)
cooldown: "7d"     # Weekly summary-level alarms
cooldown: "1h"     # High-frequency monitoring
cooldown: "0"      # Fire every time (no suppression)
```

**Supported units:** `h` (hours), `d` (days), `m` (minutes)

**How it works:**
1. Alarm triggers and fires a notification
2. `alarm_state.json` records the fire time
3. On subsequent runs within the cooldown window, the alarm evaluates as triggered but the notification is suppressed
4. Once the cooldown expires, the next trigger fires a notification

**Condition clears:** When the alarm condition returns to normal (metric recovers), the suppression state is reset. The next time the alarm triggers, it fires immediately regardless of cooldown.

**Default:** `24h` if not specified.

---

## Delivery Modes

Control when report deliveries happen relative to alarms.

```yaml
delivery:
  mode: "always"          # Default: deliver report normally regardless of alarms
  # mode: "alarm_only"    # Only deliver when alarms fire -- silence means all clear
  slack:
    channels: ["C0123456789"]
    mention_on_alarm: "@channel"
  email:
    to: ["ceo@example.com"]
    subject: "Weekly Revenue Report"
    provider: "sendgrid"
```

### `always` (default)

Reports deliver on every run as usual. If alarms fire, a separate alarm notification also sends. This is the standard behavior -- alarms are additive.

### `alarm_only`

Reports only deliver when alarms fire. No alarms = complete silence. This is true management by exception:

- Report runs on schedule, data refreshes, charts render, alarm_state updates
- If no alarms trigger: nothing is sent, nobody is bothered
- If an alarm triggers: the alarm notification fires, and the normal report delivery also sends

Use `alarm_only` for reports where the audience only needs to know when something's wrong.

### `mention_on_alarm`

Optional Slack-specific field. When a `critical` severity alarm fires, this mention is included in the notification (e.g., `@channel`, `@here`, or a specific user/group). For `low` and `high` severity alarms, the mention is not used.

```bash
uc-bq config set-mention-on-alarm revenue-by-payment "@channel"
```

---

## Alarm State

Alarm state is tracked in `alarm_state.json` in each report's directory, separate from `report.yaml`:

```
reports/DEMO/revenue-by-payment/
├── report.yaml          # Alarm definitions (versioned)
├── query.sql
├── chart.js
├── alarm_state.json     # Alarm state (separate from definitions)
├── data.json            # Generated
└── chart.png            # Generated
```

### What it tracks

```json
{
  "metric_history": [
    {
      "run_date": "2026-03-29",
      "parameters": { "start_date": "2026-01-01", "end_date": "2026-03-29" },
      "metrics": { "total_revenue": 47230.50, "order_count": 312 },
      "alarms_triggered": ["Revenue Drop"]
    }
  ],
  "suppression": {
    "Revenue Drop": {
      "last_fired": "2026-03-29T14:30:00.000Z",
      "consecutive_fires": 3
    }
  }
}
```

- **`metric_history`** -- aggregated metric values from each run, used for percent change comparisons. Capped at 30 entries.
- **`suppression`** -- per-alarm fire tracking for cooldown. Cleared when the alarm condition returns to normal.

### Git strategy

`alarm_state.json` is separate from `report.yaml` so alarm state changes don't pollute your report definition diffs. Whether to commit it depends on your setup:

- **Local development** -- gitignore it. State persists on your machine.
- **GitHub Actions** -- commit it back after each run so state persists across workflow executions. Alternatively, use GitHub Actions artifact caching.

Add to `.gitignore` if you don't want to track it:

```
reports/**/alarm_state.json
```

---

## Deck Alarms

When a deck runs multiple reports, alarms from each report are aggregated into a single deck-level alarm notification.

```
Deck: Weekly Executive Briefing
  [1/3] Revenue by Payment Method ... OK
    ⚠ ALARM [HIGH] Revenue Drop: total_revenue changed -23.4% (47230 → 36189)
  [2/3] Customer LTV ................. OK
  [3/3] Product Performance .......... OK
    ⚠ ALARM [CRITICAL] No Orders: Query returned zero rows
```

If the deck has delivery configured:
- All alarm notifications aggregate into a single alarm message sent to the deck's delivery channels
- The alarm message lists which reports triggered which alarms
- Normal deck PDF delivery follows (unless `alarm_only` mode, in which case the deck PDF only delivers when alarms fire)

Set deck delivery mode via CLI:

```bash
uc-bq config set-deck-delivery-mode weekly-executive alarm_only
```

---

## CLI Reference

### Adding alarms

```bash
# Threshold alarm
uc-bq config add-alarm revenue-by-payment \
  --name "Low Revenue" \
  --type threshold \
  --metric total_revenue \
  --aggregate sum \
  --operator "<" \
  --value 10000 \
  --severity critical \
  --cooldown 24h

# Percent change alarm
uc-bq config add-alarm revenue-by-payment \
  --name "Revenue Drop" \
  --type pct_change \
  --metric total_revenue \
  --aggregate sum \
  --operator "<" \
  --value -20 \
  --severity high \
  --cooldown 24h

# Missing data alarm
uc-bq config add-alarm revenue-by-payment \
  --name "No Orders" \
  --type missing_data \
  --severity critical \
  --cooldown 24h
```

### Viewing and removing alarms

```bash
# List all alarms on a report
uc-bq config show-alarms revenue-by-payment

# Remove a specific alarm
uc-bq config remove-alarm revenue-by-payment "Revenue Drop"
```

### Delivery mode and mentions

```bash
# Set delivery mode (always or alarm_only)
uc-bq config set-delivery-mode revenue-by-payment alarm_only

# Set deck delivery mode
uc-bq config set-deck-delivery-mode weekly-executive alarm_only

# Set Slack mention for critical alarms
uc-bq config set-mention-on-alarm revenue-by-payment "@channel"
```

### Testing and inspecting

```bash
# Test alarms against current data.json (no query, no delivery)
uc-bq alarm test revenue-by-payment

# View alarm history
uc-bq alarm history revenue-by-payment
```

### Run flags

```bash
# Normal run -- alarms evaluate automatically if defined
uc-bq run revenue-by-payment --deliver

# Skip alarm evaluation
uc-bq run revenue-by-payment --deliver --skip-alarms

# Run all reports with alarms
uc-bq run-all --deliver

# Run deck with alarms
uc-bq deck run weekly-executive --deliver
```

---

## Recipes

### Alert me if daily revenue drops more than 20%

```yaml
alarms:
  - name: "Revenue Drop"
    type: pct_change
    metric: "total_revenue"
    aggregate: "sum"
    operator: "<"
    value: -20
    compare_to: "previous_run"
    severity: high
    cooldown: "24h"
```

### Only notify me when something's wrong

```yaml
delivery:
  mode: "alarm_only"
  slack:
    channels: ["C0123456789"]
    mention_on_alarm: "@channel"

alarms:
  - name: "Revenue Below $10K"
    type: threshold
    metric: "total_revenue"
    aggregate: "sum"
    operator: "<"
    value: 10000
    severity: critical
    cooldown: "24h"
```

The report runs on schedule but Slack stays silent unless revenue dips below $10K.

### Monitor for zero orders in a category

```yaml
alarms:
  - name: "No Orders"
    type: missing_data
    severity: critical
    cooldown: "24h"
```

### Weekly deck with critical alarm escalation

```yaml
# Deck YAML
delivery:
  mode: "alarm_only"
  slack:
    channels: ["C0123456789"]
    mention_on_alarm: "@here"
  email:
    to: ["ceo@example.com"]
    subject: "Weekly Executive Briefing"
    provider: "sendgrid"
```

The deck runs every Monday. If any report triggers an alarm, the team gets an aggregated alarm notification with `@here` for critical alarms, plus the full deck PDF. If everything's fine, nobody hears from it.

### Multiple alarms on one report

```yaml
alarms:
  - name: "Revenue Drop"
    type: pct_change
    metric: "total_revenue"
    aggregate: "sum"
    operator: "<"
    value: -20
    compare_to: "previous_run"
    severity: high
    cooldown: "24h"

  - name: "Low Revenue"
    type: threshold
    metric: "total_revenue"
    aggregate: "sum"
    operator: "<"
    value: 10000
    severity: critical
    cooldown: "24h"

  - name: "No Data"
    type: missing_data
    severity: critical
    cooldown: "24h"
```

All three evaluate independently. If multiple alarms fire, all are included in one notification.

---

## GitHub Actions

Alarms work in GitHub Actions with no changes to your workflow. They evaluate as part of the normal `uc-bq run` pipeline.

### Basic workflow with alarms

```yaml
name: Daily Alarm Check

on:
  schedule:
    - cron: '0 12 * * *'  # Every day at noon UTC
  workflow_dispatch:

jobs:
  reports:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g @ultracart/bq-skill

      - uses: google-github-actions/auth@v2
        with: { credentials_json: '${{ secrets.GCP_SA_KEY }}' }

      - name: Run reports and check alarms
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          EMAIL_FROM: ${{ vars.EMAIL_FROM }}
          SENDGRID_API_KEY: ${{ secrets.SENDGRID_API_KEY }}
        run: uc-bq run-all --deliver --no-analysis

      - name: Commit alarm state
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add reports/**/alarm_state.json
          git diff --cached --quiet || git commit -m "Update alarm state [skip ci]"
          git push
```

The "Commit alarm state" step persists `alarm_state.json` back to the repo so percent change comparisons and cooldown tracking work across workflow runs.

### alarm_only with GitHub Actions

For a pure "alert me when something's wrong" setup:

1. Set `delivery.mode: alarm_only` on your reports
2. Configure alarms on each report
3. Schedule the workflow to run as frequently as you want checks (daily, hourly)
4. Slack/email stay silent unless an alarm fires

```yaml
      - name: Run alarm-only reports
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
        run: uc-bq run-all --deliver --no-analysis
```

No analysis, no PDF -- just query the data, check alarms, and notify if something's wrong.

---

## Execution Flow

Alarms are a post-run evaluation phase in the existing pipeline:

```
run query → write data.json → render chart → evaluate alarms → update alarm_state.json → generate analysis → deliver
```

1. Report query executes normally
2. `data.json` is written
3. Chart renders
4. **Alarm evaluation:** each alarm checks data.json against its condition
5. **State update:** metrics and fire events recorded to `alarm_state.json`
6. **Alarm notifications:** fired alarms send distinct notifications to delivery channels
7. Analysis generates (if enabled)
8. PDF generates
9. Normal report delivery (subject to delivery mode)
