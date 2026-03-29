import Anthropic from '@anthropic-ai/sdk';

const SCHEMA_FILTER_SYSTEM_PROMPT = `You are an expert at taking a natural language query from users for building reports or charts and filtering down BigQuery schema to fields highly likely to be used by another AI agent to write the query. Take the user's query and the schema in JSON format, then return only the applicable schema in minified single line JSON format inside a markdown code block (\`\`\`json).

# Follow these rules when processing column definitions
1. Always include columns with a name of "partition_date"
2. Always include columns with mandatory = true
3. CRITICALLY IMPORTANT: DO NOT modify or filter the "allowed_values" array in any way. The entire allowed_values list must be preserved exactly as it appears in the original schema.
4. If a column has 'mandatory': true, ALWAYS include the entire column definition in the output, regardless of other filtering criteria.

# Additional Output Instructions
- When a column is selected, include its description as a "description" field
- Preserve all other specified filtering rules

Do not include any other output, explanations, or unnecessary whitespace to minimize token count.`;

export async function filterSchemaWithLLM(
  schema: any[],
  naturalLanguageQuery: string,
  apiKey: string
): Promise<any[]> {
  if (!apiKey || !apiKey.startsWith('sk-')) {
    throw new Error('Invalid Anthropic API key format. Key should start with "sk-".');
  }
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
    temperature: 0,
    system: SCHEMA_FILTER_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here is the BigQuery schema:\n\`\`\`json\n${JSON.stringify(schema)}\n\`\`\``,
      },
      {
        role: 'user',
        content: `Please filter the schema based on this query: ${naturalLanguageQuery}`,
      },
    ],
  });

  // Extract the JSON from the markdown code block
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const match = text.match(/```json\s*([\s\S]*?)```/);
  if (match) {
    return JSON.parse(match[1].trim());
  }

  // If no code block found, try parsing the whole response
  try {
    return JSON.parse(text.trim());
  } catch {
    // Fall back to full schema if parsing fails
    console.error('Warning: LLM schema filtering returned unparseable response, using full schema.');
    return schema;
  }
}
