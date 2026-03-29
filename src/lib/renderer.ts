import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';

export interface RenderOptions {
  chartJsPath: string;
  dataJsonPath: string;
  outputPath: string;
  width: number;
  height: number;
  format: 'png' | 'pdf';
  isDashboard: boolean;
}

interface RenderResult {
  outputPath: string;
  errors: string[];
}

function getTemplatePath(): string {
  return path.resolve(__dirname, '..', '..', 'templates', 'render.html');
}

export async function renderChart(options: RenderOptions): Promise<RenderResult> {
  const errors: string[] = [];

  const templateHtml = fs.readFileSync(getTemplatePath(), 'utf-8');
  const chartFunction = fs.readFileSync(options.chartJsPath, 'utf-8');
  const rawData = fs.readFileSync(options.dataJsonPath, 'utf-8');

  // The data file may be { rows: [...] } or a plain array — normalize to array
  let dataArray: string;
  try {
    const parsed = JSON.parse(rawData);
    if (parsed && Array.isArray(parsed.rows)) {
      dataArray = JSON.stringify(parsed.rows);
    } else if (Array.isArray(parsed)) {
      dataArray = JSON.stringify(parsed);
    } else {
      dataArray = rawData;
    }
  } catch {
    dataArray = rawData;
  }

  // Remove the auto-executing script from the template — we'll run it manually after injecting data
  const strippedHtml = templateHtml.replace(
    /\(function\s*\(\)\s*\{[\s\S]*?\}\)\(\);/,
    '// Chart initialization will be triggered by Puppeteer'
  );

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.setViewport({
    width: options.width + 40,
    height: options.height + 40,
    deviceScaleFactor: 2,
  });

  // Load the template (loads ECharts from CDN)
  await page.setContent(strippedHtml, { waitUntil: 'networkidle0' });

  // Inject data and render via addScriptTag — guarantees execution after DOM + ECharts are ready
  await page.addScriptTag({
    content: `
      (async function() { try {
        var data = ${dataArray};
        var fnSource = ${JSON.stringify(chartFunction)};
        var isDashboard = ${options.isDashboard};
        var chartWidth = ${options.width};
        var chartHeight = ${options.height};

        var container = document.getElementById('myChart');
        container.style.width = chartWidth + 'px';
        container.style.height = chartHeight + 'px';

        // Load USA map for geo charts (async)
        try {
          var mapResponse = await fetch('https://cdn.jsdelivr.net/npm/echarts@5.4.3/map/json/USA.json');
          if (mapResponse.ok) {
            var usaJson = await mapResponse.json();
            echarts.registerMap('USA', usaJson, {
              Alaska: { left: -131, top: 25, width: 15 },
              Hawaii: { left: -110, top: 28, width: 5 },
              'Puerto Rico': { left: -76, top: 26, width: 2 }
            });
          }
        } catch (e) { /* map not needed for most charts */ }

        var chart = echarts.init(container);

        // Evaluate chart function — runs in Puppeteer sandbox, not Node.js process
        var functionBody = fnSource
          .replace(/function\\s+formatChartData\\s*\\(\\s*data\\s*(?:,\\s*isDashboard\\s*(?:=\\s*[^)]+)?\\s*)?\\)\\s*\\{/, '')
          .replace(/\\}\\s*$/, '');
        var formatChartData = new Function('data', 'isDashboard', functionBody);

        var options = formatChartData(data, isDashboard);

        if (options && typeof options === 'object') {
          options.animation = false;
          chart.setOption(options, true);
        }

        window.__RENDER_COMPLETE__ = true;
      } catch (e) {
        window.__RENDER_ERROR__ = e.message || String(e);
        window.__RENDER_COMPLETE__ = true;
      } })();
    `
  });

  // Wait for render to complete
  await page.waitForFunction(
    '(globalThis).__RENDER_COMPLETE__ === true',
    { timeout: 30000 }
  );

  // Check for render errors
  const renderError = await page.evaluate(() => (globalThis as unknown as Record<string, string>).__RENDER_ERROR__);
  if (renderError) {
    errors.push(renderError);
  }

  if (options.format === 'pdf') {
    await page.pdf({
      path: options.outputPath,
      width: `${options.width + 40}px`,
      height: `${options.height + 40}px`,
      printBackground: true,
    });
  } else {
    const chartElement = await page.$('#myChart');
    if (chartElement) {
      await chartElement.screenshot({ path: options.outputPath });
    } else {
      await page.screenshot({ path: options.outputPath });
    }
  }

  await browser.close();

  return { outputPath: options.outputPath, errors };
}

export async function checkDependencies(): Promise<boolean> {
  try {
    const browser = await puppeteer.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}
