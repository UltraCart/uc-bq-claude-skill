import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

export interface AnalysisOptions {
  apiKey: string;
  analysisPromptPath: string;
  dataJsonPath: string;
  chartPngPath?: string;
  outputPath: string;
  model?: string;
}

export async function generateAnalysis(options: AnalysisOptions): Promise<string> {
  if (!options.apiKey || !options.apiKey.startsWith('sk-')) {
    throw new Error('Invalid Anthropic API key format. Key should start with "sk-".');
  }
  const client = new Anthropic({ apiKey: options.apiKey });

  const analysisPrompt = fs.readFileSync(options.analysisPromptPath, 'utf-8');
  const rawData = fs.readFileSync(options.dataJsonPath, 'utf-8');

  // Normalize data to array
  let dataStr: string;
  try {
    const parsed = JSON.parse(rawData);
    dataStr = JSON.stringify(Array.isArray(parsed) ? parsed : parsed.rows || parsed, null, 2);
  } catch {
    dataStr = rawData;
  }

  // Build the message content
  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  content.push({
    type: 'text' as const,
    text: `Here is the query result data (JSON):\n\n\`\`\`json\n${dataStr}\n\`\`\``,
  });

  // Include chart PNG if available
  if (options.chartPngPath && fs.existsSync(options.chartPngPath)) {
    const pngData = fs.readFileSync(options.chartPngPath);
    content.push({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: pngData.toString('base64'),
      },
    });
    content.push({
      type: 'text' as const,
      text: 'Above is the rendered chart visualization for this report.',
    });
  }

  content.push({
    type: 'text' as const,
    text: 'Please generate the executive analysis based on the data and visualization provided.',
  });

  const response = await client.messages.create({
    model: options.model || 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    system: analysisPrompt,
    messages: [{ role: 'user', content }],
  });

  // Extract text from response
  const analysisText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n');

  // Write to output file
  fs.writeFileSync(options.outputPath, analysisText);

  return analysisText;
}

/**
 * Generate a default analysis prompt template when Claude Code creates a new report.
 * This is a generic template — Claude Code should customize it based on the specific query/data.
 */
export function getDefaultAnalysisPromptTemplate(reportName: string, sqlSummary: string, dataFields: string[]): string {
  return `# ${reportName} — Analysis System Prompt

## Overview
You are an expert analyst specializing in UltraCart e-commerce data. You will receive JSON data and a corresponding PNG visualization. Generate a comprehensive executive analysis.

## Source Query Context
${sqlSummary}

## JSON Data Fields
${dataFields.map((f) => `- **${f}**`).join('\n')}

## Analysis Methodology

### 1. Executive Summary
- 2-3 sentence overview of the key findings
- Lead with the most impactful insight

### 2. Key Findings
- Top 3-5 findings supported by specific numbers from the data
- Include percentage comparisons where applicable
- Reference the visualization where relevant

### 3. Trend & Pattern Analysis
- Identify notable trends, patterns, or anomalies
- Compare segments (if applicable)
- Note any concerning or encouraging patterns

### 4. Alert Conditions
- Flag any metrics that appear unusual (sudden drops >30%, unexpected spikes, etc.)
- Note data quality issues if any (negative values, missing data, etc.)

### 5. Actionable Recommendations
- 3-5 specific, actionable recommendations based on the data
- Prioritize by potential business impact
- Be specific — reference actual values from the data

## Output Format
- Use markdown formatting
- Include specific numbers, percentages, and comparisons
- Keep the analysis concise but thorough (500-1000 words)
- Write for a business audience, not a technical one
`;
}
