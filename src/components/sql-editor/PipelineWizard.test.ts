/**
 * Unit tests for Pipeline Wizard logic.
 * Tests parseViewStatement, pipeline system prompt design, layer management,
 * and the no-JOIN constraint enforcement.
 */

import { describe, it, expect } from 'vitest';

// ── Pure functions extracted from PipelineWizard.tsx for testing ──

/** Parse a CREATE OR REPLACE VIEW statement to extract view name and select SQL */
function parseViewStatement(sql: string): { name: string; selectSql: string; viewSql: string } | null {
  const match = sql.match(/CREATE\s+OR\s+REPLACE\s+VIEW\s+(\S+)\s+AS\s+([\s\S]+)/i);
  if (!match) return null;
  const name = match[1].replace(/[";]/g, '');
  const selectSql = match[2].replace(/;\s*$/, '');
  return { name, selectSql, viewSql: sql.replace(/;\s*$/, '') + ';' };
}

/** Pipeline system prompt (mirrored from PipelineWizard.tsx) */
const PIPELINE_SYSTEM_CONTEXT = `You are a data pipeline architect. The user wants to build a data pipeline using layered SQL views in DuckDB.

CRITICAL RULES:
1. NEVER use JOIN. Instead, use WHERE column IN (SELECT column FROM other_view).
2. Each layer should be a CREATE OR REPLACE VIEW statement.
3. Views should be layered: base/raw -> cleaned/filtered -> enriched/calculated -> final/aggregated.
4. Keep each view focused on ONE transformation step.
5. Name views with a prefix pattern like: v_raw_*, v_clean_*, v_enrich_*, v_final_*.
6. Always reference previous views (not raw tables) once they exist.

RESPONSE FORMAT:
Always include a <think> section and a <summary> section before your SQL.

<think>
Your step-by-step reasoning about the pipeline layer.
</think>

<summary>
Plain-English explanation of what this view does and how it fits in the pipeline.
</summary>

After </summary>, output ONLY the CREATE OR REPLACE VIEW statement.
No markdown, no backticks, no extra text.

If the user is asking a question (not requesting a view), start with "CHAT:" followed by your response.
If you need clarification, start with "CLARIFY:" followed by your question.`;

// ── Pipeline layer type (mirrored from PipelineWizard.tsx) ──

interface PipelineLayer {
  id: string;
  name: string;
  description: string;
  sql: string;
  viewSql: string;
  created: boolean;
  confirmed?: boolean;
  error?: string;
}

// ── Tests ──

describe('PipelineWizard - parseViewStatement', () => {
  it('should parse a simple CREATE OR REPLACE VIEW statement', () => {
    const sql = 'CREATE OR REPLACE VIEW v_raw_orders AS SELECT * FROM orders';
    const result = parseViewStatement(sql);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('v_raw_orders');
    expect(result!.selectSql).toBe('SELECT * FROM orders');
    expect(result!.viewSql).toBe('CREATE OR REPLACE VIEW v_raw_orders AS SELECT * FROM orders;');
  });

  it('should parse a view with WHERE...IN subquery (no-JOIN pattern)', () => {
    const sql = `CREATE OR REPLACE VIEW v_clean_active_orders AS
SELECT * FROM v_raw_orders
WHERE customer_id IN (SELECT id FROM customers WHERE active = true)`;

    const result = parseViewStatement(sql);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('v_clean_active_orders');
    expect(result!.selectSql).toContain('WHERE customer_id IN');
    expect(result!.selectSql).toContain('SELECT id FROM customers');
    expect(result!.selectSql).not.toContain('JOIN');
  });

  it('should parse a view with aggregations', () => {
    const sql = `CREATE OR REPLACE VIEW v_final_revenue AS
SELECT category, SUM(revenue) AS total_revenue, COUNT(*) AS order_count
FROM v_enrich_orders
GROUP BY category
ORDER BY total_revenue DESC`;

    const result = parseViewStatement(sql);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('v_final_revenue');
    expect(result!.selectSql).toContain('SUM(revenue)');
    expect(result!.selectSql).toContain('GROUP BY category');
  });

  it('should strip quoted view names', () => {
    const sql = 'CREATE OR REPLACE VIEW "v_raw_data" AS SELECT * FROM raw_data';
    const result = parseViewStatement(sql);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('v_raw_data');
  });

  it('should handle trailing semicolon', () => {
    const sql = 'CREATE OR REPLACE VIEW v_test AS SELECT 1;';
    const result = parseViewStatement(sql);

    expect(result).not.toBeNull();
    expect(result!.selectSql).toBe('SELECT 1');
    expect(result!.viewSql).toBe('CREATE OR REPLACE VIEW v_test AS SELECT 1;');
  });

  it('should handle trailing semicolon with whitespace', () => {
    const sql = 'CREATE OR REPLACE VIEW v_test AS SELECT 1;  \n';
    const result = parseViewStatement(sql);

    expect(result).not.toBeNull();
    expect(result!.selectSql).toBe('SELECT 1');
  });

  it('should return null for non-VIEW statements', () => {
    expect(parseViewStatement('SELECT * FROM users')).toBeNull();
    expect(parseViewStatement('CREATE TABLE users (id INT)')).toBeNull();
    expect(parseViewStatement('INSERT INTO users VALUES (1)')).toBeNull();
    expect(parseViewStatement('')).toBeNull();
  });

  it('should return null for malformed VIEW statements', () => {
    expect(parseViewStatement('CREATE VIEW')).toBeNull();
    expect(parseViewStatement('CREATE OR REPLACE VIEW')).toBeNull();
  });

  it('should handle case-insensitive CREATE OR REPLACE VIEW', () => {
    const sql = 'create or replace view v_test as select 1';
    const result = parseViewStatement(sql);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('v_test');
    expect(result!.selectSql).toBe('select 1');
  });

  it('should handle multiline complex view with WHERE...IN pattern', () => {
    const sql = `CREATE OR REPLACE VIEW v_enrich_order_details AS
SELECT
  o.order_id,
  o.product_name,
  o.quantity,
  o.unit_price,
  o.quantity * o.unit_price AS line_total
FROM v_clean_orders o
WHERE o.product_name IN (
  SELECT product_name
  FROM v_raw_products
  WHERE category = 'Electronics'
)`;

    const result = parseViewStatement(sql);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('v_enrich_order_details');
    expect(result!.selectSql).toContain('o.quantity * o.unit_price AS line_total');
    expect(result!.selectSql).toContain('WHERE o.product_name IN');
    expect(result!.selectSql).not.toContain('JOIN');
  });
});

describe('PipelineWizard - System Prompt Design', () => {
  it('should explicitly forbid JOINs', () => {
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('NEVER use JOIN');
  });

  it('should prescribe WHERE...IN pattern', () => {
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('WHERE column IN (SELECT column FROM other_view)');
  });

  it('should require CREATE OR REPLACE VIEW statements', () => {
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('CREATE OR REPLACE VIEW');
  });

  it('should define layered naming convention', () => {
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('v_raw_*');
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('v_clean_*');
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('v_enrich_*');
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('v_final_*');
  });

  it('should define the layer ordering', () => {
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('base/raw -> cleaned/filtered -> enriched/calculated -> final/aggregated');
  });

  it('should support CHAT and CLARIFY prefixes for non-SQL responses', () => {
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('CHAT:');
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('CLARIFY:');
  });

  it('should require <think> and <summary> tags', () => {
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('<think>');
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('</think>');
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('<summary>');
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('</summary>');
  });

  it('should instruct single transformation per view', () => {
    expect(PIPELINE_SYSTEM_CONTEXT).toContain('ONE transformation step');
  });
});

describe('PipelineWizard - Layer Management', () => {
  it('should create a layer from a parsed view statement', () => {
    const sql = 'CREATE OR REPLACE VIEW v_raw_sales AS SELECT * FROM sales_data';
    const parsed = parseViewStatement(sql);

    expect(parsed).not.toBeNull();

    const layer: PipelineLayer = {
      id: '1',
      name: parsed!.name,
      description: 'Base view of all sales data',
      sql: parsed!.selectSql,
      viewSql: parsed!.viewSql,
      created: false,
    };

    expect(layer.name).toBe('v_raw_sales');
    expect(layer.sql).toBe('SELECT * FROM sales_data');
    expect(layer.created).toBe(false);
  });

  it('should track multiple layers in order', () => {
    const layers: PipelineLayer[] = [
      {
        id: '1',
        name: 'v_raw_orders',
        description: 'Base orders',
        sql: 'SELECT * FROM orders',
        viewSql: 'CREATE OR REPLACE VIEW v_raw_orders AS SELECT * FROM orders;',
        created: true,
      },
      {
        id: '2',
        name: 'v_clean_orders',
        description: 'Filtered orders for 2024',
        sql: "SELECT * FROM v_raw_orders WHERE year = 2024",
        viewSql: "CREATE OR REPLACE VIEW v_clean_orders AS SELECT * FROM v_raw_orders WHERE year = 2024;",
        created: true,
      },
      {
        id: '3',
        name: 'v_final_revenue',
        description: 'Revenue summary',
        sql: 'SELECT category, SUM(revenue) AS total FROM v_clean_orders GROUP BY category',
        viewSql: 'CREATE OR REPLACE VIEW v_final_revenue AS SELECT category, SUM(revenue) AS total FROM v_clean_orders GROUP BY category;',
        created: false,
      },
    ];

    expect(layers).toHaveLength(3);
    expect(layers[0].name).toBe('v_raw_orders');
    expect(layers[1].name).toBe('v_clean_orders');
    expect(layers[2].name).toBe('v_final_revenue');

    // Layer 2 references layer 1
    expect(layers[1].sql).toContain('v_raw_orders');
    // Layer 3 references layer 2
    expect(layers[2].sql).toContain('v_clean_orders');

    // None use JOINs
    for (const layer of layers) {
      expect(layer.sql.toUpperCase()).not.toContain('JOIN');
    }

    // Track created status
    expect(layers.filter(l => l.created)).toHaveLength(2);
    expect(layers.filter(l => !l.created)).toHaveLength(1);
  });

  it('should remove a layer by filtering', () => {
    const layers: PipelineLayer[] = [
      { id: '1', name: 'v_raw', description: '', sql: '', viewSql: '', created: false },
      { id: '2', name: 'v_clean', description: '', sql: '', viewSql: '', created: false },
      { id: '3', name: 'v_final', description: '', sql: '', viewSql: '', created: false },
    ];

    const afterRemove = layers.filter(l => l.id !== '2');
    expect(afterRemove).toHaveLength(2);
    expect(afterRemove.map(l => l.name)).toEqual(['v_raw', 'v_final']);
  });

  it('should mark a layer as created with preview', () => {
    const layer: PipelineLayer = {
      id: '1',
      name: 'v_raw_orders',
      description: 'All orders',
      sql: 'SELECT * FROM orders',
      viewSql: 'CREATE OR REPLACE VIEW v_raw_orders AS SELECT * FROM orders;',
      created: false,
    };

    const created: PipelineLayer = {
      ...layer,
      created: true,
      error: undefined,
    };

    expect(created.created).toBe(true);
    expect(created.error).toBeUndefined();
  });

  it('should mark a layer as errored', () => {
    const layer: PipelineLayer = {
      id: '1',
      name: 'v_broken',
      description: 'Bad view',
      sql: 'SELECT * FROM nonexistent',
      viewSql: 'CREATE OR REPLACE VIEW v_broken AS SELECT * FROM nonexistent;',
      created: false,
    };

    const errored: PipelineLayer = {
      ...layer,
      error: 'Table nonexistent does not exist',
    };

    expect(errored.error).toBe('Table nonexistent does not exist');
    expect(errored.created).toBe(false);
  });

  it('should build conversation history with layer context', () => {
    const layers: PipelineLayer[] = [
      {
        id: '1',
        name: 'v_raw_orders',
        description: 'All raw orders',
        sql: 'SELECT * FROM orders',
        viewSql: 'CREATE OR REPLACE VIEW v_raw_orders AS SELECT * FROM orders;',
        created: true,
      },
    ];

    const layerContext = layers.length > 0
      ? `\n\nEXISTING PIPELINE LAYERS:\n${layers.map((l, i) => `Layer ${i + 1} (${l.name}): ${l.description}\nSQL: ${l.viewSql}`).join('\n\n')}`
      : '';

    expect(layerContext).toContain('EXISTING PIPELINE LAYERS');
    expect(layerContext).toContain('Layer 1 (v_raw_orders)');
    expect(layerContext).toContain('All raw orders');
    expect(layerContext).toContain('CREATE OR REPLACE VIEW v_raw_orders');
  });

  it('should return empty context when no layers exist', () => {
    const layers: PipelineLayer[] = [];
    const layerContext = layers.length > 0
      ? `\n\nEXISTING PIPELINE LAYERS:\n${layers.map((l, i) => `Layer ${i + 1} (${l.name}): ${l.description}`).join('\n\n')}`
      : '';

    expect(layerContext).toBe('');
  });
});

describe('PipelineWizard - No-JOIN Constraint Validation', () => {
  /** Helper: check if SQL uses JOINs */
  function containsJoin(sql: string): boolean {
    // Match standalone JOIN, LEFT JOIN, RIGHT JOIN, INNER JOIN, OUTER JOIN, CROSS JOIN
    return /\b(JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|OUTER\s+JOIN|CROSS\s+JOIN|FULL\s+JOIN)\b/i.test(sql);
  }

  it('should detect JOINs in SQL', () => {
    expect(containsJoin('SELECT * FROM a JOIN b ON a.id = b.id')).toBe(true);
    expect(containsJoin('SELECT * FROM a LEFT JOIN b ON a.id = b.id')).toBe(true);
    expect(containsJoin('SELECT * FROM a INNER JOIN b ON a.id = b.id')).toBe(true);
    expect(containsJoin('SELECT * FROM a CROSS JOIN b')).toBe(true);
    expect(containsJoin('SELECT * FROM a FULL JOIN b ON a.id = b.id')).toBe(true);
  });

  it('should NOT flag WHERE...IN as a JOIN', () => {
    const sql = `SELECT * FROM orders WHERE customer_id IN (SELECT id FROM customers)`;
    expect(containsJoin(sql)).toBe(false);
  });

  it('should validate pipeline layers are JOIN-free', () => {
    const validPipeline = [
      'CREATE OR REPLACE VIEW v_raw AS SELECT * FROM orders',
      "CREATE OR REPLACE VIEW v_clean AS SELECT * FROM v_raw WHERE status = 'active'",
      'CREATE OR REPLACE VIEW v_final AS SELECT category, SUM(amount) FROM v_clean WHERE product_id IN (SELECT id FROM products) GROUP BY category',
    ];

    for (const sql of validPipeline) {
      const parsed = parseViewStatement(sql);
      expect(parsed).not.toBeNull();
      expect(containsJoin(parsed!.selectSql)).toBe(false);
    }
  });

  it('should detect invalid pipeline layers with JOINs', () => {
    const invalidSql = 'CREATE OR REPLACE VIEW v_bad AS SELECT * FROM orders o JOIN customers c ON o.cust_id = c.id';
    const parsed = parseViewStatement(invalidSql);
    expect(parsed).not.toBeNull();
    expect(containsJoin(parsed!.selectSql)).toBe(true);
  });
});
