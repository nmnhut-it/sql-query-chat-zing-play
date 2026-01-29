/**
 * Demo data for the interactive tutorial.
 * Provides hardcoded question, SQL, and insight so the tutorial
 * works without an API key — results come from real DB execution.
 */

import type { ChatMessage, QueryResult } from '../types';

/** Demo question shown in chat during tutorial */
export const DEMO_QUESTION = 'What are the top categories by total revenue?';

/** SQL executed against the sample sales_data table */
export const DEMO_SQL =
  'SELECT category, SUM(revenue) AS total_revenue FROM sales_data GROUP BY category ORDER BY total_revenue DESC';

/** Hardcoded insight (no API call needed) */
export const DEMO_INSIGHT =
  'Electronics leads with the highest revenue, followed by Furniture and Clothing.';

/** Builds a user + assistant message pair with real query results */
export const buildDemoMessages = (results: QueryResult): ChatMessage[] => {
  const now = Date.now();
  return [
    {
      id: `demo-user-${now}`,
      role: 'user',
      content: DEMO_QUESTION,
      timestamp: now,
    },
    {
      id: `demo-assistant-${now + 1}`,
      role: 'assistant',
      content: `Found ${results.rowCount} result${results.rowCount !== 1 ? 's' : ''}`,
      timestamp: now + 1,
      sql: DEMO_SQL,
      sqlExecuted: true,
      results,
      insight: DEMO_INSIGHT,
    },
  ];
};
