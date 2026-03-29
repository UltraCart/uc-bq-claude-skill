import { Command } from 'commander';
import * as fs from 'fs';
import { renderChart } from '../lib/renderer';

export const renderCommand = new Command('render')
  .description('Render ECharts JS to PNG/PDF via headless browser')
  .option('--chart <path>', 'Path to ECharts chart.js file')
  .option('--data <path>', 'Path to data.json file')
  .option('--output <path>', 'Output file path (e.g., chart.png)')
  .option('--width <pixels>', 'Chart width in pixels', '1200')
  .option('--height <pixels>', 'Chart height in pixels', '600')
  .option('--format <format>', 'Output format: png or pdf', 'png')
  .option('--dashboard', 'Render in dashboard mode (200x200)')
  .option('--preview', 'Open in browser instead of headless rendering')
  .action(async (options) => {
    try {
      if (!options.chart) {
        console.error('Error: --chart is required.');
        process.exit(1);
      }
      if (!options.data) {
        console.error('Error: --data is required.');
        process.exit(1);
      }
      if (!options.output && !options.preview) {
        console.error('Error: --output is required (or use --preview).');
        process.exit(1);
      }

      // Validate files exist
      if (!fs.existsSync(options.chart)) {
        console.error(`Error: Chart file not found: ${options.chart}`);
        process.exit(1);
      }
      if (!fs.existsSync(options.data)) {
        console.error(`Error: Data file not found: ${options.data}`);
        process.exit(1);
      }

      // Dashboard mode overrides dimensions
      const width = options.dashboard ? 200 : parseInt(options.width, 10);
      const height = options.dashboard ? 200 : parseInt(options.height, 10);

      const result = await renderChart({
        chartJsPath: options.chart,
        dataJsonPath: options.data,
        outputPath: options.output,
        width,
        height,
        format: options.format,
        isDashboard: !!options.dashboard,
      });

      if (result.errors && result.errors.length > 0) {
        console.error('');
        console.error('  Rendering errors:');
        for (const err of result.errors) {
          console.error(`    - ${err}`);
        }
        process.exit(1);
      }

      console.log('');
      console.log(`  Chart rendered to ${result.outputPath}`);
      console.log(`  Dimensions: ${width}x${height}`);
      console.log(`  Format: ${options.format}`);
      if (options.dashboard) {
        console.log('  Mode: dashboard (200x200)');
      }
      console.log('');
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
