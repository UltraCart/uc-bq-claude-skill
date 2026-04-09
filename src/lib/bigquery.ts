import { BigQuery } from '@google-cloud/bigquery';
import * as fs from 'fs';
import * as path from 'path';
import { ResolvedMerchantConfig } from './config';

export interface DatasetInfo {
  dataset_id: string;
  description: string;
}

export interface TableInfo {
  table_name: string;
  description: string;
}

export interface QueryParameter {
  name: string;
  type: 'DATE' | 'DATETIME' | 'INT64' | 'FLOAT64' | 'BOOL' | 'STRING';
  value: string;
}

export interface QueryOptions {
  sample?: number;
  dryRun?: boolean;
  maxBytes?: number;  // Max bytes processed before aborting (default: 10 GB)
  force?: boolean;    // Skip cost check
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows: number;
  schema: Array<{ name: string; type: string; mode: string }>;
  bytesProcessed: number;
}

function getBigQueryClient(config: ResolvedMerchantConfig): BigQuery {
  return new BigQuery({ projectId: config.project_id });
}

export function getProject(config: ResolvedMerchantConfig): string {
  return config.project_id;
}

export function getDatasets(config: ResolvedMerchantConfig): DatasetInfo[] {
  const datasets: DatasetInfo[] = [
    {
      dataset_id: 'ultracart_dw',
      description: 'The standard data set. Does not contain any PII information.',
    },
    {
      dataset_id: 'ultracart_dw_streaming',
      description: 'The streaming data set. This is only for analytics and screen recordings tables because they are so large that views to see these tables in the standard or medium data sets is horrible for performance.',
    },
  ];

  if (config.taxonomy_level === 'medium' || config.taxonomy_level === 'high') {
    datasets.splice(1, 0, {
      dataset_id: 'ultracart_dw_medium',
      description: 'The medium data set. Contains PII information. Try using hashed versions of fields before accessing this data set for PII.',
    });
  }

  return datasets;
}

const STREAMING_TABLES: TableInfo[] = [
  {
    table_name: 'uc_analytics_session_streaming',
    description: 'UltraCart Analytics sessions. This is a huge table of detailed analytics information. Each session is a collection of different events (hits) that occurred within the session.',
  },
  {
    table_name: 'uc_screen_recording_streaming',
    description: 'UltraCart StoreFront screen recording sessions. These sessions contain all the meta data information about a customers session as captured by the StoreFront screen recording system.',
  },
];

const STANDARD_TABLES: TableInfo[] = [
  { table_name: 'uc_auto_orders', description: 'Auto orders (subscriptions)' },
  { table_name: 'uc_customers', description: 'customers' },
  { table_name: 'uc_items', description: 'items' },
  { table_name: 'uc_orders', description: 'orders' },
  { table_name: 'uc_zoho_desk_tickets', description: 'Archive of Zoho Desk tickets from customer service' },
  { table_name: 'uc_affiliate_clicks', description: 'Stores records of clicks on affiliate links, tracking user interactions with affiliate marketing campaigns, including click timestamps, affiliate IDs, and referral details.' },
  { table_name: 'uc_affiliate_commission_groups', description: 'Contains configuration data for affiliate commission groups, defining commission structures, rates, and rules for affiliate payouts.' },
  { table_name: 'uc_affiliate_ledgers', description: 'Tracks financial transactions related to affiliates, including earned commissions, adjustments, and payout statuses.' },
  { table_name: 'uc_affiliate_payments', description: 'Records payment details made to affiliates, including payment amounts, dates, and methods for completed affiliate commissions.' },
  { table_name: 'uc_affiliate_postback_logs', description: 'Logs postback events sent to or received from affiliate networks, capturing data for tracking conversions and campaign performance.' },
  { table_name: 'uc_affiliates', description: 'Stores information about affiliate accounts, including affiliate IDs, contact details, and account settings.' },
  { table_name: 'uc_affiliate_network_pixel_postback_logs', description: 'Affiliate Network Pixel server-to-server postback logs' },
  { table_name: 'uc_affiliate_network_pixels', description: 'Affiliate Network Pixel configurations' },
  { table_name: 'uc_cart_abandons', description: 'Abandon cart records' },
  { table_name: 'uc_conversation_pbx_calls', description: 'Conversation system phone call records from the PBX module' },
  { table_name: 'uc_conversations', description: 'Conversation system webchat and sms conversations' },
  { table_name: 'uc_coupons', description: 'Contains details of coupons offered by the storefront, including coupon codes, discount types, expiration dates, and usage restrictions.' },
  { table_name: 'uc_fraud_rules', description: 'Stores rules and configurations for detecting and preventing fraudulent transactions, such as thresholds and patterns for flagging suspicious activity.' },
  { table_name: 'uc_gift_certificates', description: 'Tracks gift certificate details, including certificate codes, balances, issuance dates, and redemption status.' },
  { table_name: 'uc_item_inventory_history', description: 'Records historical changes to item inventory levels, including restocks, sales, and adjustments over time.' },
  { table_name: 'uc_rotating_transaction_gateway_history', description: 'Logs historical data on transactions processed through rotating payment gateways, including gateway assignments and transaction outcomes.' },
  { table_name: 'uc_rotating_transaction_gateways', description: 'Stores configuration for rotating payment gateways, including gateway priorities and rules for transaction routing.' },
  { table_name: 'uc_shipping_methods', description: 'Contains details of available shipping methods, including carrier names, costs, delivery times, and associated rules.' },
  { table_name: 'uc_storefront_customers', description: 'Stores customer records associated with StoreFront Communications including the email and sms campaigns that the customer was sent through this system. WARNING: This is a large nested table. For email, session, list, or segment queries, prefer the flat tables: uc_storefront_customer_emails, uc_storefront_customer_sessions, uc_storefront_customer_lists, uc_storefront_customer_segments.' },
  { table_name: 'uc_storefront_customer_emails', description: 'Flat table of individual emails sent to storefront customers. One row per email. Partitioned by sent date for efficient querying. Contains sent/opened/clicked dates, campaign/flow names, subject lines, conversion status, and order attribution.' },
  { table_name: 'uc_storefront_customer_sessions', description: 'Flat table of customer browsing sessions from StoreFront. One row per session with nested page_views. Partitioned by session start date. Contains UTM parameters, order attribution, and screen recording links.' },
  { table_name: 'uc_storefront_customer_lists', description: 'Flat table of customer mailing list memberships. One row per customer-list assignment. Contains list name, UUID, and add date.' },
  { table_name: 'uc_storefront_customer_segments', description: 'Flat table of customer segment memberships. One row per customer-segment assignment. Contains segment name, UUID, and add date.' },
  { table_name: 'uc_storefront_experiments', description: 'Tracks A/B testing or other experiments run on storefronts, including experiment configurations, variants, and performance metrics.' },
  { table_name: 'uc_storefront_pages', description: 'Contains data on storefront pages, including page URLs, assigned items, permissions, etc.' },
  { table_name: 'uc_storefront_upsell_offer_events', description: 'Logs events related to upsell offers presented to customers, such as views, clicks, or conversions during the checkout process.' },
  { table_name: 'uc_storefront_upsell_offers', description: 'Stores details of upsell offers, including offer descriptions, conditions, and associated products or discounts.' },
  { table_name: 'uc_storefront_upsell_paths', description: 'Defines paths or sequences for presenting upsell offers to customers, including rules for offer eligibility and display order.' },
  { table_name: 'uc_storefronts', description: 'Contains configuration and metadata for individual storefronts, including domain, theme, and operational settings.' },
  { table_name: 'uc_surveys', description: 'Stores survey data, including questions, responses, and metadata for customer feedback collected through the platform.' },
  { table_name: 'uc_workflow_tasks', description: 'Tracks tasks within workflows such as who they are assigned to, status, comments.' },
];

export function getTables(config: ResolvedMerchantConfig, datasetId: string): TableInfo[] {
  if (datasetId === 'ultracart_dw_streaming') {
    return STREAMING_TABLES;
  }
  return STANDARD_TABLES;
}

function getEnhancedSchemaPath(datasetId: string, tableName: string): string {
  return path.resolve(__dirname, '..', '..', 'schemas', 'tables', datasetId, `${tableName}.json`);
}

export async function getTableSchema(
  config: ResolvedMerchantConfig,
  datasetId: string,
  tableName: string,
  options?: { live?: boolean }
): Promise<Array<{ name: string; type: string; mode: string; description?: string; fields?: unknown[] }>> {
  // Check for enhanced schema first (unless --live is forced)
  if (!options?.live) {
    const enhancedPath = getEnhancedSchemaPath(datasetId, tableName);
    if (fs.existsSync(enhancedPath)) {
      return JSON.parse(fs.readFileSync(enhancedPath, 'utf-8'));
    }
  }

  // Fall back to live BigQuery
  const bq = getBigQueryClient(config);
  const [metadata] = await bq.dataset(datasetId).table(tableName).getMetadata();
  return metadata.schema.fields;
}

function firstSecondOfDay(dateStr: string): string {
  return `${dateStr} 00:00:00`;
}

function lastSecondOfDay(dateStr: string): string {
  return `${dateStr} 23:59:59`;
}

export async function executeQuery(
  config: ResolvedMerchantConfig,
  sql: string,
  params: QueryParameter[] = [],
  options: QueryOptions = {}
): Promise<QueryResult> {
  const bq = getBigQueryClient(config);

  // Apply sample limit like the Java code does
  let querySql = sql;
  if (options.sample) {
    const limitRegex = /\s*LIMIT\s+(\d+)\s*$/i;
    const match = querySql.match(limitRegex);
    if (match) {
      const existingLimit = parseInt(match[1], 10);
      if (existingLimit > options.sample) {
        querySql = querySql.substring(0, match.index) + ` LIMIT ${options.sample}`;
      }
    } else {
      querySql += ` LIMIT ${options.sample}`;
    }
  }

  const queryOptions: Record<string, unknown> = {
    query: querySql,
    useLegacySql: false,
    params: undefined as Record<string, unknown> | undefined,
    dryRun: options.dryRun ?? false,
  };

  if (params.length > 0) {
    queryOptions.params = {};
    for (const p of params) {
      let value: unknown = p.value;

      switch (p.type) {
        case 'INT64':
          value = parseInt(p.value, 10);
          break;
        case 'FLOAT64':
          value = parseFloat(p.value);
          break;
        case 'BOOL':
          value = p.value === 'true' || p.value === '1' || p.value === 'yes';
          break;
        case 'DATE':
        case 'DATETIME': {
          // Match Java code: DATE and DATETIME params get start/end of day applied
          const dateStr = p.value.substring(0, 10);
          if (p.name === 'end_date') {
            value = lastSecondOfDay(dateStr);
          } else if (p.name === 'start_date') {
            value = firstSecondOfDay(dateStr);
          } else {
            value = p.value;
          }
          break;
        }
        case 'STRING':
        default:
          value = p.value;
          break;
      }

      (queryOptions.params as Record<string, unknown>)[p.name] = value;
    }
  }

  if (options.dryRun) {
    const [job, apiResponse] = await bq.createQueryJob(queryOptions);
    const stats = (apiResponse as any)?.statistics;
    return {
      rows: [],
      totalRows: 0,
      schema: [],
      bytesProcessed: parseInt(stats?.totalBytesProcessed ?? '0', 10),
    };
  }

  // Cost protection: dry-run first to check bytes processed (unless --force)
  const maxBytes = options.maxBytes ?? config.max_query_bytes ?? (10 * 1024 * 1024 * 1024);

  if (!options.force) {
    const dryRunOptions = { ...queryOptions, dryRun: true };
    const [, dryRunApiResponse] = await bq.createQueryJob(dryRunOptions);
    const dryRunStats = (dryRunApiResponse as any)?.statistics;
    const estimatedBytes = parseInt(dryRunStats?.totalBytesProcessed ?? '0', 10);
    const estimatedGB = estimatedBytes / (1024 * 1024 * 1024);
    const estimatedCost = (estimatedBytes / (1024 * 1024 * 1024 * 1024)) * 6.25;

    if (estimatedBytes > maxBytes) {
      throw new Error(
        `Query would process ${estimatedGB.toFixed(1)} GB (estimated cost: $${estimatedCost.toFixed(4)}), ` +
        `which exceeds the safety limit of ${(maxBytes / (1024 * 1024 * 1024)).toFixed(1)} GB. ` +
        `Use --force to execute anyway, or set a higher limit with --max-bytes.`
      );
    }
  }

  const [rows, jobResponse] = await bq.query(queryOptions);

  const jobAny = jobResponse as Record<string, any>;
  const stats = jobAny?.statistics;

  // Flatten BigQuery date/timestamp objects (e.g., { value: "2026-03-21" }) to plain strings
  const flattenedRows = rows.map(flattenRow);

  return {
    rows: flattenedRows,
    totalRows: flattenedRows.length,
    schema: [],
    bytesProcessed: parseInt(stats?.totalBytesProcessed ?? '0', 10),
  };
}

function flattenRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(row)) {
    result[key] = flattenValue(val);
  }
  return result;
}

export interface ExternalTableInfo {
  alias: string;
  projectId: string;
  description?: string;
  dataset: string;
  table: string;
  fullyQualified: string;
}

export function getExternalTables(config: ResolvedMerchantConfig): ExternalTableInfo[] {
  const results: ExternalTableInfo[] = [];
  if (!config.external_projects) return results;

  for (const [alias, project] of Object.entries(config.external_projects)) {
    for (const [dataset, tables] of Object.entries(project.datasets)) {
      for (const table of tables) {
        results.push({
          alias,
          projectId: project.project_id,
          description: project.description,
          dataset,
          table,
          fullyQualified: `${project.project_id}.${dataset}.${table}`,
        });
      }
    }
  }

  return results;
}

const CACHE_DIR = '.ultracart-bq-cache';

function sanitizePathComponent(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function getExternalTableSchema(
  config: ResolvedMerchantConfig,
  projectId: string,
  datasetId: string,
  tableName: string
): Promise<any[]> {
  // Check cache first
  const cacheFile = path.join(
    process.cwd(),
    CACHE_DIR,
    sanitizePathComponent(projectId),
    sanitizePathComponent(datasetId),
    `${sanitizePathComponent(tableName)}.json`
  );
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
  }

  // Fetch live from BigQuery
  const bq = new BigQuery({ projectId });
  const [metadata] = await bq.dataset(datasetId).table(tableName).getMetadata();
  const fields = metadata.schema.fields;

  // Save to cache
  const cacheDir = path.dirname(cacheFile);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(fields, null, 2));

  return fields;
}

export async function refreshSchemaCache(config: ResolvedMerchantConfig): Promise<void> {
  const cachePath = path.join(process.cwd(), CACHE_DIR);

  // Delete existing cache
  if (fs.existsSync(cachePath)) {
    fs.rmSync(cachePath, { recursive: true, force: true });
  }

  // Re-fetch all external table schemas
  const tables = getExternalTables(config);
  for (const table of tables) {
    await getExternalTableSchema(config, table.projectId, table.dataset, table.table);
  }
}

function flattenValue(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    // BigQuery NUMERIC/BIGNUMERIC types return Big number objects with s, e, c properties
    if ('s' in obj && 'e' in obj && 'c' in obj && typeof (obj as any).toString === 'function') {
      return parseFloat((obj as any).toString());
    }
    // BigQuery date/time objects have a single "value" property
    if ('value' in obj && Object.keys(obj).length === 1) {
      return obj.value;
    }
    // Recurse into nested records
    return flattenRow(obj as Record<string, unknown>);
  }
  if (Array.isArray(val)) {
    return val.map(flattenValue);
  }
  return val;
}
