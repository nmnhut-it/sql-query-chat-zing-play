/**
 * SQL validation utilities.
 * Validates if AI response is actual SQL vs conversational text.
 */

/** SQL statement keywords that start valid queries */
const SQL_KEYWORDS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'WITH',
  'TRUNCATE',
  'MERGE',
] as const;

/**
 * Check if text looks like a SQL statement.
 * @param text - Raw text from AI response
 * @returns true if text starts with a SQL keyword
 */
export const isValidSql = (text: string): boolean => {
  if (!text?.trim()) return false;
  const trimmed = text.trim().toUpperCase();
  return SQL_KEYWORDS.some((keyword) => trimmed.startsWith(keyword));
};
