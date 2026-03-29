import * as fs from 'fs';
import * as path from 'path';
import { mdToPdf } from 'md-to-pdf';

export interface PdfOptions {
  markdownPath: string;
  outputPath: string;
  chartPngPath?: string;
  landscape?: boolean;
}

export async function generatePdf(options: PdfOptions): Promise<string> {
  let markdown = fs.readFileSync(options.markdownPath, 'utf-8');

  // If chart PNG exists and isn't already referenced in the markdown, embed it at the top
  if (options.chartPngPath && fs.existsSync(options.chartPngPath)) {
    const chartRef = `![Chart](${path.basename(options.chartPngPath)})`;
    if (!markdown.includes('![Chart]') && !markdown.includes('![chart]')) {
      // Insert chart after the first heading
      const firstHeadingEnd = markdown.indexOf('\n', markdown.indexOf('#'));
      if (firstHeadingEnd > 0) {
        markdown =
          markdown.substring(0, firstHeadingEnd + 1) +
          '\n' + chartRef + '\n' +
          markdown.substring(firstHeadingEnd + 1);
      } else {
        markdown = chartRef + '\n\n' + markdown;
      }
    }
  }

  const pdf = await mdToPdf(
    { content: markdown },
    {
      basedir: path.dirname(options.markdownPath),
      pdf_options: {
        format: 'Letter',
        landscape: options.landscape ?? false,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        printBackground: true,
      },
      css: `
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #333; }
        h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 16px; }
        h2 { font-size: 17px; color: #444; margin-top: 24px; }
        h3 { font-size: 14px; color: #555; }
        table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 11px; }
        th { background: #f5f5f5; font-weight: 600; }
        img { max-width: 100%; height: auto; margin: 16px 0; }
        strong { color: #222; }
        ol, ul { margin: 8px 0; padding-left: 24px; }
        li { margin: 4px 0; }
      `,
    }
  );

  if (pdf.content) {
    fs.writeFileSync(options.outputPath, pdf.content);
  }

  return options.outputPath;
}
