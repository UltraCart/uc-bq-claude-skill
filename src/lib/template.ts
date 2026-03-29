export function substituteParams(sql: string, params: Record<string, string>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (name in params) {
      return params[name];
    }
    return match;
  });
}

export function processConditionals(sql: string, params: Record<string, string>): string {
  // Handle {% if param_name != 'value' %}...{% endif %}
  let result = sql.replace(
    /\{%\s*if\s+(\w+)\s*!=\s*'([^']*)'\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g,
    (_match, name, value, body) => {
      const paramValue = params[name];
      if (paramValue !== undefined && paramValue !== value) {
        return body;
      }
      return '';
    }
  );

  // Handle {% if param_name %}...{% endif %}
  result = result.replace(
    /\{%\s*if\s+(\w+)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g,
    (_match, name, body) => {
      const paramValue = params[name];
      if (paramValue !== undefined && paramValue !== '' && paramValue !== 'false') {
        return body;
      }
      return '';
    }
  );

  return result;
}

export function renderTemplate(sqlTemplate: string, params: Record<string, string>): string {
  const afterConditionals = processConditionals(sqlTemplate, params);
  return substituteParams(afterConditionals, params);
}
