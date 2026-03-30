import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { mdToPdf } from 'md-to-pdf';
import { loadManifest } from './manifest';

export type DeckReportEntry = string | { name: string; parameters?: Record<string, string> };

export interface DeckConfig {
  name: string;
  title: string;
  cover?: { company?: string; logo_url?: string };
  reports: DeckReportEntry[];
  parameter_mode?: 'smart' | 'override';  // default: 'smart'
  parameters?: Record<string, string>;
  landscape?: boolean;
  delivery?: {
    slack?: { channels: string[] };
    email?: { to: string[]; subject: string; provider: string };
  };
}

/** Get the report directory name from a deck report entry. */
export function getReportName(entry: DeckReportEntry): string {
  return typeof entry === 'string' ? entry : entry.name;
}

/** Get per-report parameter overrides from a deck report entry. */
export function getReportOverrides(entry: DeckReportEntry): Record<string, string> {
  return typeof entry === 'string' ? {} : (entry.parameters || {});
}

/**
 * Load a deck definition from a YAML file.
 */
export function loadDeck(decksDir: string, deckName: string): DeckConfig {
  const filePath = path.join(decksDir, `${deckName}.yaml`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Deck file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content, { schema: yaml.JSON_SCHEMA }) as DeckConfig;
}

/**
 * Save a deck definition to a YAML file.
 */
export function saveDeck(decksDir: string, deckName: string, config: DeckConfig): void {
  if (!fs.existsSync(decksDir)) {
    fs.mkdirSync(decksDir, { recursive: true });
  }
  const filePath = path.join(decksDir, `${deckName}.yaml`);
  const content = yaml.dump(config, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * List all deck definitions in the decks directory.
 */
export function listDecks(decksDir: string): Array<{ name: string; title: string; reportCount: number }> {
  if (!fs.existsSync(decksDir)) {
    return [];
  }

  const files = fs.readdirSync(decksDir).filter((f) => f.endsWith('.yaml'));
  const decks: Array<{ name: string; title: string; reportCount: number }> = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(decksDir, file), 'utf-8');
      const config = yaml.load(content, { schema: yaml.JSON_SCHEMA }) as DeckConfig;
      decks.push({
        name: config.name,
        title: config.title,
        reportCount: config.reports.length,
      });
    } catch {
      // Skip invalid YAML files
    }
  }

  return decks;
}

/**
 * Build a combined markdown document from a deck and its constituent reports.
 * Chart images use relative paths from the decks directory (e.g., ../report-name/chart.png).
 * The report.md content for each report is read from the reports base directory.
 */
export function buildDeckMarkdown(deck: DeckConfig, reportsBaseDir: string): string {
  const sections: string[] = [];
  const dateStr = new Date().toISOString().split('T')[0];

  // --- Cover page ---
  sections.push(`# ${deck.title}`);
  sections.push('');

  if (deck.cover?.company) {
    sections.push(`**${deck.cover.company}**`);
  }

  sections.push(`**Generated:** ${dateStr}`);
  sections.push('');

  if (deck.cover?.logo_url) {
    // If logo has been downloaded locally, use relative path; otherwise use the URL directly
    const logoLocalPath = path.join(reportsBaseDir, 'decks', 'logo.png');
    if (fs.existsSync(logoLocalPath)) {
      sections.push('![Logo](logo.png)');
    } else {
      sections.push(`![Logo](${deck.cover.logo_url})`);
    }
    sections.push('');
  }

  sections.push('---');
  sections.push('');

  // --- Table of Contents ---
  sections.push('## Table of Contents');
  sections.push('');

  for (let i = 0; i < deck.reports.length; i++) {
    const reportDirName = getReportName(deck.reports[i]);
    const reportDir = path.join(reportsBaseDir, reportDirName);
    let reportTitle = reportDirName;

    // Try to load the manifest to get the actual report name
    try {
      const manifest = loadManifest(reportDir);
      reportTitle = manifest.name;
    } catch {
      // Fall back to directory name
    }

    sections.push(`${i + 1}. [${reportTitle}](#${reportDirName})`);
  }

  sections.push('');
  sections.push('---');

  // --- Report sections ---
  for (const reportEntry of deck.reports) {
    const reportDirName = getReportName(reportEntry);
    const reportDir = path.join(reportsBaseDir, reportDirName);
    let reportTitle = reportDirName;

    try {
      const manifest = loadManifest(reportDir);
      reportTitle = manifest.name;
    } catch {
      // Fall back to directory name
    }

    sections.push('');
    sections.push('<div style="page-break-before: always;"></div>');
    sections.push('');
    sections.push(`## ${reportTitle} {#${reportDirName}}`);
    sections.push('');

    // Chart image — embed as base64 data URI so md-to-pdf renders it reliably
    const chartPngPath = path.join(reportDir, 'chart.png');
    if (fs.existsSync(chartPngPath)) {
      const chartData = fs.readFileSync(chartPngPath);
      const base64 = chartData.toString('base64');
      sections.push(`![Chart](data:image/png;base64,${base64})`);
      sections.push('');
    }

    // Report analysis content
    const reportMdPath = path.join(reportDir, 'report.md');
    if (fs.existsSync(reportMdPath)) {
      let reportContent = fs.readFileSync(reportMdPath, 'utf-8');
      // Strip the top-level heading from report.md to avoid duplicate headings
      reportContent = reportContent.replace(/^#\s+.*\n+/, '');
      sections.push(reportContent.trim());
    } else {
      sections.push('*No analysis available for this report.*');
    }
  }

  sections.push('');
  return sections.join('\n');
}

/**
 * Generate a PDF from combined deck markdown using md-to-pdf.
 * basedir should be the merchant's report output dir so relative image paths resolve.
 */
export async function generateDeckPdf(
  markdown: string,
  outputPath: string,
  basedir: string,
  landscape?: boolean,
): Promise<string> {
  const pdf = await mdToPdf(
    { content: markdown },
    {
      basedir,
      pdf_options: {
        format: 'Letter',
        landscape: landscape ?? false,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        printBackground: true,
      },
      css: `
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #333; }
        h1 { font-size: 26px; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 16px; }
        h2 { font-size: 19px; color: #444; margin-top: 24px; }
        h3 { font-size: 14px; color: #555; }
        table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 11px; }
        th { background: #f5f5f5; font-weight: 600; }
        img { max-width: 100%; height: auto; margin: 16px 0; }
        strong { color: #222; }
        ol, ul { margin: 8px 0; padding-left: 24px; }
        li { margin: 4px 0; }
        div[style*="page-break"] { page-break-before: always; }
      `,
    },
  );

  if (pdf.content) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, pdf.content);
  }

  return outputPath;
}
