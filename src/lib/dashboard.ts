import * as fs from 'fs';
import * as path from 'path';
import { DeckConfig, getReportName } from './deck';
import { loadManifest } from './manifest';

interface ChartEntry {
  name: string;
  dataJson: string;
  chartJs: string;
  analysisHtml: string;
}

export function buildDashboardHtml(deck: DeckConfig, reportsBaseDir: string): string {
  const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const companyName = deck.cover?.company || '';
  const subtitle = companyName
    ? `${companyName} — Generated ${dateStr}`
    : `Generated ${dateStr}`;

  // Collect chart data for each report
  const charts: ChartEntry[] = [];

  for (const reportEntry of deck.reports) {
    const reportDirName = getReportName(reportEntry);
    const reportDir = path.join(reportsBaseDir, reportDirName);

    let reportName = reportDirName;
    try {
      const manifest = loadManifest(reportDir);
      reportName = manifest.name;
    } catch {
      // fall back to directory name
    }

    // Read data.json
    const dataPath = path.join(reportDir, 'data.json');
    if (!fs.existsSync(dataPath)) {
      continue;
    }
    const rawData = fs.readFileSync(dataPath, 'utf-8');

    let dataJson: string;
    try {
      const parsed = JSON.parse(rawData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.rows)) {
        dataJson = JSON.stringify(parsed.rows);
      } else {
        dataJson = rawData;
      }
    } catch {
      dataJson = rawData;
    }

    // Read chart.js
    const chartJsPath = path.join(reportDir, 'chart.js');
    if (!fs.existsSync(chartJsPath)) {
      continue;
    }
    const chartJs = fs.readFileSync(chartJsPath, 'utf-8');

    // Read report.md and convert to simple HTML
    let analysisHtml = '';
    const reportMdPath = path.join(reportDir, 'report.md');
    if (fs.existsSync(reportMdPath)) {
      const md = fs.readFileSync(reportMdPath, 'utf-8');
      analysisHtml = markdownToHtml(md);
    }

    charts.push({ name: reportName, dataJson, chartJs, analysisHtml });
  }

  // Build chart cards HTML (grid view)
  const chartCardsHtml = charts
    .map(
      (c, i) =>
        `    <div class="chart-card" onclick="showDetail(${i})" style="cursor:pointer;">
      <h2>${escapeHtml(c.name)}</h2>
      <div class="chart-container" id="chart-${i}"></div>
      <div class="view-report">Click to view full report &rarr;</div>
    </div>`,
    )
    .join('\n');

  // Build detail views (hidden by default, one per report)
  const detailViewsHtml = charts
    .map(
      (c, i) =>
        `  <div class="detail-view" id="detail-${i}" style="display:none;">
    <div class="detail-header">
      <button class="back-btn" onclick="showGrid()">&larr; Back to Dashboard</button>
      <h2>${escapeHtml(c.name)}</h2>
    </div>
    <div class="detail-chart-container" id="detail-chart-${i}"></div>
    <div class="analysis-content">
      ${c.analysisHtml || '<p><em>No analysis available for this report.</em></p>'}
    </div>
  </div>`,
    )
    .join('\n');

  // Build chart init scripts
  const chartScripts = charts
    .map(
      (c, i) => `
    // Report ${i}: ${c.name}
    (function() {
      var data = ${c.dataJson};
      ${c.chartJs}
      var chart = echarts.init(document.getElementById('chart-${i}'));
      try {
        var options = formatChartData(data, false);
        if (options && typeof options === 'object') {
          chart.setOption(options, true);
        }
      } catch(e) {
        console.error('Chart ${i} error:', e);
      }
      // Store references for detail view
      window.__deckCharts = window.__deckCharts || [];
      window.__deckCharts[${i}] = { data: data, fn: formatChartData };
    })();`,
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(deck.title)}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.4.3/echarts.min.js"></script>
  <style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  background: #f5f5f5;
  color: #333;
  padding: 24px;
}
header {
  text-align: center;
  margin-bottom: 32px;
  padding: 24px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
header h1 { font-size: 28px; margin-bottom: 8px; }
header p { color: #666; font-size: 14px; }
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
  gap: 24px;
}
.chart-card {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  padding: 20px;
  transition: box-shadow 0.2s;
}
.chart-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.chart-card h2 {
  font-size: 16px;
  color: #444;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
}
.chart-container { width: 100%; height: 500px; }
.view-report {
  text-align: right;
  margin-top: 12px;
  font-size: 13px;
  color: #888;
}
.chart-card:hover .view-report { color: #4a90d9; }

/* Detail view */
.detail-view {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
.detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid #eee;
}
.detail-header h2 { font-size: 22px; color: #333; }
.back-btn {
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 6px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  color: #555;
  white-space: nowrap;
}
.back-btn:hover { background: #e0e0e0; }
.detail-chart-container { width: 100%; height: 600px; margin-bottom: 32px; }
.analysis-content {
  line-height: 1.7;
  font-size: 14px;
}
.analysis-content h1 {
  font-size: 22px;
  color: #1a1a2e;
  border-bottom: 3px solid #4a90d9;
  padding-bottom: 10px;
  margin: 28px 0 16px 0;
}
.analysis-content h2 {
  font-size: 18px;
  color: #16213e;
  margin: 24px 0 12px 0;
  padding-left: 12px;
  border-left: 4px solid #4a90d9;
}
.analysis-content h3 {
  font-size: 15px;
  color: #0f3460;
  margin: 16px 0 8px 0;
}
.analysis-content p { margin: 10px 0; line-height: 1.75; }
.analysis-content strong { color: #1a1a2e; }
.analysis-content ul, .analysis-content ol { margin: 10px 0; padding-left: 24px; }
.analysis-content li { margin: 6px 0; line-height: 1.6; }
.analysis-content li strong { color: #4a90d9; }
.analysis-content table { border-collapse: collapse; width: 100%; margin: 16px 0; border-radius: 6px; overflow: hidden; }
.analysis-content th { background: #4a90d9; color: #fff; padding: 10px 14px; text-align: left; font-size: 13px; font-weight: 600; }
.analysis-content td { border-bottom: 1px solid #e8e8e8; padding: 10px 14px; text-align: left; font-size: 13px; }
.analysis-content tr:nth-child(even) { background: #f8f9fc; }
.analysis-content tr:hover { background: #eef2f9; }
.analysis-content code { background: #e8edf5; color: #4a90d9; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
.analysis-content hr { border: none; border-top: 2px solid #e8e8e8; margin: 24px 0; }
.analysis-content em { color: #666; }

@media (max-width: 700px) {
  .grid { grid-template-columns: 1fr; }
  body { padding: 12px; }
  .detail-header { flex-direction: column; align-items: flex-start; }
}
@media print {
  body { background: #fff; }
  .chart-card { box-shadow: none; border: 1px solid #ddd; page-break-inside: avoid; }
  .back-btn { display: none; }
  .view-report { display: none; }
}
  </style>
</head>
<body>
  <header id="dashboard-header">
    <h1>${escapeHtml(deck.title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
  </header>

  <div class="grid" id="grid-view">
${chartCardsHtml}
  </div>

${detailViewsHtml}

  <script>
${chartScripts}

    // Navigation
    function showDetail(index) {
      document.getElementById('grid-view').style.display = 'none';
      document.getElementById('dashboard-header').style.display = 'none';

      // Hide all detail views
      var details = document.querySelectorAll('.detail-view');
      details.forEach(function(el) { el.style.display = 'none'; });

      // Show the selected detail view
      var detail = document.getElementById('detail-' + index);
      detail.style.display = 'block';

      // Initialize the detail chart (larger version)
      var detailContainer = document.getElementById('detail-chart-' + index);
      var existingChart = echarts.getInstanceByDom(detailContainer);
      if (existingChart) { existingChart.dispose(); }

      var chart = echarts.init(detailContainer);
      var ref = window.__deckCharts[index];
      if (ref) {
        try {
          var options = ref.fn(ref.data, false);
          if (options && typeof options === 'object') {
            chart.setOption(options, true);
          }
        } catch(e) {
          console.error('Detail chart error:', e);
        }
      }

      window.scrollTo(0, 0);
    }

    function showGrid() {
      // Hide all detail views
      var details = document.querySelectorAll('.detail-view');
      details.forEach(function(el) { el.style.display = 'none'; });

      // Show grid
      document.getElementById('grid-view').style.display = '';
      document.getElementById('dashboard-header').style.display = '';

      // Resize all grid charts (they may have been hidden)
      var containers = document.querySelectorAll('.chart-container');
      containers.forEach(function(el) {
        var instance = echarts.getInstanceByDom(el);
        if (instance) instance.resize();
      });

      window.scrollTo(0, 0);
    }

    // Responsive resize
    window.addEventListener('resize', function() {
      document.querySelectorAll('.chart-container, .detail-chart-container').forEach(function(el) {
        var instance = echarts.getInstanceByDom(el);
        if (instance) instance.resize();
      });
    });
  </script>
</body>
</html>`;

  return html;
}

/**
 * Simple markdown to HTML converter for executive analysis content.
 * Handles: headings, bold, italic, tables, lists, code, paragraphs.
 */
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inTable = false;
  let inList = false;
  let listType = '';

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Table
    if (line.match(/^\|.*\|$/)) {
      // Skip separator rows
      if (line.match(/^\|[\s\-:|]+\|$/)) continue;

      if (!inTable) {
        if (inList) { html.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
        html.push('<table>');
        inTable = true;
        // First row is header
        const cells = line.split('|').filter(c => c.trim());
        html.push('<tr>' + cells.map(c => `<th>${inlineFormat(c.trim())}</th>`).join('') + '</tr>');
        continue;
      }
      const cells = line.split('|').filter(c => c.trim());
      html.push('<tr>' + cells.map(c => `<td>${inlineFormat(c.trim())}</td>`).join('') + '</tr>');
      continue;
    } else if (inTable) {
      html.push('</table>');
      inTable = false;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { html.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
      const level = headingMatch[1].length;
      html.push(`<h${level}>${inlineFormat(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Unordered list
    if (line.match(/^\s*[-*]\s+/)) {
      if (!inList || listType !== 'ul') {
        if (inList) html.push(listType === 'ol' ? '</ol>' : '</ul>');
        html.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      html.push(`<li>${inlineFormat(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }

    // Ordered list
    if (line.match(/^\s*\d+\.\s+/)) {
      if (!inList || listType !== 'ol') {
        if (inList) html.push(listType === 'ol' ? '</ol>' : '</ul>');
        html.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      html.push(`<li>${inlineFormat(line.replace(/^\s*\d+\.\s+/, ''))}</li>`);
      continue;
    }

    // Close list if we're no longer in one
    if (inList && line.trim() === '') {
      html.push(listType === 'ol' ? '</ol>' : '</ul>');
      inList = false;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      html.push('<hr>');
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      continue;
    }

    // Paragraph
    if (inList) { html.push(listType === 'ol' ? '</ol>' : '</ul>'); inList = false; }
    html.push(`<p>${inlineFormat(line)}</p>`);
  }

  if (inTable) html.push('</table>');
  if (inList) html.push(listType === 'ol' ? '</ol>' : '</ul>');

  return html.join('\n');
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
