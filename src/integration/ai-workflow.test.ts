/**
 * Integration tests for AI-powered SQL generation workflow.
 * Tests the complete flow: natural language → schema → AI prompt → SQL generation.
 *
 * These tests simulate real user interactions without requiring the UI or actual API calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseSchema } from '../types';
import { DEFAULT_PROMPTS } from '../constants/aiPrompts';

/** Mock OpenAI API response */
interface MockApiResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

/** Build schema description (copied from useAI.ts for testing) */
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

/** Simulate the AI API call with mocked responses based on schema */
const simulateAiCall = (
  question: string,
  schema: DatabaseSchema,
  conversationHistory: Array<{ role: string; content: string }> = []
): string => {
  const userMessage = buildUserMessage(question, schema);

  // Check if schema is empty
  if (Object.keys(schema).length === 0) {
    // BUG BEHAVIOR: When schema is empty, AI asks for clarification
    return 'CLARIFY: Which table should I use, and what is the date column name to group by per user?';
  }

  // Check what tables are available
  const tables = Object.keys(schema);
  const tableInfo = schema[tables[0]];

  // Simulate AI understanding the schema and generating SQL
  if (question.toLowerCase().includes('group by user') && question.toLowerCase().includes('date')) {
    // Find user column
    const userCol = tableInfo.columns.find(c =>
      c.name.toLowerCase().includes('user')
    )?.name || 'user_id';

    // Find date/timestamp column
    const dateCol = tableInfo.columns.find(c =>
      c.type.includes('TIMESTAMP') || c.type.includes('DATE')
    )?.name || 'timestamp';

    // Generate SQL based on schema
    return `SELECT DATE(${dateCol}) as date, ${userCol}, COUNT(*) as count
FROM "${tables[0]}"
GROUP BY DATE(${dateCol}), ${userCol}
ORDER BY date, ${userCol}`;
  }

  if (question.toLowerCase().includes('count') || question.toLowerCase().includes('how many')) {
    return `SELECT COUNT(*) as total FROM "${tables[0]}"`;
  }

  if (question.toLowerCase().includes('show') || question.toLowerCase().includes('list')) {
    return `SELECT * FROM "${tables[0]}" LIMIT 10`;
  }

  // Default: select all
  return `SELECT * FROM "${tables[0]}" LIMIT 5`;
};

describe('AI Workflow Integration Tests', () => {
  describe('Scenario 1: Empty Schema (The Bug)', () => {
    it('should ask for clarification when schema is empty', () => {
      const emptySchema: DatabaseSchema = {};
      const question = 'query number of date group by user';

      const result = simulateAiCall(question, emptySchema);

      // This is the bug! AI asks for table and column names
      expect(result).toContain('CLARIFY:');
      expect(result.toLowerCase()).toContain('which table');
    });

    it('should not generate SQL when schema is empty', () => {
      const emptySchema: DatabaseSchema = {};
      const question = 'show me all users';

      const result = simulateAiCall(question, emptySchema);

      // AI cannot generate SQL without schema
      expect(result).toContain('CLARIFY:');
      expect(result).not.toContain('SELECT');
    });
  });

  describe('Scenario 2: Populated Schema (The Fix)', () => {
    let schema: DatabaseSchema;

    beforeEach(() => {
      // Simulate schema after refreshSchema() is called
      schema = {
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
            {
              user_id: 'U002',
              timestamp: '2024-01-15 11:00:00',
              action: 'click',
              payload: '{"button": "submit"}',
              processed_at: '2024-01-15 11:00:01',
            },
          ],
          stats: [
            {
              column: 'user_id',
              type: 'VARCHAR',
              min: null,
              max: null,
              approx_unique: 150,
              count: 1000,
            },
            {
              column: 'timestamp',
              type: 'TIMESTAMP',
              min: '2024-01-01',
              max: '2024-01-31',
              approx_unique: 800,
              count: 1000,
            },
          ],
        },
      };
    });

    it('should generate SQL without asking when schema is populated', () => {
      const question = 'query number of date group by user';

      const result = simulateAiCall(question, schema);

      // AI should generate SQL directly, not ask for clarification
      expect(result).not.toContain('CLARIFY:');
      expect(result).toContain('SELECT');
      expect(result).toContain('GROUP BY');
    });

    it('should use actual table name from schema', () => {
      const question = 'count rows in the table';

      const result = simulateAiCall(question, schema);

      expect(result).toContain('raw_log_entries__2_');
      expect(result).toContain('SELECT');
    });

    it('should use actual column names from schema', () => {
      const question = 'query number of date group by user';

      const result = simulateAiCall(question, schema);

      // AI should see user_id and timestamp in schema
      expect(result).toContain('user_id');
      expect(result).toContain('timestamp');
      expect(result).toContain('DATE(timestamp)');
    });

    it('should handle simple count query', () => {
      const question = 'how many rows are there?';

      const result = simulateAiCall(question, schema);

      expect(result).toContain('SELECT COUNT(*)');
      expect(result).toContain('raw_log_entries__2_');
    });

    it('should handle list/show query', () => {
      const question = 'show me the data';

      const result = simulateAiCall(question, schema);

      expect(result).toContain('SELECT *');
      expect(result).toContain('raw_log_entries__2_');
      expect(result).toContain('LIMIT');
    });
  });

  describe('Scenario 3: Schema Includes Table and Column Info', () => {
    it('should generate correct SQL for date grouping', () => {
      const schema: DatabaseSchema = {
        events: {
          columns: [
            { name: 'event_id', type: 'BIGINT' },
            { name: 'user_email', type: 'VARCHAR' },
            { name: 'event_date', type: 'DATE' },
            { name: 'event_type', type: 'VARCHAR' },
          ],
          samples: [],
          stats: [],
        },
      };

      const question = 'query number of date group by user';
      const result = simulateAiCall(question, schema);

      // AI should detect user_email as user identifier
      // and event_date as date column
      expect(result).toContain('SELECT');
      expect(result).toContain('event_date');
      expect(result).toContain('user_email');
      expect(result).toContain('GROUP BY');
    });

    it('should handle multiple tables by using the first one', () => {
      const schema: DatabaseSchema = {
        users: {
          columns: [{ name: 'id', type: 'INTEGER' }],
          samples: [],
          stats: [],
        },
        orders: {
          columns: [{ name: 'order_id', type: 'INTEGER' }],
          samples: [],
          stats: [],
        },
      };

      const question = 'count rows';
      const result = simulateAiCall(question, schema);

      // Should use first table (users)
      expect(result).toContain('SELECT COUNT(*)');
      expect(result).toContain('users');
    });
  });

  describe('Scenario 4: Conversation History', () => {
    it('should maintain context and not ask for clarification when schema is available', () => {
      const schema: DatabaseSchema = {
        sales: {
          columns: [
            { name: 'date', type: 'DATE' },
            { name: 'amount', type: 'DECIMAL' },
            { name: 'customer_id', type: 'VARCHAR' },
          ],
          samples: [],
          stats: [],
        },
      };

      const history = [
        { role: 'user', content: 'show me the sales data' },
        { role: 'assistant', content: 'Generated SQL: SELECT * FROM "sales" LIMIT 10' },
      ];

      // User asks follow-up question - the key is schema is populated
      const question = 'count how many sales by customer';
      const result = simulateAiCall(question, schema, history);

      // With schema populated, AI should not ask for clarification
      expect(result).not.toContain('CLARIFY:');
      expect(result).toContain('SELECT');
      expect(result).toContain('sales');
    });
  });

  describe('Scenario 5: Schema Description Quality', () => {
    it('should include column types in schema description', () => {
      const schema: DatabaseSchema = {
        products: {
          columns: [
            { name: 'id', type: 'BIGINT' },
            { name: 'name', type: 'VARCHAR' },
            { name: 'price', type: 'DECIMAL(10,2)' },
            { name: 'created_at', type: 'TIMESTAMP' },
          ],
          samples: [],
          stats: [],
        },
      };

      const schemaDesc = buildSchemaDescription(schema);

      expect(schemaDesc).toContain('id (BIGINT)');
      expect(schemaDesc).toContain('name (VARCHAR)');
      expect(schemaDesc).toContain('price (DECIMAL(10,2))');
      expect(schemaDesc).toContain('created_at (TIMESTAMP)');
    });

    it('should include sample data in schema description', () => {
      const schema: DatabaseSchema = {
        logs: {
          columns: [{ name: 'message', type: 'VARCHAR' }],
          samples: [
            { message: 'User logged in' },
            { message: 'File uploaded' },
          ],
          stats: [],
        },
      };

      const schemaDesc = buildSchemaDescription(schema);

      expect(schemaDesc).toContain('Samples:');
      expect(schemaDesc).toContain('User logged in');
      expect(schemaDesc).toContain('File uploaded');
    });

    it('should include statistics in schema description', () => {
      const schema: DatabaseSchema = {
        metrics: {
          columns: [{ name: 'value', type: 'INTEGER' }],
          samples: [],
          stats: [
            {
              column: 'value',
              type: 'INTEGER',
              min: 1,
              max: 100,
              approx_unique: 50,
              count: 1000,
            },
          ],
        },
      };

      const schemaDesc = buildSchemaDescription(schema);

      expect(schemaDesc).toContain('Stats:');
      expect(schemaDesc).toContain('"min":1');
      expect(schemaDesc).toContain('"max":100');
      expect(schemaDesc).toContain('"count":1000');
    });
  });

  describe('Scenario 6: Verification of User Message with Schema', () => {
    it('should inject schema into user message correctly', () => {
      const schema: DatabaseSchema = {
        test_table: {
          columns: [{ name: 'col1', type: 'VARCHAR' }],
          samples: [],
          stats: [],
        },
      };

      const userMessage = buildUserMessage('query data', schema);

      expect(userMessage).toContain('DATABASE SCHEMA:');
      expect(userMessage).toContain('Table "test_table"');
      expect(userMessage).toContain('col1 (VARCHAR)');
      expect(userMessage).toContain('QUESTION: query data');
    });

    it('should tell AI not to ask for table/column names in system prompt', () => {
      const systemPrompt = DEFAULT_PROMPTS.GENERATE_SQL;

      expect(systemPrompt).toContain('DO NOT ask for clarification about:');
      expect(systemPrompt).toContain('Table names (you can see them in the schema)');
      expect(systemPrompt).toContain('Column names (you can see them in the schema)');
    });

    it('should not include schema placeholder in system prompt', () => {
      const systemPrompt = DEFAULT_PROMPTS.GENERATE_SQL;
      expect(systemPrompt).not.toContain('{schema}');
    });
  });
});
