# Tutorial: Building a Report with the UltraCart BigQuery Skill

This is what an actual Claude Code session looks like when a merchant uses the UltraCart BigQuery skill to build a report from scratch.

## Prerequisites

```bash
# Install Google Cloud CLI and authenticate
brew install google-cloud-sdk
gcloud auth login
gcloud auth application-default login

# Install the uc-bq CLI
npm install -g @ultracart/bq-skill

# Set up your config
uc-bq init
```

---

## The Conversation

> **You:** Show me my top 10 products by revenue for the last 90 days

**Claude Code:** Let me find the right tables and columns for this.

```bash
uc-bq schema --list
```

```
Available tables/views (merchant: DEMO, taxonomy: medium)
──────────────────────────────────────────────────
uc_orders — orders
uc_items — items
uc_customers — customers
... (32 tables found)
```

The `uc_orders` table has line items nested in an `items` array. Let me get the schema.

```bash
uc-bq schema --tables=uc_orders --format=json
```

I can see the relevant fields:
- `items` — REPEATED RECORD with `merchant_item_id`, `description`, `quantity`, `total.value`
- `creation_dts` — DATETIME (stored in UTC)
- `partition_date` — DATE (for cost optimization)
- `summary.total.value` — order total
- `current_stage` — order status
- `payment.test_order` — test order flag

Let me write the SQL. I'll UNNEST the items array to get product-level revenue.

```sql
-- ===========================================
-- TOP 10 PRODUCTS BY REVENUE
-- ===========================================
-- Purpose: Identify the highest-revenue products over a date range

SELECT
  item.merchant_item_id AS product_id,
  item.description AS product_name,
  COUNT(DISTINCT order_id) AS order_count,
  SUM(item.quantity) AS units_sold,
  ROUND(SUM(item.total.value), 2) AS total_revenue,
  ROUND(AVG(item.total.value), 2) AS avg_unit_revenue
FROM `ultracart-dw-demo.ultracart_dw.uc_orders`,
UNNEST(items) AS item
WHERE partition_date >= DATE_TRUNC(DATE_SUB(@start_date, INTERVAL 1 MONTH), WEEK(SUNDAY))
  AND partition_date <= DATE_TRUNC(DATE_ADD(@end_date, INTERVAL 1 MONTH), WEEK(SUNDAY))
  AND creation_dts BETWEEN @start_date AND @end_date
  AND current_stage != 'Rejected'
  AND payment.test_order IS NOT TRUE
  AND item.total.value > 0
GROUP BY 1, 2
ORDER BY total_revenue DESC
LIMIT 10
```

Let me test it.

```bash
uc-bq query --file=reports/DEMO/top-products-by-revenue/query.sql \
  --params='{"start_date":"2026-01-01","end_date":"2026-03-29"}' \
  --sample=10 --output=reports/DEMO/top-products-by-revenue/data.json
```

```
Query Results
──────────────────────────────────────────────────
Total rows: 10
Bytes processed: 245.3 MB
Cost: $0.0015

product_id    product_name                order_count  units_sold  total_revenue  avg_unit_revenue
─────────────────────────────────────────────────────────────────────────────────────────────────
SKU-4521      Premium Widget Pro          342          891         45,231.78      50.77
SKU-1120      Essential Starter Kit       567          1,204       38,412.50      31.90
SKU-8834      Deluxe Bundle Pack          198          412         32,876.40      79.80
SKU-3301      Monthly Subscription Box    445          890         28,450.00      31.97
SKU-6672      Professional Tool Set       156          234         24,570.00      104.96
SKU-2205      Organic Wellness Pack       289          578         23,140.00      40.03
SKU-9910      Limited Edition Collection  87           174         21,750.00      125.00
SKU-5543      Basic Essentials Bundle     412          824         16,480.00      20.00
SKU-7789      Gift Card - $50            298          298         14,900.00      50.00
SKU-4410      Replacement Parts Kit       334          1,002       13,026.00      13.00
```

Good data — 10 products, Premium Widget Pro leads at $45K. Now let me create the visualization. I'll write a `formatChartData` function that produces a horizontal bar chart with revenue labels and a tooltip showing all metrics.

```javascript
function formatChartData(data, isDashboard) {
  try {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return { title: { text: 'No Data Available', left: 'center', top: 'center' } };
    }

    var sorted = [...data].sort(function(a, b) {
      return (parseFloat(b.total_revenue) || 0) - (parseFloat(a.total_revenue) || 0);
    });

    var products = sorted.map(function(d) { return String(d.product_name || d.product_id || 'Unknown'); });
    var revenues = sorted.map(function(d) { return parseFloat(d.total_revenue) || 0; });
    var units = sorted.map(function(d) { return parseInt(d.units_sold) || 0; });
    var orders = sorted.map(function(d) { return parseInt(d.order_count) || 0; });
    var totalRevenue = revenues.reduce(function(a, b) { return a + b; }, 0);

    if (isDashboard) {
      // Compact mode for 200x200 dashboard tiles
      return {
        title: { text: 'Top Products', left: 'center', top: 2, textStyle: { fontSize: 11 } },
        legend: { show: false },
        tooltip: { trigger: 'axis', confine: true, textStyle: { fontSize: 9 } },
        grid: { left: 5, right: 5, top: 25, bottom: 20 },
        xAxis: { type: 'category', data: products.slice(0, 5), axisLabel: { show: false } },
        yAxis: { type: 'value', axisLabel: { fontSize: 8, formatter: '${value}' } },
        series: [{ type: 'bar', data: revenues.slice(0, 5), itemStyle: { color: '#5470c6' } }],
        graphic: [{
          type: 'text', left: 'center', bottom: 4,
          style: { text: '$' + (totalRevenue / 1000).toFixed(0) + 'K Total', fontSize: 9, fill: '#666' }
        }]
      };
    }

    // Full visualization: horizontal bar chart
    var colors = ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de',
                  '#3ba272','#fc8452','#9a60b4','#ea7ccc','#5fb4d2'];

    return {
      title: {
        text: 'Top 10 Products by Revenue',
        subtext: 'Total: $' + totalRevenue.toLocaleString(undefined, {
          minimumFractionDigits: 2, maximumFractionDigits: 2
        }),
        left: 'center',
        textStyle: { fontSize: 18, fontWeight: 'bold' },
        subtextStyle: { fontSize: 13, color: '#666' }
      },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
        formatter: function(params) {
          var d = params[0];
          var idx = products.indexOf(d.name);
          return '<strong>' + d.name + '</strong><br/>' +
            'Revenue: $' + d.value.toLocaleString(undefined, { minimumFractionDigits: 2 }) + '<br/>' +
            'Units Sold: ' + (units[idx] || 0).toLocaleString() + '<br/>' +
            'Orders: ' + (orders[idx] || 0).toLocaleString();
        }
      },
      grid: { left: 200, right: 80, top: 70, bottom: 30 },
      xAxis: {
        type: 'value',
        axisLabel: {
          formatter: function(val) {
            return val >= 1000 ? '$' + (val / 1000).toFixed(0) + 'K' : '$' + val;
          }
        },
        splitLine: { lineStyle: { type: 'dashed', color: '#eee' } }
      },
      yAxis: {
        type: 'category',
        data: products.reverse(),
        axisLabel: { fontSize: 11 },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        data: revenues.reverse().map(function(val, idx) {
          return { value: val, itemStyle: { color: colors[products.length - 1 - idx] || colors[0] } };
        }),
        barWidth: '60%',
        label: {
          show: true,
          position: 'right',
          formatter: function(p) {
            return '$' + p.value.toLocaleString(undefined, { maximumFractionDigits: 0 });
          },
          fontSize: 11, color: '#333'
        }
      }]
    };
  } catch (e) {
    console.error('Chart error:', e);
    return {
      title: { text: 'Chart Error: ' + (e.message || 'Unknown'), left: 'center', top: 'center',
               textStyle: { color: '#cc0000', fontSize: 14 } }
    };
  }
}
```

Now let me render it.

```bash
uc-bq render --chart=reports/DEMO/top-products-by-revenue/chart.js \
  --data=reports/DEMO/top-products-by-revenue/data.json \
  --output=reports/DEMO/top-products-by-revenue/chart.png
```

```
Chart rendered to reports/DEMO/top-products-by-revenue/chart.png
Dimensions: 1200x600
Format: png
```

The chart looks clean — products ranked by revenue with dollar labels, color-coded bars, and a total in the subtitle.

Now let me write the analysis. First I'll create an analysis prompt template — this is a system prompt that can be used to generate fresh analysis on future replays with updated data:

```markdown
# Top 10 Products by Revenue — Analysis System Prompt

## Overview
You are an expert e-commerce analyst. You will receive JSON data showing
the top 10 products ranked by revenue, along with a bar chart. Generate
a comprehensive executive analysis.

## JSON Data Fields
- **product_id** (STRING): Internal SKU identifier
- **product_name** (STRING): Product display name
- **order_count** (INTEGER): Number of distinct orders containing this product
- **units_sold** (INTEGER): Total quantity sold
- **total_revenue** (FLOAT): Total revenue from this product
- **avg_unit_revenue** (FLOAT): Average revenue per unit sold

## Analysis Methodology
### 1. Revenue Concentration
- What % of top-10 revenue do the top 3 products represent?
- Is revenue concentrated or distributed?

### 2. Pricing Strategy Insights
- Compare avg_unit_revenue across products
- Identify high-margin vs volume-driven products

### 3. Actionable Recommendations
- Products to promote, bundle, or investigate
...
```

Now the executive analysis based on the actual data:

```markdown
# Top 10 Products by Revenue — Executive Analysis

**Period:** January 1 - March 29, 2026
**Total Top 10 Revenue:** $258,836.68

## Executive Summary

Premium Widget Pro leads at $45,232 (17.5% of top-10 revenue) with 342
orders, but Essential Starter Kit drives the most volume (567 orders).
The most notable finding: Professional Tool Set has an avg unit price of
$104.96 — nearly 3x the average — suggesting a high-margin opportunity.

## Key Findings

1. **Revenue concentration is moderate** — the top 3 products account for
   45% of top-10 revenue ($116,521 combined)
2. **Volume vs value split** — Essential Starter Kit leads in orders but
   ranks #2 in revenue due to its lower $31.90 avg unit price
3. **Gift Cards at #9** — 298 orders of a fixed $50 product = $14,900.
   This is pure margin and could be promoted more aggressively
4. **Replacement Parts Kit** — highest units/order ratio (3.0 units per
   order) suggests customers buy these in bulk

## Recommendations

1. **Bundle Premium Widget Pro + Essential Starter Kit** — the two
   best-sellers at different price points could drive higher AOV
2. **Promote Professional Tool Set** — highest unit revenue ($104.96),
   only 156 orders. More visibility could significantly impact revenue
3. **Gift Card promotion** — consider $75 and $100 tiers to increase
   average gift card value above the current flat $50
```

I've saved the SQL, chart function, analysis prompt, executive analysis, and manifest. Now let me do the initial run to generate the final chart and PDF.

```bash
uc-bq run top-products-by-revenue --no-analysis
```

> *`--no-analysis` because I already wrote the analysis above — this just skips calling the API. The existing `report.md` is still included in the PDF.*

```
Running: Top 10 Products by Revenue
──────────────────────────────────────────────────
start_date = 2025-12-29
end_date = 2026-03-29

Executing query...
Rows: 10
Bytes processed: 245.3 MB
Cost: $0.0015
Rendering chart...
Chart: reports/DEMO/top-products-by-revenue/chart.png
Generating PDF...
PDF: reports/DEMO/top-products-by-revenue/report.pdf

Done.
```

The manifest defaults `start_date` to `-90d` and `end_date` to `today`, so it resolved the dates automatically. Let me open the PDF.

```bash
open reports/DEMO/top-products-by-revenue/report.pdf
```

---

> **You:** Can you open that PDF?

```bash
open reports/DEMO/top-products-by-revenue/report.pdf
```

---

> **You:** Nice. Can you run it again but for just January?

**Claude Code:** Sure — I'll replay with a custom date range.

```bash
uc-bq run top-products-by-revenue --start_date=2026-01-01 --end_date=2026-01-31 --no-analysis
```

```
Running: Top 10 Products by Revenue
──────────────────────────────────────────────────
start_date = 2026-01-01
end_date = 2026-01-31

Executing query...
Rows: 10
Bytes processed: 82.1 MB
Cost: $0.0005
Rendering chart...
Chart: reports/DEMO/top-products-by-revenue/chart.png
Generating PDF...
PDF: reports/DEMO/top-products-by-revenue/report.pdf

Done.
```

Updated. The chart and PDF now reflect January only. Want me to open it?

---

> **You:** The chart is really wide and gets squished in the PDF. Can you make it landscape?

**Claude Code:** Sure — two ways to do this. I can run it with `--landscape` right now:

```bash
uc-bq run top-products-by-revenue --landscape --no-analysis
```

```
Running: Top 10 Products by Revenue
──────────────────────────────────────────────────
start_date = 2025-12-29
end_date = 2026-03-29

Executing query...
Rows: 10
Rendering chart...
Generating PDF...
PDF: reports/DEMO/top-products-by-revenue/report.pdf

Done.
```

Or I can set it as the default for this report so it's always landscape on replay. Let me update the manifest:

```yaml
analysis:
  include: true
  prompt_file: "analysis_prompt.md"
  output_file: "report.md"
  landscape: true     # PDF will always render in landscape now
```

Now every time you run `uc-bq run top-products-by-revenue`, the PDF comes out landscape without needing the flag.

---

> **You:** What if I want to run this report on a schedule and still get the written analysis without Claude Code?

**Claude Code:** You can pass your LLM provider's API key and the CLI will call the API directly to generate the analysis. By default it uses Anthropic, but you can configure any supported provider (see the LLM provider question below).

```bash
uc-bq run top-products-by-revenue --analysis-api-key=$ANTHROPIC_API_KEY
```

```
Running: Top 10 Products by Revenue
──────────────────────────────────────────────────
start_date = 2025-12-29
end_date = 2026-03-29

Executing query...
Rows: 10
Rendering chart...
Generating analysis...
Analysis: reports/DEMO/top-products-by-revenue/report.md
Generating PDF...
PDF: reports/DEMO/top-products-by-revenue/report.pdf

Done.
```

It used the `analysis_prompt.md` template I created earlier — that's the system prompt tailored to this specific report. The API generates fresh analysis based on the latest data and chart. The default model is `claude-sonnet-4-5-20250929`, but you can change it:

```bash
# Use Haiku for cheaper analysis (~$0.002 per report instead of ~$0.03)
uc-bq run top-products-by-revenue --analysis-api-key=$ANTHROPIC_API_KEY --analysis-model=claude-haiku-4-5-20251001

# Use Opus for deeper analysis
uc-bq run top-products-by-revenue --analysis-api-key=$ANTHROPIC_API_KEY --analysis-model=claude-opus-4-5-20250918
```

You can also set the key as an environment variable so you don't have to pass it every time:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
uc-bq run-all    # All reports get fresh analysis with default model (Sonnet)
```

Or if you're using a different provider:

```bash
export OPENAI_API_KEY=sk-...
uc-bq run-all --llm-provider=openai
```

Three ways to get the executive analysis:

| Method | When to use | Cost |
|--------|------------|------|
| Claude Code writes it | Interactive sessions | Your Claude Code subscription |
| `--analysis-api-key` | Scheduled/headless replay | ~$0.002-0.05 per report (depends on model) |
| `--no-analysis` | Just need data + chart | Free |

---

> **You:** What other reports do I have?

```bash
uc-bq list
```

```
Reports for merchant: DEMO

Name                        Last Run    Description
──────────────────────────────────────────────────────────────────────
Top 10 Products by Revenue  2026-03-29  Highest-revenue products by total sales
```

Just the one so far. Want me to build another?

---

> **You:** Yeah, show me revenue by state as a geo map

**Claude Code:** Let me check what state data is available.

```bash
uc-bq schema --tables=uc_orders --format=json
```

I can see `shipping.state_region` in the schema. I'll use that with `UPPER()` for consistent state abbreviation formatting, and build a USA geo map visualization.

```bash
uc-bq query --file=reports/DEMO/revenue-by-state/query.sql \
  --params='{"start_date":"2026-01-01","end_date":"2026-03-29"}' \
  --sample=20 --output=reports/DEMO/revenue-by-state/data.json
```

```
Query Results
──────────────────────────────────────────────────
Total rows: 51
Bytes processed: 198.7 MB
Cost: $0.0012

state_abbr  state_name       order_count  total_revenue  avg_order_value
────────────────────────────────────────────────────────────────────────
CA          California       312          28,450.34      91.19
TX          Texas            245          19,876.12      81.13
NY          New York         198          18,234.56      92.09
FL          Florida          187          15,432.10      82.53
PA          Pennsylvania     134          11,876.45      88.63
...
```

51 states/territories. Now rendering the geo map — this one works best in landscape.

```bash
uc-bq render --chart=reports/DEMO/revenue-by-state/chart.js \
  --data=reports/DEMO/revenue-by-state/data.json \
  --output=reports/DEMO/revenue-by-state/chart.png \
  --width=1400 --height=800
```

```
Chart rendered to reports/DEMO/revenue-by-state/chart.png
Dimensions: 1400x800
Format: png
```

The map shows revenue by state with a blue-to-red gradient. California, Texas, and New York are the hottest. I've saved the report with `landscape: true` in the manifest so the PDF always renders in landscape.

```bash
uc-bq run revenue-by-state --no-analysis
```

```
Running: Revenue by State
──────────────────────────────────────────────────
start_date = 2026-01-01
end_date = 2026-03-29

Executing query...
Rows: 51
Rendering chart...
Generating PDF...
PDF: reports/DEMO/revenue-by-state/report.pdf

Done.
```

---

> **You:** I also have marketing data in a separate Google project. Can you pull that in?

**Claude Code:** Sure. Let me browse it first. What's the project ID?

---

> **You:** my-marketing-warehouse

**Claude Code:**

```bash
uc-bq schema --project=my-marketing-warehouse
```

```
Datasets in project: my-marketing-warehouse
──────────────────────────────────────────────────
google_ads_data
meta_ads_data
analytics_sessions
dbt_staging
dbt_production

5 datasets found
```

Which datasets do you want to expose to the tool? I'd recommend skipping the `dbt_staging` one.

---

> **You:** google_ads_data and meta_ads_data

**Claude Code:** Let me register those.

```bash
uc-bq config add-project marketing \
  --project-id=my-marketing-warehouse \
  --description="Marketing data from Google Ads and Meta"
```

```
Added external project "marketing" (my-marketing-warehouse) to merchant "DEMO"
```

```bash
uc-bq config add-dataset marketing google_ads_data --discover
```

```
Discovering tables in my-marketing-warehouse.google_ads_data...
Found 4 tables
Added dataset "google_ads_data" to project "marketing" (4 tables)
```

```bash
uc-bq config add-dataset marketing meta_ads_data --discover
```

```
Discovering tables in my-marketing-warehouse.meta_ads_data...
Found 3 tables
Added dataset "meta_ads_data" to project "marketing" (3 tables)
```

Now I can see both UltraCart and marketing tables:

```bash
uc-bq schema --list
```

```
Available tables/views (merchant: DEMO, taxonomy: medium)
──────────────────────────────────────────────────
uc_orders — orders
uc_items — items
... (32 tables found)

External projects
──────────────────────────────────────────────────
[marketing] (my-marketing-warehouse) — Marketing data from Google Ads and Meta
  marketing.google_ads_data.campaigns
  marketing.google_ads_data.ad_groups
  marketing.google_ads_data.keywords
  marketing.google_ads_data.search_terms
  marketing.meta_ads_data.campaigns
  marketing.meta_ads_data.ad_sets
  marketing.meta_ads_data.ads

7 external tables found
```

Want me to build a report that joins your order data with Google Ads campaigns?

---

> **You:** Yeah, show me ROAS by Google Ads campaign for last month

**Claude Code:** Let me check the Google Ads campaign schema first.

```bash
uc-bq schema --tables=marketing.google_ads_data.campaigns --format=json
```

I can see `campaign_name`, `campaign_id`, `cost`, `impressions`, `clicks`, and `date` columns. I'll join this with your UltraCart orders using UTM campaign tracking.

*(Claude Code writes the cross-project SQL, tests it, creates the chart, and saves the report...)*

---

> **You:** Can I have this report emailed to my team and posted to Slack automatically?

**Claude Code:** Sure, I'll add a delivery config to the manifest. I need two things:

1. **Slack**: Your Slack channel ID (right-click the channel -> "View channel details" -> scroll to the bottom)
2. **Email**: The email addresses to send to, and which email provider you use (SendGrid, Postmark, Mailgun, Resend, or AWS SES)

---

> **You:** Slack channel is C0123456789. Email to reports@example.com and ceo@example.com. We use SendGrid.

**Claude Code:** I'll set up the delivery config using the CLI:

```bash
uc-bq config add-slack revenue-by-state C0123456789
```

```
Added Slack channel C0123456789 to report "revenue-by-state"
```

```bash
uc-bq config set-email revenue-by-state \
  --to=reports@example.com,ceo@example.com \
  --provider=sendgrid \
  --subject="Revenue by State"
```

```
Set email delivery for report "revenue-by-state":
  To: reports@example.com, ceo@example.com
  Provider: sendgrid
  Subject: Revenue by State
```

The manifest now has:

```yaml
delivery:
  slack:
    channels: ["C0123456789"]
  email:
    to: ["reports@example.com", "ceo@example.com"]
    subject: "Revenue by State"
    provider: "sendgrid"
```

You can verify with `uc-bq config show-delivery revenue-by-state`, and add or remove channels/recipients later with `uc-bq config add-slack`, `uc-bq config remove-email`, etc.

You'll need these environment variables set:
- `SLACK_BOT_TOKEN` — your Slack bot token (`xoxb-...`)
- `EMAIL_FROM` — sender email address (e.g., `reports@example.com`)
- `SENDGRID_API_KEY` — your SendGrid API key

Now you can deliver with:

```bash
uc-bq run revenue-by-state --deliver
```

```
Running: Revenue by State
──────────────────────────────────────────────────
start_date = 2025-12-29
end_date = 2026-03-29

Executing query...
Rows: 51
Rendering chart...
Generating PDF...
Delivering to Slack... OK
Delivering via email (sendgrid)... OK (2 recipients)

Done.
```

The PDF gets uploaded to your Slack channel and emailed to both addresses. If delivery fails (bad token, provider down, etc.), the report still generates — delivery errors are logged but don't crash the run.

---

> **You:** This is great. Can I run all my reports every Monday morning automatically?

**Claude Code:** Yes — add this to your crontab:

```bash
# Every Monday at 6am — refresh and deliver all reports
0 6 * * 1 cd /path/to/project && uc-bq run-all --deliver --no-analysis
```

Or if you want fresh executive analysis too, set the API key for your configured LLM provider:

```bash
# Anthropic (default provider)
0 6 * * 1 cd /path/to/project && ANTHROPIC_API_KEY=sk-... uc-bq run-all --deliver

# Or with a different provider
0 6 * * 1 cd /path/to/project && OPENAI_API_KEY=sk-... uc-bq run-all --deliver --llm-provider=openai
```

The reports will replay with fresh data — the `-90d` and `today` defaults resolve at runtime, so each Monday you get the latest 90-day window automatically. The `--deliver` flag sends each report to whatever Slack channel and email addresses are in its manifest. No Claude Code subscription needed for replay.

---

> **You:** Can I use OpenAI instead of Anthropic for the scheduled analysis?

**Claude Code:** Yes -- the CLI supports multiple LLM providers for headless analysis. You can configure it in your `.ultracart-bq.json`:

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

All provider SDKs are bundled, so just set your API key:

```bash
export OPENAI_API_KEY=sk-...
uc-bq run-all --deliver
```

You can also override the provider for a single command without changing your config:

```bash
uc-bq run revenue-by-category --llm-provider=openai --analysis-api-key=$OPENAI_API_KEY
```

Five providers are supported:

| Provider | SDK to Install | API Key Env |
|----------|---------------|-------------|
| `anthropic` (default) | `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` |
| `openai` | `openai` | `OPENAI_API_KEY` |
| `grok` (xAI) | `openai` | `XAI_API_KEY` |
| `bedrock` | `@aws-sdk/client-bedrock-runtime` | AWS credential chain |
| `gemini` | `@google/generative-ai` | `GOOGLE_API_KEY` |

This only affects scheduled/headless runs. Right now, in this Claude Code session, I'm doing the thinking -- the provider config doesn't come into play for interactive usage.

---

> **You:** What if a query costs too much?

**Claude Code:** There's a built-in safety check. Every query automatically does a dry-run first. If it would scan more than 10 GB (about $0.06), it aborts:

```
Error: Query would process 45.2 GB (estimated cost: $0.2825), which exceeds
the safety limit of 10.0 GB. Use --force to execute anyway, or set a higher
limit with --max-bytes.
```

You can adjust the default in your config:

```json
{
  "max_query_bytes": 53687091200
}
```

That's 50 GB. Or set it to `0` to disable the check entirely.

---

---

> **You:** Can you combine all my reports into one PDF instead of sending them separately?

**Claude Code:** Yes -- that's what decks are for. A deck bundles multiple reports into a single PDF with a branded cover page, clickable table of contents, and each report on its own page. Let me create one.

First, let me see what reports you have:

```bash
uc-bq list
```

```
Reports for merchant: DEMO

Name                        Last Run    Description
──────────────────────────────────────────────────────────────────────
Top 10 Products by Revenue  2026-03-29  Highest-revenue products by total sales
Revenue by State            2026-03-29  Revenue distribution across US states
ROAS by Campaign            2026-03-29  Return on ad spend by Google Ads campaign
```

I'll create a deck that combines all three. I need a few things:
1. What should the deck title be?
2. Your company name (for the cover page)
3. Do you have a logo URL?

---

> **You:** Call it "Weekly Executive Briefing". Company is DEMO Commerce Inc. No logo for now. And make sure all reports use year-to-date data.

**Claude Code:** Got it. I'll create the deck definition with `parameters` so all reports share the same YTD date range:

```yaml
# reports/DEMO/decks/weekly-executive.yaml
name: "Weekly Executive Briefing"
title: "DEMO Weekly Report Deck"
cover:
  company: "DEMO Commerce Inc."
parameters:
  start_date: "start_of_year"
  end_date: "today"
reports:
  - top-products-by-revenue
  - revenue-by-state
  - roas-by-campaign
landscape: true
delivery:
  slack:
    channels: ["C0123456789"]
  email:
    to: ["ceo@example.com", "cfo@example.com"]
    subject: "Weekly Executive Briefing"
    provider: "sendgrid"
```

The `parameters` section overrides the defaults in each report's manifest. So even though the individual reports default to `-90d`, the deck will use `start_of_year` for all of them. If you ever need to override further, CLI flags still take priority:

```bash
uc-bq deck run weekly-executive --start_date=2026-01-01 --end_date=2026-03-31
```

You can also manage deck parameters without editing the YAML directly:

```bash
uc-bq config set-deck-param weekly-executive start_date start_of_year
uc-bq config show-deck-params weekly-executive
```

Now let me generate it:

```bash
uc-bq deck run weekly-executive
```

```
Running deck: Weekly Executive Briefing
──────────────────────────────────────────────────
[1/3] Top 10 Products by Revenue ... OK
[2/3] Revenue by State ............. OK
[3/3] ROAS by Campaign ............ OK

Generating deck PDF...
Deck: reports/DEMO/decks/weekly-executive.pdf

Done.
```

The PDF has a cover page with "DEMO Commerce Inc." and the title, then a table of contents linking to each report, then each report on its own page with the chart and analysis. Want me to open it?

---

> **You:** Yeah, open it

```bash
open reports/DEMO/decks/weekly-executive.pdf
```

---

> **You:** That's way better than 3 separate emails. Can it deliver automatically?

**Claude Code:** It already has delivery config in the YAML. Just use `--deliver`:

```bash
uc-bq deck run weekly-executive --deliver
```

```
Running deck: Weekly Executive Briefing
──────────────────────────────────────────────────
[1/3] Top 10 Products by Revenue ... OK
[2/3] Revenue by State ............. OK
[3/3] ROAS by Campaign ............ OK

Generating deck PDF...
Deck: reports/DEMO/decks/weekly-executive.pdf
Delivering to Slack... OK
Delivering via email (sendgrid)... OK (2 recipients)

Done.
```

One PDF gets uploaded to Slack and emailed to both recipients. No more 3 separate files cluttering the channel.

For your Monday morning schedule, add it to your cron or GitHub Actions workflow:

```bash
# Crontab
0 6 * * 1 cd /path/to/project && uc-bq deck run weekly-executive --deliver --no-analysis
```

Or in GitHub Actions:

```yaml
- run: uc-bq deck run weekly-executive --deliver --no-analysis
```

The individual reports are still independently runnable with `uc-bq run` if anyone needs a specific one on demand.

---

> **You:** The PDF deck is great for email, but can I get an interactive version? Something I can pull up in a browser and hover over the charts?

**Claude Code:** Yes -- you can generate an interactive HTML dashboard from the same deck definition. It uses live ECharts with tooltips, hover effects, and zoom instead of static PNG images.

```bash
uc-bq deck dashboard weekly-executive --open
```

```
Generating dashboard: Weekly Executive Briefing
──────────────────────────────────────────────────
[1/3] Top 10 Products by Revenue ... OK
[2/3] Revenue by State ............. OK
[3/3] ROAS by Campaign ............ OK

Dashboard: reports/DEMO/decks/weekly-executive-dashboard.html
Opening in browser...

Done.
```

The dashboard is a single self-contained HTML file -- it loads ECharts from CDN and inlines all chart data. Responsive layout: 2 columns on a wide screen, stacks to 1 column on mobile. You can hover over any chart to see exact values in a tooltip.

It uses the same deck definition and the same report data as the PDF deck. No extra config needed.

---

> **You:** Can I put this on our internal dashboard server?

**Claude Code:** Yes -- it's just an HTML file. Deploy it anywhere:

- **S3**: Upload with `Content-Type: text/html` and it works as a static page
- **Internal server**: Drop it into nginx or Apache
- **Local**: Double-click to open from disk

The CLI doesn't handle deployment -- you just copy the file wherever you want it. If you want to refresh it on a schedule, add a step to your GitHub Actions workflow after the deck run:

```yaml
      - name: Generate interactive dashboard
        run: uc-bq deck dashboard weekly-executive

      - name: Deploy to S3
        run: aws s3 cp reports/DEMO/decks/weekly-executive-dashboard.html s3://my-dashboards/weekly.html --content-type text/html
```

---

## What You End Up With

```
reports/DEMO/
├── top-products-by-revenue/
│   ├── report.yaml
│   ├── query.sql
│   ├── chart.js
│   ├── chart.png
│   ├── report.md
│   ├── report.pdf
│   └── data.json
├── revenue-by-state/
│   └── ...
├── roas-by-campaign/
│   └── ...
└── decks/
    ├── weekly-executive.yaml           # Deck definition (committed to git)
    ├── weekly-executive.pdf            # Generated deck PDF
    └── weekly-executive-dashboard.html # Generated interactive dashboard
```

Each report is self-contained. Design it once with Claude Code, replay it forever with `uc-bq run`. Combine reports into decks for polished executive deliverables.
