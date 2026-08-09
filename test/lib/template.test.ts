import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { substituteParams, processConditionals, renderTemplate } from '../../src/lib/template';

describe('substituteParams', () => {
  it('substitutes a single placeholder', () => {
    assert.equal(
      substituteParams('SELECT * FROM t WHERE d = "{{start_date}}"', { start_date: '2026-01-01' }),
      'SELECT * FROM t WHERE d = "2026-01-01"',
    );
  });

  it('substitutes repeated placeholders', () => {
    assert.equal(
      substituteParams('{{a}}-{{a}}-{{a}}', { a: 'x' }),
      'x-x-x',
    );
  });

  it('substitutes multiple distinct placeholders', () => {
    assert.equal(
      substituteParams('BETWEEN "{{start}}" AND "{{end}}"', { start: '2026-01-01', end: '2026-01-31' }),
      'BETWEEN "2026-01-01" AND "2026-01-31"',
    );
  });

  it('leaves unknown placeholders intact rather than blanking them', () => {
    // Blanking would silently produce `WHERE d = ""` and return zero rows,
    // which reads as "no data" instead of "the report is misconfigured".
    assert.equal(
      substituteParams('WHERE d = "{{missing}}"', {}),
      'WHERE d = "{{missing}}"',
    );
  });

  it('substitutes known placeholders while leaving unknown ones', () => {
    assert.equal(
      substituteParams('{{known}} {{unknown}}', { known: 'yes' }),
      'yes {{unknown}}',
    );
  });

  it('ignores malformed delimiters', () => {
    assert.equal(substituteParams('{single}', { single: 'x' }), '{single}');
    assert.equal(substituteParams('{{ spaced }}', { spaced: 'x' }), '{{ spaced }}');
    assert.equal(substituteParams('{{has-dash}}', { 'has-dash': 'x' }), '{{has-dash}}');
  });

  it('returns the template unchanged when there are no placeholders', () => {
    const sql = 'SELECT 1';
    assert.equal(substituteParams(sql, { unused: 'x' }), sql);
  });

  it('does not re-expand placeholders introduced by a substituted value', () => {
    // A value containing {{...}} must not be rescanned, or a parameter value
    // could inject a reference to another parameter.
    assert.equal(
      substituteParams('{{outer}}', { outer: '{{inner}}', inner: 'PWNED' }),
      '{{inner}}',
    );
  });

  it('treats $ in values literally', () => {
    // String.replace assigns special meaning to $&, $1 and friends in the
    // replacement. Values come from user parameters, so this must be literal.
    assert.equal(substituteParams('{{v}}', { v: '$&' }), '$&');
    assert.equal(substituteParams('{{v}}', { v: "$'" }), "$'");
    assert.equal(substituteParams('{{v}}', { v: '$1' }), '$1');
  });

  it('substitutes empty-string values', () => {
    assert.equal(substituteParams('a{{v}}b', { v: '' }), 'ab');
  });
});

describe('processConditionals', () => {
  describe('truthiness form: {% if p %}', () => {
    it('keeps the body when the param is a non-empty value', () => {
      assert.equal(processConditionals('A{% if flag %}B{% endif %}C', { flag: 'yes' }), 'ABC');
    });

    it('drops the body when the param is absent', () => {
      assert.equal(processConditionals('A{% if flag %}B{% endif %}C', {}), 'AC');
    });

    it('drops the body when the param is empty', () => {
      assert.equal(processConditionals('A{% if flag %}B{% endif %}C', { flag: '' }), 'AC');
    });

    it('drops the body for the literal string "false"', () => {
      // Params arrive as strings, so a boolean false becomes "false" and has
      // to be treated as falsy or every boolean toggle would be always-on.
      assert.equal(processConditionals('A{% if flag %}B{% endif %}C', { flag: 'false' }), 'AC');
    });

    it('keeps the body for "0", which is a meaningful value', () => {
      assert.equal(processConditionals('A{% if n %}B{% endif %}C', { n: '0' }), 'ABC');
    });

    it('tolerates flexible whitespace in the tag', () => {
      assert.equal(processConditionals('{%if flag%}B{%endif%}', { flag: 'y' }), 'B');
      assert.equal(processConditionals('{%   if   flag   %}B{%   endif   %}', { flag: 'y' }), 'B');
    });

    it('spans multiple lines', () => {
      const sql = ['SELECT *', '{% if extra %}', '  AND x = 1', '{% endif %}'].join('\n');
      assert.match(processConditionals(sql, { extra: 'y' }), /AND x = 1/);
      assert.doesNotMatch(processConditionals(sql, {}), /AND x = 1/);
    });

    it('handles several independent conditionals', () => {
      const sql = '{% if a %}A{% endif %}{% if b %}B{% endif %}';
      assert.equal(processConditionals(sql, { a: 'y' }), 'A');
      assert.equal(processConditionals(sql, { b: 'y' }), 'B');
      assert.equal(processConditionals(sql, { a: 'y', b: 'y' }), 'AB');
      assert.equal(processConditionals(sql, {}), '');
    });
  });

  describe('inequality form: {% if p != \'v\' %}', () => {
    it('keeps the body when the value differs', () => {
      assert.equal(
        processConditionals("A{% if channel != 'all' %}B{% endif %}C", { channel: 'web' }),
        'ABC',
      );
    });

    it('drops the body when the value matches', () => {
      assert.equal(
        processConditionals("A{% if channel != 'all' %}B{% endif %}C", { channel: 'all' }),
        'AC',
      );
    });

    it('drops the body when the param is absent', () => {
      assert.equal(
        processConditionals("A{% if channel != 'all' %}B{% endif %}C", {}),
        'AC',
      );
    });

    it('compares against an empty literal', () => {
      assert.equal(processConditionals("{% if c != '' %}B{% endif %}", { c: 'x' }), 'B');
      assert.equal(processConditionals("{% if c != '' %}B{% endif %}", { c: '' }), '');
    });
  });

  it('leaves text without conditionals unchanged', () => {
    const sql = 'SELECT * FROM t';
    assert.equal(processConditionals(sql, {}), sql);
  });
});

describe('renderTemplate', () => {
  it('applies conditionals before substitution', () => {
    // Order matters: a placeholder inside a dropped branch must never be
    // substituted, and one inside a kept branch must be.
    const sql = "SELECT * FROM t WHERE 1=1{% if channel != 'all' %} AND channel = '{{channel}}'{% endif %}";

    assert.equal(
      renderTemplate(sql, { channel: 'web' }),
      "SELECT * FROM t WHERE 1=1 AND channel = 'web'",
    );
    assert.equal(
      renderTemplate(sql, { channel: 'all' }),
      'SELECT * FROM t WHERE 1=1',
    );
  });

  it('does not leave placeholders inside dropped branches', () => {
    const sql = '{% if flag %}{{secret}}{% endif %}';
    assert.equal(renderTemplate(sql, { secret: 'value' }), '');
  });

  it('renders a realistic parameterized report query', () => {
    const sql = [
      'SELECT order_date, SUM(total) AS revenue',
      'FROM `proj.ds.orders`',
      "WHERE order_date BETWEEN '{{start_date}}' AND '{{end_date}}'",
      "{% if channel != 'all' %}  AND channel = '{{channel}}'{% endif %}",
      'GROUP BY order_date',
    ].join('\n');

    const rendered = renderTemplate(sql, {
      start_date: '2026-01-01',
      end_date: '2026-01-31',
      channel: 'web',
    });

    assert.match(rendered, /BETWEEN '2026-01-01' AND '2026-01-31'/);
    assert.match(rendered, /AND channel = 'web'/);
    assert.doesNotMatch(rendered, /\{\{|\{%/, 'no template syntax should survive rendering');
  });

  it('is idempotent when there is nothing left to render', () => {
    const once = renderTemplate('SELECT 1', {});
    assert.equal(renderTemplate(once, {}), once);
  });
});
