/**
 * Tests for AI hook schema handling and prompt generation.
 * Verifies that database schema is correctly formatted and included in user messages.
 *
 * Note: Schema is now included in user message (not system prompt) for reliability.
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSchema } from '../types';
import { DEFAULT_PROMPTS } from '../constants/aiPrompts';

/** Build schema description for AI prompts (extracted from useAI.ts) */
const buildSchemaDescription = (schema: DatabaseSchema, includeDetails = true): string => {
  return Object.entries(schema)
    .map(([table, info]) => {
      const cols = info.columns.map((c) => `${c.name} (${c.type})`).join(', ');
      if (!includeDetails) {
        return `${table}: ${cols}`;
      }
      const sampleRows = JSON.stringify(info.samples);
      const statsInfo = JSON.stringify(info.stats);
      return `Table "${table}": ${cols}\nSamples: ${sampleRows}\nStats: ${statsInfo}`;
    })
    .join('\n\n');
};

/** Build user message with schema (mirrors useAI.ts logic) */
const buildUserMessage = (question: string, schema: DatabaseSchema): string => {
  const hasSchema = Object.keys(schema).length > 0;
  if (!hasSchema) {
    return question;
  }
  const schemaDesc = buildSchemaDescription(schema);
  return `DATABASE SCHEMA:\n${schemaDesc}\n\nQUESTION: ${question}`;
};

/** Parse <think> and <summary> tags from AI response (mirrors useAI.ts logic) */
const parseStructuredResponse = (raw: string): { thinking: string | null; summary: string | null; rest: string } => {
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
};

describe('useAI - parseStructuredResponse', () => {
  it('should parse thinking and summary from a full SQL response', () => {
    const raw = `<think>
1. User wants total revenue
2. Using sales_data table, revenue column
3. Simple SUM aggregation
4. No filters needed
</think>

<summary>
This query calculates the total revenue across all sales by summing the revenue column.
</summary>

SELECT SUM(revenue) AS total_revenue FROM sales_data`;

    const result = parseStructuredResponse(raw);

    expect(result.thinking).toContain('User wants total revenue');
    expect(result.thinking).toContain('Simple SUM aggregation');
    expect(result.summary).toContain('total revenue across all sales');
    expect(result.rest).toBe('SELECT SUM(revenue) AS total_revenue FROM sales_data');
  });

  it('should handle response with thinking only (no summary)', () => {
    const raw = `<think>
User is saying hello, this is a greeting.
</think>

CHAT: Hello! How can I help you with your data?`;

    const result = parseStructuredResponse(raw);

    expect(result.thinking).toContain('User is saying hello');
    expect(result.summary).toBeNull();
    expect(result.rest).toBe('CHAT: Hello! How can I help you with your data?');
  });

  it('should handle response with no tags at all', () => {
    const raw = 'SELECT * FROM users LIMIT 10';

    const result = parseStructuredResponse(raw);

    expect(result.thinking).toBeNull();
    expect(result.summary).toBeNull();
    expect(result.rest).toBe('SELECT * FROM users LIMIT 10');
  });

  it('should handle multiline thinking with numbered steps', () => {
    const raw = `<think>
1. The user asks for orders per customer
2. Need to join orders and customers tables
3. GROUP BY customer_name, COUNT orders
4. Sort descending
</think>

<summary>
This query counts orders per customer by joining the orders and customers tables, grouping by customer name, and sorting from highest to lowest.
</summary>

SELECT c.name, COUNT(o.id) AS order_count
FROM customers c
JOIN orders o ON c.id = o.customer_id
GROUP BY c.name
ORDER BY order_count DESC`;

    const result = parseStructuredResponse(raw);

    expect(result.thinking).toContain('join orders and customers tables');
    expect(result.summary).toContain('counts orders per customer');
    expect(result.rest).toContain('SELECT c.name');
    expect(result.rest).toContain('ORDER BY order_count DESC');
    // Should not contain any tags in the rest
    expect(result.rest).not.toContain('<think>');
    expect(result.rest).not.toContain('<summary>');
  });

  it('should handle CLARIFY response with thinking', () => {
    const raw = `<think>
The user mentions "churn rate" but I don't see a churn-related column. Need clarification.
</think>

CLARIFY: What do you mean by "churn rate"? Do you want to measure users who stopped purchasing after a certain date?`;

    const result = parseStructuredResponse(raw);

    expect(result.thinking).toContain('churn rate');
    expect(result.summary).toBeNull();
    expect(result.rest.startsWith('CLARIFY:')).toBe(true);
  });

  it('should handle summary with special characters', () => {
    const raw = `<think>Checking revenue > 1000</think>

<summary>This query finds all sales where revenue is greater than $1,000.</summary>

SELECT * FROM sales_data WHERE revenue > 1000`;

    const result = parseStructuredResponse(raw);

    expect(result.thinking).toBe('Checking revenue > 1000');
    expect(result.summary).toBe('This query finds all sales where revenue is greater than $1,000.');
    expect(result.rest).toBe('SELECT * FROM sales_data WHERE revenue > 1000');
  });
});

describe('useAI - Schema Handling', () => {
  describe('buildSchemaDescription', () => {
    it('should return empty string for empty schema', () => {
      const emptySchema: DatabaseSchema = {};
      const result = buildSchemaDescription(emptySchema);

      expect(result).toBe('');
      expect(result.length).toBe(0);
    });

    it('should format single table schema correctly', () => {
      const schema: DatabaseSchema = {
        users: {
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'VARCHAR' },
          ],
          samples: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
          ],
          stats: [
            { column: 'id', type: 'INTEGER', min: 1, max: 2, approx_unique: 2, count: 2 },
          ],
        },
      };

      const result = buildSchemaDescription(schema);

      expect(result).toContain('Table "users"');
      expect(result).toContain('id (INTEGER)');
      expect(result).toContain('name (VARCHAR)');
      expect(result).toContain('Samples:');
      expect(result).toContain('Stats:');
    });

    it('should format multiple tables correctly', () => {
      const schema: DatabaseSchema = {
        orders: {
          columns: [{ name: 'order_id', type: 'INTEGER' }],
          samples: [],
          stats: [],
        },
        products: {
          columns: [{ name: 'product_id', type: 'INTEGER' }],
          samples: [],
          stats: [],
        },
      };

      const result = buildSchemaDescription(schema);

      expect(result).toContain('Table "orders"');
      expect(result).toContain('Table "products"');
      expect(result).toContain('order_id');
      expect(result).toContain('product_id');
    });

    it('should include samples and stats when includeDetails is true', () => {
      const schema: DatabaseSchema = {
        test_table: {
          columns: [{ name: 'col1', type: 'TEXT' }],
          samples: [{ col1: 'sample_value' }],
          stats: [{ column: 'col1', type: 'TEXT', min: 'a', max: 'z', approx_unique: 26, count: 100 }],
        },
      };

      const withDetails = buildSchemaDescription(schema, true);
      const withoutDetails = buildSchemaDescription(schema, false);

      expect(withDetails).toContain('sample_value');
      expect(withDetails).toContain('approx_unique');
      expect(withoutDetails).not.toContain('sample_value');
      expect(withoutDetails).not.toContain('approx_unique');
    });
  });

  describe('buildUserMessage', () => {
    it('should include schema in user message when tables exist', () => {
      const schema: DatabaseSchema = {
        sales: {
          columns: [
            { name: 'date', type: 'DATE' },
            { name: 'revenue', type: 'DECIMAL' },
          ],
          samples: [],
          stats: [],
        },
      };

      const userMessage = buildUserMessage('show me total revenue', schema);

      expect(userMessage).toContain('DATABASE SCHEMA:');
      expect(userMessage).toContain('Table "sales"');
      expect(userMessage).toContain('date (DATE)');
      expect(userMessage).toContain('revenue (DECIMAL)');
      expect(userMessage).toContain('QUESTION: show me total revenue');
    });

    it('should return only question when schema is empty', () => {
      const emptySchema: DatabaseSchema = {};
      const question = 'hello world';

      const userMessage = buildUserMessage(question, emptySchema);

      expect(userMessage).toBe(question);
      expect(userMessage).not.toContain('DATABASE SCHEMA:');
    });

    it('should include column types in the user message', () => {
      const schema: DatabaseSchema = {
        events: {
          columns: [
            { name: 'event_id', type: 'BIGINT' },
            { name: 'event_time', type: 'TIMESTAMP' },
            { name: 'user_agent', type: 'VARCHAR' },
          ],
          samples: [],
          stats: [],
        },
      };

      const userMessage = buildUserMessage('query events', schema);

      expect(userMessage).toContain('event_id (BIGINT)');
      expect(userMessage).toContain('event_time (TIMESTAMP)');
      expect(userMessage).toContain('user_agent (VARCHAR)');
    });
  });

  describe('System Prompt', () => {
    it('should not contain schema placeholder', () => {
      // Schema is now in user message, not system prompt
      expect(DEFAULT_PROMPTS.GENERATE_SQL).not.toContain('{schema}');
    });

    it('should contain instructions for using schema from user message', () => {
      expect(DEFAULT_PROMPTS.GENERATE_SQL).toContain('database schema will be provided in the user\'s message');
    });
  });

  describe('Real-world scenario tests', () => {
    it('should handle the raw_log_entries__2_ table scenario from the bug report', () => {
      // This is the actual table structure from the user's issue
      const schema: DatabaseSchema = {
        raw_log_entries__2_: {
          columns: [
            { name: 'user_id', type: 'VARCHAR' },
            { name: 'timestamp', type: 'TIMESTAMP' },
            { name: 'action', type: 'VARCHAR' },
            { name: 'payload', type: 'VARCHAR' },
            { name: 'processed_at', type: 'TIMESTAMP' },
          ],
          samples: [
            {
              user_id: 'U001',
              timestamp: '2024-01-15 10:30:00',
              action: 'page_view',
              payload: '{"page": "/home"}',
              processed_at: '2024-01-15 10:30:01',
            },
          ],
          stats: [
            { column: 'user_id', type: 'VARCHAR', min: null, max: null, approx_unique: 150, count: 1000 },
            { column: 'timestamp', type: 'TIMESTAMP', min: '2024-01-01', max: '2024-01-31', approx_unique: 800, count: 1000 },
          ],
        },
      };

      const userMessage = buildUserMessage('query number of date group by user', schema);

      // The AI should now see the table and its columns in the user message
      expect(userMessage).toContain('raw_log_entries__2_');
      expect(userMessage).toContain('user_id');
      expect(userMessage).toContain('timestamp');
      expect(userMessage).toContain('user_id (VARCHAR)');
      expect(userMessage).toContain('timestamp (TIMESTAMP)');
      expect(userMessage).toContain('QUESTION: query number of date group by user');
    });

    it('should handle empty schema gracefully (no crash, just question)', () => {
      const emptySchema: DatabaseSchema = {};
      const question = 'hello, give me number of distinct user group by date';

      const userMessage = buildUserMessage(question, emptySchema);

      // Should just be the question, no schema
      expect(userMessage).toBe(question);
    });
  });
});
