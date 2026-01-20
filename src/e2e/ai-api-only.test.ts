/**
 * E2E tests for AI API integration with real schema data.
 * Tests AI's ability to generate SQL when given populated schema vs empty schema.
 *
 * IMPORTANT: These tests make real API calls and require:
 * - VITE_OPENAI_API_KEY in .env
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect } from 'vitest';
import type { DatabaseSchema } from '../types';
import { DEFAULT_PROMPTS } from '../constants/aiPrompts';

/** Load environment variables */
const API_KEY = process.env.VITE_OPENAI_API_KEY || '';
const API_URL = process.env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
const MODEL = process.env.VITE_OPENAI_MODEL || 'gpt-4o-mini';

/** Skip E2E tests if no API key */
const skipE2E = !API_KEY;

if (skipE2E) {
  console.log('⚠️  Skipping E2E tests: VITE_OPENAI_API_KEY not set in .env');
}

/** Build schema description */
const buildSchemaDescription = (schema: DatabaseSchema): string => {
  return Object.entries(schema)
    .map(([table, info]) => {
      const cols = info.columns.map((c) => `${c.name} (${c.type})`).join(', ');
      const sampleRows = JSON.stringify(info.samples);
      const statsInfo = JSON.stringify(info.stats);
      return `Table "${table}": ${cols}\nSamples: ${sampleRows}\nStats: ${statsInfo}`;
    })
    .join('\n\n');
};

/** Call real AI API - schema is included in user message */
const callRealAI = async (question: string, schema: DatabaseSchema): Promise<string> => {
  const schemaDesc = buildSchemaDescription(schema);
  const systemPrompt = DEFAULT_PROMPTS.GENERATE_SQL;
  const hasSchema = Object.keys(schema).length > 0;
  const userMessage = hasSchema
    ? `DATABASE SCHEMA:\n${schemaDesc}\n\nQUESTION: ${question}`
    : question;

  console.log('🔑 API URL:', API_URL);
  console.log('🔑 API Key (first 20 chars):', API_KEY.substring(0, 20) + '...');
  console.log('🔑 Model:', MODEL);

  const requestBody = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0,
  };

  console.log('📤 Request body:', JSON.stringify(requestBody, null, 2).substring(0, 500) + '...');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  });

  console.log('📥 Response status:', response.status, response.statusText);
  console.log('📥 Response headers:', JSON.stringify(Object.fromEntries(response.headers.entries())));

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ API Error:', errorText);
    throw new Error(`AI API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  console.log('📥 Response data:', JSON.stringify(data, null, 2).substring(0, 300) + '...');
  return data.choices[0].message.content.trim();
};

describe.skipIf(skipE2E)('E2E: Real AI API Tests', () => {
  describe('Bug Scenario: Empty Schema', () => {
    it('should use generic/placeholder names when schema is empty (reproduces the bug)', async () => {
      const emptySchema: DatabaseSchema = {};
      const question = 'query number of date group by user';

      console.log('🤖 Testing with EMPTY schema...');
      console.log('Question:', question);

      const response = await callRealAI(question, emptySchema);
      console.log('📝 AI Response:', response);

      // When schema is empty, AI either:
      // 1. Asks for clarification (CLARIFY:)
      // 2. Uses placeholder/generic table names (your_table_name, table_name, events, etc.)
      const responseLower = response.toLowerCase();

      const asksForClarification =
        responseLower.includes('clarify') ||
        responseLower.includes('which table') ||
        responseLower.includes('what is the');

      const usesPlaceholder =
        responseLower.includes('your_table') ||
        responseLower.includes('table_name') ||
        responseLower.includes('your table');

      // Either behavior demonstrates the bug - AI doesn't know the actual table name
      expect(asksForClarification || usesPlaceholder).toBe(true);
    }, 30000);
  });

  describe('Fixed Scenario: Populated Schema', () => {
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

    it('should generate SQL without asking when schema is populated (the fix)', async () => {
      const question = 'query number of date group by user';

      console.log('🤖 Testing with POPULATED schema...');
      console.log('Question:', question);
      console.log('Schema has table:', Object.keys(schema));

      const response = await callRealAI(question, schema);
      console.log('📝 AI Response:', response);

      // Clean response (remove markdown)
      const sql = response.replace(/```sql\n?|\n?```/g, '').trim();

      // AI should generate SQL, not ask for clarification
      expect(sql.toUpperCase()).toContain('SELECT');
      expect(sql).not.toMatch(/clarify|which table|what is the|need more|specify/i);
    }, 30000);

    it('should use actual table name from schema', async () => {
      const question = 'how many rows in the table?';

      console.log('🤖 Testing table name extraction...');
      const response = await callRealAI(question, schema);
      console.log('📝 AI Response:', response);

      const sql = response.replace(/```sql\n?|\n?```/g, '').trim();

      // Should use the actual table name
      expect(sql).toContain('raw_log_entries__2_');
    }, 30000);

    it('should use actual column names from schema', async () => {
      const question = 'query number of date group by user';

      console.log('🤖 Testing column name extraction...');
      const response = await callRealAI(question, schema);
      console.log('📝 AI Response:', response);

      const sql = response.replace(/```sql\n?|\n?```/g, '').trim();

      // Should use actual column names
      expect(sql).toMatch(/user_id/i);
      expect(sql).toMatch(/timestamp/i);
    }, 30000);

    it('should generate SQL for count query', async () => {
      const question = 'how many events are there?';

      console.log('🤖 Testing count query...');
      const response = await callRealAI(question, schema);
      console.log('📝 AI Response:', response);

      const sql = response.replace(/```sql\n?|\n?```/g, '').trim();

      expect(sql.toUpperCase()).toContain('SELECT');
      expect(sql.toUpperCase()).toContain('COUNT');
    }, 30000);

    it('should generate SQL for group by query', async () => {
      const question = 'count events by user';

      console.log('🤖 Testing group by query...');
      const response = await callRealAI(question, schema);
      console.log('📝 AI Response:', response);

      const sql = response.replace(/```sql\n?|\n?```/g, '').trim();

      expect(sql.toUpperCase()).toContain('SELECT');
      expect(sql.toUpperCase()).toContain('GROUP BY');
      expect(sql).toMatch(/user_id/i);
    }, 30000);
  });

  describe('Multiple Table Scenario', () => {
    const schema: DatabaseSchema = {
      users: {
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'email', type: 'VARCHAR' },
          { name: 'created_at', type: 'TIMESTAMP' },
        ],
        samples: [
          { id: 1, email: 'user1@example.com', created_at: '2024-01-01' },
        ],
        stats: [],
      },
      events: {
        columns: [
          { name: 'event_id', type: 'INTEGER' },
          { name: 'user_id', type: 'INTEGER' },
          { name: 'event_type', type: 'VARCHAR' },
          { name: 'timestamp', type: 'TIMESTAMP' },
        ],
        samples: [
          { event_id: 1, user_id: 1, event_type: 'login', timestamp: '2024-01-01 10:00:00' },
        ],
        stats: [],
      },
    };

    it('should handle multiple tables in schema', async () => {
      const question = 'how many events per user?';

      console.log('🤖 Testing with multiple tables...');
      const response = await callRealAI(question, schema);
      console.log('📝 AI Response:', response);

      const sql = response.replace(/```sql\n?|\n?```/g, '').trim();

      // Should reference the events table
      expect(sql.toLowerCase()).toContain('events');
      expect(sql.toUpperCase()).toContain('GROUP BY');
    }, 30000);
  });

  describe('Schema Quality Tests', () => {
    it('should benefit from sample data in schema', async () => {
      const schemaWithSamples: DatabaseSchema = {
        products: {
          columns: [
            { name: 'product_id', type: 'INTEGER' },
            { name: 'category', type: 'VARCHAR' },
            { name: 'price', type: 'DECIMAL' },
          ],
          samples: [
            { product_id: 1, category: 'Electronics', price: 999.99 },
            { product_id: 2, category: 'Clothing', price: 49.99 },
          ],
          stats: [],
        },
      };

      const question = 'show products in Electronics category';

      console.log('🤖 Testing with sample data...');
      const response = await callRealAI(question, schemaWithSamples);
      console.log('📝 AI Response:', response);

      const sql = response.replace(/```sql\n?|\n?```/g, '').trim();

      // AI should understand "Electronics" is a category value from samples
      expect(sql.toLowerCase()).toContain('electronics');
      expect(sql.toLowerCase()).toContain('category');
    }, 30000);
  });
});
