import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

export interface ReportManifest {
  name: string;
  description: string;
  created: string;
  last_run: string;
  prompt: string;
  refinements?: string[];
  parameters?: Array<{
    name: string;
    type: 'date' | 'string' | 'number' | 'boolean' | 'enum';
    label: string;
    description: string;
    required: boolean;
    default?: string | number | boolean;
    options?: string[];
    validation?: {
      min?: number;
      max?: number;
      pattern?: string;
      min_date?: string;
      max_date?: string;
    };
  }>;
  run_history?: RunHistoryEntry[];
  config: {
    merchant_id: string;
    project_id: string;
    taxonomy_level: 'standard' | 'low' | 'medium' | 'high';
    dataset: string;
    tables_used: string[];
  };
  sql_file: string;
  chart: {
    type: string;
    echarts_file: string;
    output_format: 'png' | 'pdf' | 'both';
    width: number;
    height: number;
  };
  analysis?: {
    include?: boolean;
    prompt_file?: string;
    output_file?: string;
    landscape?: boolean;
  };
  delivery?: {
    slack?: { channel: string };
    email?: { to: string[]; subject: string; provider: string };
  };
}

export interface RunHistoryEntry {
  run_date: string;
  parameters: Record<string, unknown>;
  status?: 'success' | 'error';
  error_message?: string;
  rows_returned?: number;
  bytes_processed?: number;
}

const MANIFEST_FILENAME = 'report.yaml';

export function loadManifest(reportDir: string): ReportManifest {
  const filePath = path.join(reportDir, MANIFEST_FILENAME);
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content) as ReportManifest;
}

export function saveManifest(reportDir: string, manifest: ReportManifest): void {
  const filePath = path.join(reportDir, MANIFEST_FILENAME);
  const content = yaml.dump(manifest, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function addRunHistoryEntry(manifest: ReportManifest, entry: RunHistoryEntry): void {
  if (!manifest.run_history) {
    manifest.run_history = [];
  }
  manifest.run_history.push(entry);
  manifest.last_run = entry.run_date;
}

export function listReports(reportsDir: string): Array<{ dir: string; name: string; description: string; lastRun: string }> {
  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
  const reports: Array<{ dir: string; name: string; description: string; lastRun: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(reportsDir, entry.name, MANIFEST_FILENAME);
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = loadManifest(path.join(reportsDir, entry.name));
    reports.push({
      dir: entry.name,
      name: manifest.name,
      description: manifest.description,
      lastRun: manifest.last_run,
    });
  }

  return reports;
}

export function getRunHistory(manifest: ReportManifest): string {
  if (!manifest.run_history || manifest.run_history.length === 0) {
    return 'No run history.';
  }

  return manifest.run_history
    .map((entry, i) => {
      const params = Object.entries(entry.parameters)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      const status = entry.status ?? 'unknown';
      const rows = entry.rows_returned !== undefined ? `, ${entry.rows_returned} rows` : '';
      const bytes = entry.bytes_processed !== undefined ? `, ${(entry.bytes_processed / 1024 / 1024).toFixed(1)}MB processed` : '';
      const error = entry.error_message ? ` - ${entry.error_message}` : '';
      return `${i + 1}. ${entry.run_date} [${status}] (${params}${rows}${bytes})${error}`;
    })
    .join('\n');
}
