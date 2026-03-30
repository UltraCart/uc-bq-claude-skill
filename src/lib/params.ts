import * as readline from 'readline';

export interface ParameterValidation {
  min?: number;
  max?: number;
  pattern?: string;
  min_date?: string;
  max_date?: string;
}

export interface ReportParameter {
  name: string;
  type: 'date' | 'string' | 'number' | 'boolean' | 'enum';
  label: string;
  description: string;
  required: boolean;
  default?: string | number | boolean;
  options?: string[];
  validation?: ParameterValidation;
}

export function resolveRelativeDate(expr: string): string {
  const today = new Date();
  const yyyy = (d: Date) => d.toISOString().substring(0, 10);

  if (expr === 'today') {
    return yyyy(today);
  }

  // -Nd (days ago)
  let match = expr.match(/^-(\d+)d$/);
  if (match) {
    const d = new Date(today);
    d.setDate(d.getDate() - parseInt(match[1], 10));
    return yyyy(d);
  }

  // -Nw (weeks ago)
  match = expr.match(/^-(\d+)w$/);
  if (match) {
    const d = new Date(today);
    d.setDate(d.getDate() - parseInt(match[1], 10) * 7);
    return yyyy(d);
  }

  // -Nm (months ago)
  match = expr.match(/^-(\d+)m$/);
  if (match) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - parseInt(match[1], 10));
    return yyyy(d);
  }

  // -Ny (years ago)
  match = expr.match(/^-(\d+)y$/);
  if (match) {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - parseInt(match[1], 10));
    return yyyy(d);
  }

  // "yesterday"
  if (expr === 'yesterday') {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return yyyy(d);
  }

  // Start-of-period expressions
  if (expr === 'start_of_week') {
    const d = new Date(today);
    const day = d.getDay(); // 0=Sunday
    d.setDate(d.getDate() - day);
    return yyyy(d);
  }

  if (expr === 'start_of_month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 1);
    return yyyy(d);
  }

  if (expr === 'start_of_quarter') {
    const quarter = Math.floor(today.getMonth() / 3);
    const d = new Date(today.getFullYear(), quarter * 3, 1);
    return yyyy(d);
  }

  if (expr === 'start_of_year') {
    const d = new Date(today.getFullYear(), 0, 1);
    return yyyy(d);
  }

  // End-of-period expressions (last day of the period)
  if (expr === 'end_of_last_month') {
    const d = new Date(today.getFullYear(), today.getMonth(), 0);
    return yyyy(d);
  }

  if (expr === 'end_of_last_quarter') {
    const quarter = Math.floor(today.getMonth() / 3);
    const d = new Date(today.getFullYear(), quarter * 3, 0);
    return yyyy(d);
  }

  if (expr === 'end_of_last_year') {
    const d = new Date(today.getFullYear() - 1, 11, 31);
    return yyyy(d);
  }

  // Start of previous periods (useful for comparisons)
  if (expr === 'start_of_last_month') {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return yyyy(d);
  }

  if (expr === 'start_of_last_quarter') {
    const quarter = Math.floor(today.getMonth() / 3);
    const d = new Date(today.getFullYear(), (quarter - 1) * 3, 1);
    return yyyy(d);
  }

  if (expr === 'start_of_last_year') {
    const d = new Date(today.getFullYear() - 1, 0, 1);
    return yyyy(d);
  }

  // Not a relative expression, return as-is (already an ISO date string)
  return expr;
}

/**
 * Returns true if the expression is a relative date constant that resolveRelativeDate
 * would transform (e.g., "today", "-90d", "start_of_year"). Returns false for static
 * date strings like "2025-06-15".
 */
export function isRelativeDateExpression(expr: string): boolean {
  if (!expr || typeof expr !== 'string') return false;
  const s = expr.trim();
  if (/^(today|yesterday)$/.test(s)) return true;
  if (/^-\d+[dwmy]$/.test(s)) return true;
  if (/^(start_of_|end_of_)/.test(s)) return true;
  return false;
}

export async function promptForParameter(param: ReportParameter): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  const defaultStr = param.default !== undefined
    ? ` [${param.default}]`
    : '';

  const optionsStr = param.options
    ? ` (${param.options.join(', ')})`
    : '';

  const prompt = `${param.label} (${param.description})${optionsStr}${defaultStr}: `;

  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      const value = answer.trim() || (param.default !== undefined ? String(param.default) : '');
      resolve(value);
    });
  });
}

export async function resolveParameters(
  params: ReportParameter[],
  cliOverrides: Record<string, string>,
  defaults: Record<string, string> = {}
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const param of params) {
    // Priority: CLI flags > manifest defaults > prompt
    if (cliOverrides[param.name] !== undefined) {
      resolved[param.name] = cliOverrides[param.name];
    } else if (defaults[param.name] !== undefined) {
      resolved[param.name] = defaults[param.name];
    } else if (param.default !== undefined) {
      resolved[param.name] = String(param.default);
    } else if (param.required) {
      resolved[param.name] = await promptForParameter(param);
    }

    // Resolve relative date expressions for date-type params
    if (param.type === 'date' && resolved[param.name]) {
      resolved[param.name] = resolveRelativeDate(resolved[param.name]);
    }
  }

  return resolved;
}
