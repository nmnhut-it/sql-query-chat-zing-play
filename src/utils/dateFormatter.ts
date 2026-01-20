/**
 * Utility for detecting and formatting timestamp values.
 * Automatically converts numeric timestamps to readable dates.
 */

/** Bounds for valid timestamps (in seconds) */
const TIMESTAMP_BOUNDS = {
  MIN_SECONDS: 946684800,   // Jan 1, 2000
  MAX_SECONDS: 4102444800,  // Jan 1, 2100
} as const;

/** Regex to detect date/time column names */
const DATE_COLUMN_PATTERN = /date|time|created|updated|timestamp|_at$/i;

/**
 * Check if a numeric value is likely a timestamp.
 * Handles both seconds and milliseconds formats.
 */
export const isLikelyTimestamp = (value: unknown): boolean => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  // Normalize to seconds for comparison
  const inSeconds = value > TIMESTAMP_BOUNDS.MAX_SECONDS ? value / 1000 : value;
  return inSeconds >= TIMESTAMP_BOUNDS.MIN_SECONDS && inSeconds <= TIMESTAMP_BOUNDS.MAX_SECONDS;
};

/**
 * Format a timestamp to human-readable string.
 * Handles both seconds and milliseconds formats.
 */
export const formatTimestamp = (value: number): string => {
  // Convert to milliseconds if in seconds
  const ms = value < TIMESTAMP_BOUNDS.MAX_SECONDS ? value * 1000 : value;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ms));
};

/**
 * Check if a column name suggests it contains date/time values.
 */
export const isDateColumn = (columnName: string): boolean => {
  return DATE_COLUMN_PATTERN.test(columnName);
};

/**
 * Format a cell value for display.
 * Automatically formats timestamps based on column name or value detection.
 * Handles BigInt and object types from DuckDB.
 */
export const formatCellValue = (value: unknown, columnName?: string): string => {
  if (value === null || value === undefined) {
    return '';
  }

  // Handle BigInt (common in DuckDB for large integers)
  if (typeof value === 'bigint') {
    return value.toString();
  }

  // Handle objects (DuckDB may return wrapped values)
  if (typeof value === 'object') {
    // Handle arrays
    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }
    // Handle Date objects
    if (value instanceof Date) {
      return value.toISOString();
    }
    // Try to extract primitive value from wrapper objects
    const obj = value as Record<string, unknown>;
    if ('value' in obj && (typeof obj.value === 'number' || typeof obj.value === 'bigint' || typeof obj.value === 'string')) {
      return String(obj.value);
    }
    // Fallback: stringify the object
    try {
      return JSON.stringify(value);
    } catch {
      return '[Complex Object]';
    }
  }

  const shouldCheckTimestamp = columnName ? isDateColumn(columnName) : false;

  if (typeof value === 'number') {
    // Format if column name suggests timestamp or value looks like timestamp
    if (shouldCheckTimestamp || isLikelyTimestamp(value)) {
      return formatTimestamp(value);
    }
  }

  return String(value);
};
