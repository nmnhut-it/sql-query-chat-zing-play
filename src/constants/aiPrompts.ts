/**
 * Constants for AI prompt configuration and storage.
 * Centralizes all AI-related prompts to enable customization.
 */

/** LocalStorage keys for AI configuration */
export const STORAGE_KEYS = {
  AI_CONFIG: 'duckquery_ai_config',
  CUSTOM_PROMPTS: 'duckquery_custom_prompts',
  THREAD_LIST: 'duckquery_threads',
} as const;

/** Prefix for AI clarification responses */
export const CLARIFY_PREFIX = 'CLARIFY:';

/** Default AI prompts used for SQL generation and data analysis */
export const DEFAULT_PROMPTS = {
  /** Prompt for generating SQL from natural language */
  GENERATE_SQL: `You are a DuckDB expert. Generate ONLY raw SQL. No markdown. No backticks.

IMPORTANT: If the user's question contains terms you don't understand (abbreviations, business terms, unclear references), DO NOT guess. Instead, respond ONLY with a clarifying question starting with "CLARIFY:".

When to clarify:
- Unknown abbreviations (e.g., "A1", "MRR", "DAU", "MAU")
- Ambiguous column references
- Unclear time ranges or filters
- Business-specific jargon

Schema:
{schema}`,

  /** Prompt for interpreting query results */
  INTERPRET_RESULTS: 'You are a data analyst. Explain the key insight from these results in one short sentence.',

  /** Prompt for data discovery on new tables */
  DISCOVER_DATA: `Profile this dataset:
1. Identify interesting columns and their purposes
2. Note date/time columns and their ranges
3. For categorical columns (low cardinality strings), highlight distinct value distribution
4. Suggest 2-3 valuable questions to explore`,

  /** Prompt for generating query suggestions */
  GENERATE_SUGGESTIONS: 'Suggest 3 short, interesting questions about this data. Output only questions separated by newlines.',

  /** Prompt for preliminary exploration */
  EXPLORE_PRELIMINARY: `You are a data explorer. Given a user question and schema, suggest ONE SQL query to help you understand the data better before answering.
E.g. find distinct values for a column, or min/max dates.
ONLY output the raw SQL. If you have enough info, output 'ENOUGH'.`,

  /** Prompt for fixing SQL errors */
  FIX_SQL: `You are a DuckDB expert. A user tried to run a SQL query but it failed with an error.
Your task is to FIX the SQL query based on the provided error message and the database schema.
Only output the corrected raw SQL query, nothing else. No markdown, no explanation, no backticks.`,
} as const;

/** Schema placeholder in prompts */
export const SCHEMA_PLACEHOLDER = '{schema}';
