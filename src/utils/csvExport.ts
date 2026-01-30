/**
 * CSV export utility for query results.
 * Uses chunked Blob construction to avoid RangeError on large datasets.
 * @see SqlEditor, ExpandedResults - primary consumers
 */

import type { QueryResult } from '../types';

const CSV_MIME_TYPE = 'text/csv';
const DEFAULT_FILENAME = 'query-results.csv';

/** Escape a cell value per RFC 4180: quote if it contains comma, quote, or newline */
function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Format a single row as a CSV line (no trailing newline) */
function formatCsvRow(columns: string[], row: Record<string, unknown>): string {
  return columns.map(col => escapeCsvCell(row[col])).join(',');
}

/**
 * Build a CSV Blob from query results without joining into one string.
 * Each row is passed as a separate BlobPart, avoiding the JS max string length.
 */
function buildCsvBlob(columns: string[], rows: Record<string, unknown>[]): Blob {
  const parts: BlobPart[] = [columns.join(','), '\n'];

  for (let i = 0; i < rows.length; i++) {
    parts.push(formatCsvRow(columns, rows[i]));
    if (i < rows.length - 1) {
      parts.push('\n');
    }
  }

  return new Blob(parts, { type: CSV_MIME_TYPE });
}

/** Trigger a file download from a Blob */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Export query results as a CSV file download */
export function exportResultsToCsv(
  results: QueryResult,
  filename = DEFAULT_FILENAME
): void {
  const blob = buildCsvBlob(results.columns, results.rows);
  downloadBlob(blob, filename);
}
