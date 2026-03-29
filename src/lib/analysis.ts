import * as fs from 'fs';
import * as path from 'path';
import type { LlmProvider, LlmMessage, LlmContentPart } from './llm/provider';

export interface AnalysisOptions {
  provider: LlmProvider;
  analysisPromptPath: string;
  dataJsonPath: string;
  chartPngPath?: string;
  outputPath: string;
  model: string;
}

export async function generateAnalysis(options: AnalysisOptions): Promise<string> {
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

  // Build user message content parts
  const contentParts: LlmContentPart[] = [];

  contentParts.push({
    type: 'text',
    text: `Here is the query result data (JSON):\n\n\`\`\`json\n${dataStr}\n\`\`\``,
  });

  // Include chart PNG if available
  if (options.chartPngPath && fs.existsSync(options.chartPngPath)) {
    const pngData = fs.readFileSync(options.chartPngPath);
    contentParts.push({
      type: 'image',
      mediaType: 'image/png',
      base64Data: pngData.toString('base64'),
    });
    contentParts.push({
      type: 'text',
      text: 'Above is the rendered chart visualization for this report.',
    });
  }

  contentParts.push({
    type: 'text',
    text: 'Please generate the executive analysis based on the data and visualization provided.',
  });

  const messages: LlmMessage[] = [
    { role: 'system', content: analysisPrompt },
    { role: 'user', content: contentParts },
  ];

  const analysisText = await options.provider.complete(messages, {
    model: options.model,
    maxTokens: 4096,
  });

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
