/**
 * Serialization utilities for handling BigInt and complex data types.
 * Fixes JSON.stringify errors with BigInt values from DuckDB.
 */

/**
 * Safely stringify objects containing BigInt values.
 * Converts BigInt to string representation.
 */
export const safeStringify = (obj: unknown): string => {
  return JSON.stringify(obj, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
};

/**
 * Recursively convert BigInt values to safe number or string.
 * Uses Number for safe integers, string for large values.
 */
export const convertBigIntToNumber = (value: unknown): unknown => {
  if (typeof value === 'bigint') {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(convertBigIntToNumber);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, convertBigIntToNumber(v)])
    );
  }

  return value;
};

/**
 * Convert query results for safe serialization and display.
 * Handles BigInt in rows while preserving structure.
 */
export const convertQueryResults = <T extends Record<string, unknown>>(
  rows: T[]
): T[] => {
  return rows.map((row) => convertBigIntToNumber(row) as T);
};

/**
 * Safe JSON stringify with BigInt conversion for API calls.
 * Converts BigInt first, then stringifies.
 */
export const safeJsonForApi = (obj: unknown): string => {
  return JSON.stringify(convertBigIntToNumber(obj));
};
