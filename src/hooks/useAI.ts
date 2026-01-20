/**
 * Hook for AI/OpenAI operations.
 * Handles SQL generation, result interpretation, and suggestions.
 */

import { useState, useCallback, useEffect } from 'react';
import type { AIConfig, DatabaseSchema, QueryResult } from '../types';
import { parseApiError, parseNetworkError } from '../utils/errorHandler';
import { safeJsonForApi } from '../utils/serialization';
import { STORAGE_KEYS, DEFAULT_PROMPTS, SCHEMA_PLACEHOLDER } from '../constants/aiPrompts';

interface UseAIReturn {
  config: AIConfig;
  setConfig: (config: Partial<AIConfig>) => void;
  generateSql: (question: string, schema: DatabaseSchema) => Promise<string>;
  interpretResults: (question: string, results: QueryResult) => Promise<string>;
  generateSuggestions: (schema: DatabaseSchema) => Promise<string[]>;
  discoverData: (tableName: string, rowCount: number, samples: unknown[], distinctValues?: string) => Promise<string>;
  explorePreliminary: (question: string, schema: DatabaseSchema) => Promise<string | null>;
  fixSql: (sql: string, error: string, question: string, schema: DatabaseSchema) => Promise<string>;
}

const STORAGE_KEY = STORAGE_KEYS.AI_CONFIG;

/** Load config from environment variables */
const getEnvConfig = (): Partial<AIConfig> => ({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
  apiUrl: import.meta.env.VITE_OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',
  model: import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini',
});

const DEFAULT_CONFIG: AIConfig = {
  apiKey: '',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  ...getEnvConfig(),
};

/** Load config from localStorage with env fallback */
const loadStoredConfig = (): AIConfig => {
  const envConfig = getEnvConfig();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AIConfig>;
      return { ...DEFAULT_CONFIG, ...envConfig, ...parsed };
    }
  } catch {
    // Ignore parse errors, use default
  }
  return { ...DEFAULT_CONFIG, ...envConfig };
};

/** Save config to localStorage */
const saveConfig = (config: AIConfig): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
};

/** Build schema description for AI prompts */
const buildSchemaDescription = (schema: DatabaseSchema, includeDetails = true): string => {
  return Object.entries(schema)
    .map(([table, info]) => {
      const cols = info.columns.map((c) => `${c.name} (${c.type})`).join(', ');
      if (!includeDetails) {
        return `${table}: ${cols}`;
      }
      const sampleRows = safeJsonForApi(info.samples);
      const statsInfo = safeJsonForApi(info.stats);
      return `Table "${table}": ${cols}\nSamples: ${sampleRows}\nStats: ${statsInfo}`;
    })
    .join('\n\n');
};

export const useAI = (): UseAIReturn => {
  const [config, setConfigState] = useState<AIConfig>(loadStoredConfig);

  // Save config to localStorage when it changes
  useEffect(() => {
    saveConfig(config);
  }, [config]);

  const setConfig = useCallback((updates: Partial<AIConfig>) => {
    setConfigState((prev) => ({ ...prev, ...updates }));
  }, []);

  /** Make API call with error handling */
  const callApi = useCallback(
    async (messages: Array<{ role: string; content: string }>, temperature = 0): Promise<string> => {
      if (!config.apiKey) {
        throw new Error('API key not configured');
      }

      try {
        const response = await fetch(config.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature,
          }),
        });

        if (!response.ok) {
          const error = parseApiError(response.status);
          throw new Error(error.message);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
      } catch (err) {
        if (err instanceof TypeError && err.message.includes('fetch')) {
          const error = parseNetworkError(err);
          throw new Error(error.message);
        }
        throw err;
      }
    },
    [config]
  );

  /** Generate SQL from natural language question */
  const generateSql = useCallback(
    async (question: string, schema: DatabaseSchema): Promise<string> => {
      const schemaDesc = buildSchemaDescription(schema);
      const promptTemplate = config.customPrompts?.generateSql ?? DEFAULT_PROMPTS.GENERATE_SQL;
      const systemPrompt = promptTemplate.replace(SCHEMA_PLACEHOLDER, schemaDesc);

      const result = await callApi([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ]);
      return result.replace(/```sql\n?|\n?```/g, '');
    },
    [callApi, config.customPrompts?.generateSql]
  );

  /** Interpret query results */
  const interpretResults = useCallback(
    async (question: string, results: QueryResult): Promise<string> => {
      const preview = results.rows.slice(0, 10);
      const prompt = config.customPrompts?.interpretResults ?? DEFAULT_PROMPTS.INTERPRET_RESULTS;
      return callApi([
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: `Question: ${question}\nResult (first 10 rows): ${safeJsonForApi(preview)}`,
        },
      ]);
    },
    [callApi, config.customPrompts?.interpretResults]
  );

  /** Generate suggested questions based on schema */
  const generateSuggestions = useCallback(
    async (schema: DatabaseSchema): Promise<string[]> => {
      const schemaDesc = buildSchemaDescription(schema, false);
      const result = await callApi(
        [
          { role: 'system', content: DEFAULT_PROMPTS.GENERATE_SUGGESTIONS },
          { role: 'user', content: `Schema: ${schemaDesc}` },
        ],
        0.7
      );
      return result
        .split('\n')
        .map((s) => s.replace(/^\d+\.\s*/, '').trim())
        .filter((s) => s.length > 0);
    },
    [callApi]
  );

  /** Discover insights about a table */
  const discoverData = useCallback(
    async (tableName: string, rowCount: number, samples: unknown[], distinctValues?: string): Promise<string> => {
      const prompt = config.customPrompts?.discoverData ?? DEFAULT_PROMPTS.DISCOVER_DATA;
      const userContent = distinctValues
        ? `Table: ${tableName}\nTotal Rows: ${rowCount}\nSample Data: ${safeJsonForApi(samples)}\n\nDistinct Values:\n${distinctValues}`
        : `Table: ${tableName}\nTotal Rows: ${rowCount}\nSample Data: ${safeJsonForApi(samples)}`;
      return callApi([
        { role: 'system', content: prompt },
        { role: 'user', content: userContent },
      ]);
    },
    [callApi, config.customPrompts?.discoverData]
  );

  /** Preliminary exploration query to understand data better */
  const explorePreliminary = useCallback(
    async (question: string, schema: DatabaseSchema): Promise<string | null> => {
      const schemaDesc = buildSchemaDescription(schema);
      const result = await callApi([
        { role: 'system', content: DEFAULT_PROMPTS.EXPLORE_PRELIMINARY },
        { role: 'user', content: `Schema:\n${schemaDesc}\n\nQuestion: ${question}` },
      ]);

      const sql = result.replace(/```sql\n?|\n?```/g, '');
      return sql !== 'ENOUGH' && sql.length > 5 ? sql : null;
    },
    [callApi]
  );

  /** Fix SQL based on error message */
  const fixSql = useCallback(
    async (sql: string, error: string, question: string, schema: DatabaseSchema): Promise<string> => {
      const schemaDesc = Object.entries(schema)
        .map(([table, info]) => {
          const cols = info.columns.map((c) => `${c.name} (${c.type})`).join(', ');
          return `Table "${table}": ${cols}`;
        })
        .join('\n');

      const result = await callApi([
        { role: 'system', content: DEFAULT_PROMPTS.FIX_SQL },
        {
          role: 'user',
          content: `Database Schema:\n${schemaDesc}\n\nOriginal Natural Language Intent: ${question}\n\nFailing SQL Query:\n${sql}\n\nDuckDB Error Message:\n${error}`,
        },
      ]);
      return result.replace(/```sql\n?|\n?```/g, '');
    },
    [callApi]
  );

  return {
    config,
    setConfig,
    generateSql,
    interpretResults,
    generateSuggestions,
    discoverData,
    explorePreliminary,
    fixSql,
  };
};

export type { UseAIReturn };
