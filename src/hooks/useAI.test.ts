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
