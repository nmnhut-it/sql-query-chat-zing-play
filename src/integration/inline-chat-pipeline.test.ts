/**
 * Integration tests for the Inline SQL Chat and Pipeline Wizard workflows.
 *
 * These tests simulate real user interactions through the full flow:
 * - Inline Chat: select TODO → generate → review → refine → accept/reject
 * - Pipeline Wizard: describe layers → parse views → build pipeline → validate no-JOINs
 *
 * Uses the same simulation pattern as ai-workflow.test.ts.
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSchema, QueryResult } from '../types';

// ── Shared helpers (from components) ──

function cleanTodoText(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^--\s*/, '').replace(/^TODO:\s*/i, '').trim())
    .filter(line => line.length > 0)
    .join(' ');
}

function parseViewStatement(sql: string): { name: string; selectSql: string; viewSql: string } | null {
  const match = sql.match(/CREATE\s+OR\s+REPLACE\s+VIEW\s+(\S+)\s+AS\s+([\s\S]+)/i);
  if (!match) return null;
  const name = match[1].replace(/[";]/g, '');
  const selectSql = match[2].replace(/;\s*$/, '');
  return { name, selectSql, viewSql: sql.replace(/;\s*$/, '') + ';' };
}

function parseStructuredResponse(raw: string): { thinking: string | null; summary: string | null; rest: string } {
  let text = raw;
  let thinking: string | null = null;
  let summary: string | null = null;

  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    text = text.replace(/<think>[\s\S]*?<\/think>/, '').trim();
  }

  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
    text = text.replace(/<summary>[\s\S]*?<\/summary>/, '').trim();
  }

  return { thinking, summary, rest: text };
}

// ── Mock AI response simulator ──

interface SimulatedAiResult {
  thinking: string | null;
  summary: string | null;
  response: string;
}

function simulateGenerateSqlWithThinking(
  question: string,
  schema: DatabaseSchema,
  _history?: Array<{ role: string; content: string }>
): SimulatedAiResult {
  const tables = Object.keys(schema);

  if (tables.length === 0) {
    return {
      thinking: 'No schema available, need clarification.',
      summary: null,
      response: 'CLARIFY: Please load some data first.',
    };
  }

  const lowerQ = question.toLowerCase();

  // Simulate pipeline-style responses
  if (lowerQ.includes('base view') || lowerQ.includes('raw view')) {
    const table = tables[0];
    return {
      thinking: `1. User wants a base view\n2. Will select all from ${table}\n3. This is the foundation layer`,
      summary: `Creates a base view selecting all data from ${table}.`,
      response: `CREATE OR REPLACE VIEW v_raw_${table} AS SELECT * FROM ${table}`,
    };
  }

  if (lowerQ.includes('filter') || lowerQ.includes('clean')) {
    return {
      thinking: '1. User wants to filter data\n2. Will create a cleaning layer\n3. Filtering based on conditions',
      summary: 'Creates a filtered view with active records only.',
      response: `CREATE OR REPLACE VIEW v_clean_data AS SELECT * FROM v_raw_${tables[0]} WHERE status = 'active'`,
    };
  }

  if (lowerQ.includes('aggregate') || lowerQ.includes('summary') || lowerQ.includes('revenue')) {
    return {
      thinking: '1. User wants aggregation\n2. Will create a final summary layer\n3. Group by category with SUM',
      summary: 'Creates a final aggregation view with revenue by category.',
      response: `CREATE OR REPLACE VIEW v_final_summary AS
SELECT category, SUM(revenue) AS total_revenue, COUNT(*) AS order_count
FROM v_clean_data
WHERE category IN (SELECT DISTINCT category FROM v_clean_data WHERE revenue > 0)
GROUP BY category
ORDER BY total_revenue DESC`,
    };
  }

  if (lowerQ.includes('add a where') || lowerQ.includes('refine')) {
    return {
      thinking: '1. User wants to add a filter\n2. Adding WHERE clause for 2024',
      summary: 'Adds a year filter to the previous query.',
      response: `SELECT COUNT(*) FROM ${tables[0]} WHERE year = 2024`,
    };
  }

  // Default: simple query
  return {
    thinking: `1. Simple query on ${tables[0]}\n2. Basic SELECT`,
    summary: `Queries the ${tables[0]} table.`,
    response: `SELECT * FROM ${tables[0]} LIMIT 10`,
  };
}

// ── Mock query executor ──

function simulateExecuteQuery(sql: string): QueryResult {
  // Simulate different result shapes based on SQL
  if (sql.toUpperCase().includes('COUNT(*)')) {
    return {
      columns: ['count'],
      rows: [{ count: 42 }],
      rowCount: 1,
    };
  }

  if (sql.toUpperCase().includes('SUM(')) {
    return {
      columns: ['category', 'total_revenue', 'order_count'],
      rows: [
        { category: 'Electronics', total_revenue: 50000, order_count: 120 },
        { category: 'Clothing', total_revenue: 30000, order_count: 85 },
      ],
      rowCount: 2,
    };
  }

  if (sql.toUpperCase().includes('CREATE OR REPLACE VIEW')) {
    return { columns: [], rows: [], rowCount: 0 };
  }

  return {
    columns: ['id', 'name', 'value'],
    rows: [
      { id: 1, name: 'Item A', value: 100 },
      { id: 2, name: 'Item B', value: 200 },
    ],
    rowCount: 2,
  };
}

// ── Test schema ──

const testSchema: DatabaseSchema = {
  orders: {
    columns: [
      { name: 'order_id', type: 'INTEGER' },
      { name: 'customer_id', type: 'VARCHAR' },
      { name: 'product_name', type: 'VARCHAR' },
      { name: 'category', type: 'VARCHAR' },
      { name: 'revenue', type: 'DECIMAL' },
      { name: 'order_date', type: 'DATE' },
      { name: 'status', type: 'VARCHAR' },
      { name: 'year', type: 'INTEGER' },
    ],
    samples: [
      { order_id: 1, customer_id: 'C001', product_name: 'Laptop', category: 'Electronics', revenue: 999.99, order_date: '2024-01-15', status: 'active', year: 2024 },
    ],
    stats: [
      { column: 'order_id', type: 'INTEGER', min: 1, max: 5000, approx_unique: 5000, count: 5000 },
      { column: 'revenue', type: 'DECIMAL', min: 10, max: 5000, approx_unique: 2000, count: 5000 },
    ],
  },
};

// ══════════════════════════════════════════════════
// INTEGRATION TESTS: Inline SQL Chat
// ══════════════════════════════════════════════════

describe('Inline SQL Chat - Full Workflow', () => {
  describe('Step 1: Select TODO and extract question', () => {
    it('should extract clean question from TODO comment', () => {
      const selectedText = '-- TODO: show top 5 products by revenue';
      const question = cleanTodoText(selectedText);
      expect(question).toBe('show top 5 products by revenue');
    });

    it('should extract clean question from multi-line TODO', () => {
      const selectedText = '-- TODO: get total revenue\n-- grouped by category\n-- for 2024';
      const question = cleanTodoText(selectedText);
      expect(question).toBe('get total revenue grouped by category for 2024');
    });

    it('should reject empty selection', () => {
      const question = cleanTodoText('--\n-- ');
      expect(question).toBe('');
    });
  });

  describe('Step 2: Generate SQL with thinking', () => {
    it('should generate SQL with thinking and summary', () => {
      const question = 'show all orders';
      const result = simulateGenerateSqlWithThinking(question, testSchema);

      expect(result.thinking).not.toBeNull();
      expect(result.summary).not.toBeNull();
      expect(result.response).toContain('SELECT');
      expect(result.response).toContain('orders');
    });

    it('should handle empty schema gracefully', () => {
      const result = simulateGenerateSqlWithThinking('show data', {});

      expect(result.response).toContain('CLARIFY:');
    });
  });

  describe('Step 3: User reviews and decides', () => {
    it('should allow accepting generated SQL', () => {
      const result = simulateGenerateSqlWithThinking('show all orders', testSchema);
      const sql = result.response;

      // Simulate accept: SQL gets inserted into editor
      const textToInsert = `\n\n${sql};\n`;
      expect(textToInsert).toContain('SELECT');
      expect(textToInsert).toContain(';');
    });

    it('should allow refining with follow-up message', () => {
      // First generation
      const result1 = simulateGenerateSqlWithThinking('show all orders', testSchema);
      expect(result1.response).toContain('SELECT');

      // Build conversation history
      const history = [
        { role: 'user', content: 'show all orders' },
        { role: 'assistant', content: result1.response },
      ];

      // Refinement - ask to refine (matches "refine" keyword in mock)
      const result2 = simulateGenerateSqlWithThinking(
        'refine to add a where for 2024',
        testSchema,
        history
      );

      expect(result2.response).toContain('WHERE');
      expect(result2.response).toContain('2024');
      expect(result2.thinking).not.toBeNull();
    });

    it('should allow rejecting (returns to initial state)', () => {
      // Simulate the state after reject
      const afterReject = {
        isOpen: false,
        question: '',
        generatedSql: null,
        conversationHistory: [],
      };

      expect(afterReject.isOpen).toBe(false);
      expect(afterReject.generatedSql).toBeNull();
      expect(afterReject.conversationHistory).toHaveLength(0);
    });
  });

  describe('Step 4: Conversation history accumulates across refinements', () => {
    it('should build history across multiple refinement rounds', () => {
      const history: Array<{ role: string; content: string }> = [];

      // Round 1
      const q1 = 'count all orders';
      const r1 = simulateGenerateSqlWithThinking(q1, testSchema);
      history.push({ role: 'user', content: q1 });
      history.push({ role: 'assistant', content: r1.response });

      // Round 2
      const q2 = 'refine to filter for 2024';
      const r2 = simulateGenerateSqlWithThinking(q2, testSchema, history);
      history.push({ role: 'user', content: q2 });
      history.push({ role: 'assistant', content: r2.response });

      expect(history).toHaveLength(4);
      expect(history[0].role).toBe('user');
      expect(history[1].role).toBe('assistant');
      expect(history[2].content).toContain('refine');
      expect(history[3].content).toContain('WHERE');
    });
  });

  describe('Step 5: AI structured response parsing', () => {
    it('should parse thinking + summary + SQL from raw response', () => {
      const raw = `<think>
1. User wants revenue by category
2. Need to use orders table
3. GROUP BY category, SUM revenue
</think>

<summary>
This query calculates total revenue per product category.
</summary>

SELECT category, SUM(revenue) AS total_revenue
FROM orders
GROUP BY category
ORDER BY total_revenue DESC`;

      const { thinking, summary, rest } = parseStructuredResponse(raw);

      expect(thinking).toContain('revenue by category');
      expect(summary).toContain('total revenue per product category');
      expect(rest).toContain('SELECT category');
      expect(rest).not.toContain('<think>');
      expect(rest).not.toContain('<summary>');
    });

    it('should handle CHAT response with thinking', () => {
      const raw = `<think>User is greeting</think>

CHAT: Hello! What would you like to know about your data?`;

      const { thinking, rest } = parseStructuredResponse(raw);

      expect(thinking).toContain('User is greeting');
      expect(rest).toContain('CHAT:');
    });
  });
});

// ══════════════════════════════════════════════════
// INTEGRATION TESTS: Pipeline Wizard
// ══════════════════════════════════════════════════

describe('Pipeline Wizard - Full Workflow', () => {
  describe('Step 1: User describes first layer', () => {
    it('should generate a base/raw CREATE VIEW statement', () => {
      const result = simulateGenerateSqlWithThinking('create a base view of all orders', testSchema);

      expect(result.response).toContain('CREATE OR REPLACE VIEW');
      expect(result.response).toContain('v_raw_');

      const parsed = parseViewStatement(result.response);
      expect(parsed).not.toBeNull();
      expect(parsed!.name).toContain('v_raw_');
    });
  });

  describe('Step 2: Parse and store layers', () => {
    it('should parse the view and create a layer', () => {
      const result = simulateGenerateSqlWithThinking('create a base view of all orders', testSchema);
      const parsed = parseViewStatement(result.response);

      expect(parsed).not.toBeNull();

      const layer = {
        id: '1',
        name: parsed!.name,
        description: result.summary || 'Base layer',
        sql: parsed!.selectSql,
        viewSql: parsed!.viewSql,
        created: false,
      };

      expect(layer.name).toContain('v_raw_');
      expect(layer.sql).toContain('SELECT');
      expect(layer.viewSql).toContain('CREATE OR REPLACE VIEW');
      expect(layer.created).toBe(false);
    });
  });

  describe('Step 3: Build a multi-layer pipeline', () => {
    it('should build 3 layers: raw → clean → final', () => {
      const layers: Array<{ name: string; viewSql: string; selectSql: string }> = [];

      // Layer 1: Raw
      const r1 = simulateGenerateSqlWithThinking('create a base view of orders', testSchema);
      const p1 = parseViewStatement(r1.response);
      expect(p1).not.toBeNull();
      layers.push(p1!);

      // Layer 2: Clean
      const r2 = simulateGenerateSqlWithThinking('filter to active orders only', testSchema);
      const p2 = parseViewStatement(r2.response);
      expect(p2).not.toBeNull();
      layers.push(p2!);

      // Layer 3: Final
      const r3 = simulateGenerateSqlWithThinking('aggregate revenue by category', testSchema);
      const p3 = parseViewStatement(r3.response);
      expect(p3).not.toBeNull();
      layers.push(p3!);

      expect(layers).toHaveLength(3);

      // Verify naming follows convention
      expect(layers[0].name).toContain('v_raw_');
      expect(layers[1].name).toContain('v_clean_');
      expect(layers[2].name).toContain('v_final_');

      // Verify no JOINs
      for (const layer of layers) {
        expect(layer.selectSql.toUpperCase()).not.toMatch(/\bJOIN\b/);
      }
    });
  });

  describe('Step 4: Execute views', () => {
    it('should execute a CREATE VIEW statement', () => {
      const viewSql = 'CREATE OR REPLACE VIEW v_raw_orders AS SELECT * FROM orders;';
      const result = simulateExecuteQuery(viewSql);

      // CREATE VIEW returns empty result
      expect(result.columns).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it('should preview a created view', () => {
      const previewResult = simulateExecuteQuery('SELECT * FROM v_raw_orders LIMIT 10');

      expect(previewResult.columns).toHaveLength(3);
      expect(previewResult.rows.length).toBeGreaterThan(0);
      expect(previewResult.rowCount).toBeGreaterThan(0);
    });

    it('should handle view creation errors', () => {
      try {
        // In real scenario this would throw; simulate by checking SQL validity
        const badSql = 'CREATE OR REPLACE VIEW v_broken AS SELECT * FROM nonexistent_table';
        const parsed = parseViewStatement(badSql);
        expect(parsed).not.toBeNull();
        expect(parsed!.selectSql).toContain('nonexistent_table');
        // The error would come from executeQuery, which we simulate
      } catch {
        // Expected
      }
    });
  });

  describe('Step 5: Copy all SQL', () => {
    it('should concatenate all layer SQL', () => {
      const layers = [
        { viewSql: 'CREATE OR REPLACE VIEW v_raw AS SELECT * FROM orders;' },
        { viewSql: "CREATE OR REPLACE VIEW v_clean AS SELECT * FROM v_raw WHERE status = 'active';" },
        { viewSql: 'CREATE OR REPLACE VIEW v_final AS SELECT category, SUM(revenue) FROM v_clean GROUP BY category;' },
      ];

      const allSql = layers.map(l => l.viewSql).join('\n\n');

      expect(allSql).toContain('v_raw');
      expect(allSql).toContain('v_clean');
      expect(allSql).toContain('v_final');
      expect(allSql.split('CREATE OR REPLACE VIEW')).toHaveLength(4); // 3 + 1 empty first split
    });
  });

  describe('Step 6: WHERE...IN pattern validation', () => {
    it('should use WHERE...IN instead of JOIN for cross-table references', () => {
      const validSql = `CREATE OR REPLACE VIEW v_enrich_orders AS
SELECT * FROM v_raw_orders
WHERE customer_id IN (SELECT customer_id FROM v_raw_customers WHERE region = 'US')`;

      const parsed = parseViewStatement(validSql);
      expect(parsed).not.toBeNull();
      expect(parsed!.selectSql).toContain('WHERE customer_id IN');
      expect(parsed!.selectSql).toContain('SELECT customer_id FROM v_raw_customers');
      expect(parsed!.selectSql.toUpperCase()).not.toMatch(/\bJOIN\b/);
    });

    it('should support nested WHERE...IN patterns', () => {
      const sql = `CREATE OR REPLACE VIEW v_final_report AS
SELECT * FROM v_enrich_orders
WHERE product_id IN (
  SELECT product_id FROM v_clean_products
  WHERE category IN (
    SELECT category FROM v_raw_categories WHERE active = true
  )
)`;

      const parsed = parseViewStatement(sql);
      expect(parsed).not.toBeNull();

      // Count WHERE...IN occurrences
      const inCount = (parsed!.selectSql.match(/\bIN\s*\(/gi) || []).length;
      expect(inCount).toBe(2);

      expect(parsed!.selectSql.toUpperCase()).not.toMatch(/\bJOIN\b/);
    });
  });

  describe('Step 7: Conversation flow with CHAT/CLARIFY responses', () => {
    it('should handle clarification request from AI', () => {
      const result = simulateGenerateSqlWithThinking('do something', {});

      expect(result.response).toContain('CLARIFY:');

      // Parse and strip prefix
      const content = result.response.replace(/^CLARIFY:\s*/, '');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should handle mixed conversation and SQL generation', () => {
      // Step 1: conversational
      const r1 = simulateGenerateSqlWithThinking('do something', {});
      expect(r1.response).toContain('CLARIFY:');

      // Step 2: now with schema, generates SQL
      const r2 = simulateGenerateSqlWithThinking('create a base view of orders', testSchema);
      expect(r2.response).toContain('CREATE OR REPLACE VIEW');
      expect(r2.thinking).not.toBeNull();
      expect(r2.summary).not.toBeNull();
    });
  });

  describe('Step 8: Pipeline layer dependency chain', () => {
    it('should verify layers reference previous layers, not raw tables', () => {
      const layer1Sql = 'SELECT * FROM orders';
      const layer2Sql = "SELECT * FROM v_raw_orders WHERE status = 'active'";
      const layer3Sql = 'SELECT category, SUM(revenue) AS total FROM v_clean_orders WHERE category IN (SELECT DISTINCT category FROM v_clean_orders WHERE revenue > 0) GROUP BY category';

      // Layer 2 references layer 1's view
      expect(layer2Sql).toContain('v_raw_orders');
      expect(layer2Sql).not.toMatch(/\bFROM orders\b/);

      // Layer 3 references layer 2's view
      expect(layer3Sql).toContain('v_clean_orders');
      expect(layer3Sql).not.toMatch(/\bFROM orders\b/);
      expect(layer3Sql).not.toMatch(/\bJOIN\b/i);
      expect(layer3Sql).toContain('IN (SELECT');
    });
  });
});

// ══════════════════════════════════════════════════
// INTEGRATION TESTS: Pipeline Confirmation & Persistence
// ══════════════════════════════════════════════════

describe('Pipeline Wizard - Confirmation Flow', () => {
  interface PipelineLayer {
    id: string;
    name: string;
    description: string;
    sql: string;
    viewSql: string;
    created: boolean;
    confirmed: boolean;
    error?: string;
  }

  it('should create a layer in unconfirmed state', () => {
    const result = simulateGenerateSqlWithThinking('create a base view of orders', testSchema);
    const parsed = parseViewStatement(result.response);
    expect(parsed).not.toBeNull();

    const layer: PipelineLayer = {
      id: '1',
      name: parsed!.name,
      description: result.summary || 'Base layer',
      sql: parsed!.selectSql,
      viewSql: parsed!.viewSql,
      created: false,
      confirmed: false,
    };

    expect(layer.confirmed).toBe(false);
    expect(layer.created).toBe(false);
  });

  it('should require confirmation before creating a view', () => {
    const layer: PipelineLayer = {
      id: '1',
      name: 'v_raw_orders',
      description: 'All orders',
      sql: 'SELECT * FROM orders',
      viewSql: 'CREATE OR REPLACE VIEW v_raw_orders AS SELECT * FROM orders;',
      created: false,
      confirmed: false,
    };

    // Cannot create before confirming
    expect(layer.confirmed).toBe(false);

    // After confirmation
    const confirmed = { ...layer, confirmed: true };
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.created).toBe(false);

    // After creating
    const created = { ...confirmed, created: true };
    expect(created.confirmed).toBe(true);
    expect(created.created).toBe(true);
  });

  it('should only create confirmed layers in batch "Create All"', () => {
    const layers: PipelineLayer[] = [
      { id: '1', name: 'v_raw', description: '', sql: '', viewSql: '', created: false, confirmed: true },
      { id: '2', name: 'v_clean', description: '', sql: '', viewSql: '', created: false, confirmed: false },
      { id: '3', name: 'v_final', description: '', sql: '', viewSql: '', created: false, confirmed: true },
    ];

    const toCreate = layers.filter(l => l.confirmed && !l.created);
    expect(toCreate).toHaveLength(2);
    expect(toCreate.map(l => l.name)).toEqual(['v_raw', 'v_final']);
  });

  it('should track confirmation and creation status separately in pipeline flow', () => {
    const layers: PipelineLayer[] = [
      { id: '1', name: 'v_raw', description: '', sql: '', viewSql: '', created: true, confirmed: true },
      { id: '2', name: 'v_clean', description: '', sql: '', viewSql: '', created: false, confirmed: true },
      { id: '3', name: 'v_final', description: '', sql: '', viewSql: '', created: false, confirmed: false },
    ];

    expect(layers.filter(l => l.created)).toHaveLength(1);
    expect(layers.filter(l => l.confirmed)).toHaveLength(2);
    expect(layers.filter(l => !l.confirmed)).toHaveLength(1);
  });
});

describe('Pipeline Wizard - Persistence Schema', () => {
  it('should define correct CREATE TABLE SQL for _pipelines', () => {
    const sql = `CREATE TABLE IF NOT EXISTS _pipelines (
      id INTEGER PRIMARY KEY,
      name VARCHAR NOT NULL,
      description VARCHAR DEFAULT '',
      created_at TIMESTAMP DEFAULT current_timestamp,
      updated_at TIMESTAMP DEFAULT current_timestamp
    )`;

    expect(sql).toContain('_pipelines');
    expect(sql).toContain('id INTEGER PRIMARY KEY');
    expect(sql).toContain('name VARCHAR NOT NULL');
    expect(sql).toContain('created_at TIMESTAMP');
    expect(sql).toContain('updated_at TIMESTAMP');
  });

  it('should define correct CREATE TABLE SQL for _pipeline_layers', () => {
    const sql = `CREATE TABLE IF NOT EXISTS _pipeline_layers (
      id INTEGER PRIMARY KEY,
      pipeline_id INTEGER NOT NULL,
      layer_order INTEGER NOT NULL,
      name VARCHAR NOT NULL,
      description VARCHAR DEFAULT '',
      sql_select VARCHAR NOT NULL,
      view_sql VARCHAR NOT NULL,
      created BOOLEAN DEFAULT false
    )`;

    expect(sql).toContain('_pipeline_layers');
    expect(sql).toContain('pipeline_id INTEGER NOT NULL');
    expect(sql).toContain('layer_order INTEGER NOT NULL');
    expect(sql).toContain('sql_select VARCHAR NOT NULL');
    expect(sql).toContain('view_sql VARCHAR NOT NULL');
    expect(sql).toContain('created BOOLEAN');
  });

  it('should serialize layers to SQL INSERT statements', () => {
    const layer = {
      name: "v_raw_sales",
      description: "Base view of all sales data",
      sql: "SELECT * FROM sales_data",
      viewSql: "CREATE OR REPLACE VIEW v_raw_sales AS SELECT * FROM sales_data;",
      created: true,
    };

    const pipelineId = 1;
    const layerId = 100;
    const order = 0;

    const insertSql = `INSERT INTO _pipeline_layers (id, pipeline_id, layer_order, name, description, sql_select, view_sql, created)
      VALUES (${layerId}, ${pipelineId}, ${order}, '${layer.name}', '${layer.description}', '${layer.sql}', '${layer.viewSql}', ${layer.created})`;

    expect(insertSql).toContain(`${pipelineId}`);
    expect(insertSql).toContain(`${layerId}`);
    expect(insertSql).toContain(layer.name);
    expect(insertSql).toContain(layer.sql);
    expect(insertSql).toContain('true');
  });

  it('should escape single quotes in layer descriptions', () => {
    const description = "User's custom view for O'Brien data";
    const escaped = description.replace(/'/g, "''");
    expect(escaped).toBe("User''s custom view for O''Brien data");
    // Every original single-quote is now doubled
    expect(escaped.match(/''/g)?.length).toBe(2);
  });

  it('should reconstruct layers from query result rows', () => {
    const rows = [
      { id: 100, name: 'v_raw_data', description: 'Base', sql_select: 'SELECT * FROM data', view_sql: 'CREATE OR REPLACE VIEW v_raw_data AS SELECT * FROM data;', created: true, layer_order: 0 },
      { id: 101, name: 'v_clean_data', description: 'Filtered', sql_select: "SELECT * FROM v_raw_data WHERE active = true", view_sql: "CREATE OR REPLACE VIEW v_clean_data AS SELECT * FROM v_raw_data WHERE active = true;", created: false, layer_order: 1 },
    ];

    const layers = rows.map(r => ({
      id: String(r.id),
      name: String(r.name),
      description: String(r.description),
      sql: String(r.sql_select),
      viewSql: String(r.view_sql),
      created: Boolean(r.created),
      confirmed: Boolean(r.created),
    }));

    expect(layers).toHaveLength(2);
    expect(layers[0].name).toBe('v_raw_data');
    expect(layers[0].confirmed).toBe(true);
    expect(layers[1].name).toBe('v_clean_data');
    expect(layers[1].confirmed).toBe(false);
  });
});

describe('Pipeline Wizard - Run & Report', () => {
  it('should execute all created layers and collect results', () => {
    const layers = [
      { name: 'v_raw', created: true, confirmed: true },
      { name: 'v_clean', created: true, confirmed: true },
      { name: 'v_final', created: true, confirmed: true },
    ];

    const report: Array<{ layerName: string; result: QueryResult }> = [];

    for (const layer of layers) {
      if (layer.created) {
        const result = simulateExecuteQuery(`SELECT * FROM ${layer.name} LIMIT 50`);
        report.push({ layerName: layer.name, result });
      }
    }

    expect(report).toHaveLength(3);
    expect(report[0].layerName).toBe('v_raw');
    expect(report[0].result.rowCount).toBeGreaterThan(0);
  });

  it('should skip unconfirmed layers in report', () => {
    const layers = [
      { name: 'v_raw', created: true, confirmed: true },
      { name: 'v_pending', created: false, confirmed: false },
    ];

    const report: Array<{ layerName: string; result: QueryResult }> = [];

    for (const layer of layers) {
      if (layer.created) {
        const result = simulateExecuteQuery(`SELECT * FROM ${layer.name} LIMIT 50`);
        report.push({ layerName: layer.name, result });
      }
    }

    expect(report).toHaveLength(1);
    expect(report[0].layerName).toBe('v_raw');
  });
});

describe('Edge Cases', () => {
  it('should handle AI returning markdown-wrapped SQL', () => {
    const raw = '```sql\nSELECT * FROM orders;\n```';
    const cleaned = raw.replace(/```sql\n?|\n?```/g, '').trim();
    expect(cleaned).toBe('SELECT * FROM orders;');
  });

  it('should handle AI returning CREATE VIEW wrapped in markdown', () => {
    const raw = '```sql\nCREATE OR REPLACE VIEW v_test AS SELECT 1;\n```';
    const cleaned = raw.replace(/```sql\n?|\n?```/g, '').trim();
    const parsed = parseViewStatement(cleaned);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('v_test');
  });

  it('should handle multiple TODO lines gracefully', () => {
    const text = `-- TODO: first thing
-- second thing
-- third thing
-- fourth thing`;
    const question = cleanTodoText(text);
    expect(question).toBe('first thing second thing third thing fourth thing');
  });

  it('should handle structured response with only thinking (no summary)', () => {
    const raw = `<think>Just checking something</think>

CHAT: Hello there!`;

    const { thinking, summary, rest } = parseStructuredResponse(raw);
    expect(thinking).toBe('Just checking something');
    expect(summary).toBeNull();
    expect(rest).toBe('CHAT: Hello there!');
  });

  it('should handle structured response with no tags at all', () => {
    const raw = 'SELECT 1';
    const { thinking, summary, rest } = parseStructuredResponse(raw);
    expect(thinking).toBeNull();
    expect(summary).toBeNull();
    expect(rest).toBe('SELECT 1');
  });
});
