/**
 * Utility for formatting cell values for display.
 * Numbers are displayed as-is - use SQL functions like strftime() for date formatting.
 */

/**
 * Format a cell value for display.
 * Handles BigInt and object types from DuckDB.
 * Numbers are NOT auto-converted to dates - format timestamps in SQL instead.
 */
export const formatCellValue = (value: unknown, _columnName?: string): string => {
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
    // Handle Date objects (explicit Date objects are fine to format)
    if (value instanceof Date) {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(value);
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

  return String(value);
};
