/**
 * Full-screen overlay panel for viewing all query results.
 * Includes export functionality and keyboard navigation.
 */

import { useEffect, useCallback } from 'react';
import type { QueryResult } from '../../types';
import { formatCellValue } from '../../utils/dateFormatter';

interface ExpandedResultsProps {
  results: QueryResult;
  onClose: () => void;
  onExport?: () => void;
}

const MAX_DISPLAY_ROWS = 1000;

export const ExpandedResults = ({ results, onClose, onExport }: ExpandedResultsProps) => {
  const { columns, rows, rowCount } = results;
  const displayRows = rows.slice(0, MAX_DISPLAY_ROWS);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const handleExportCsv = useCallback(() => {
    if (!onExport) {
      // Default export implementation
      const csv = [
        columns.join(','),
        ...rows.map((r) =>
          columns
            .map((c) => {
              const val = r[c];
              if (val === null || val === undefined) return '';
              const str = String(val);
              return str.includes(',') || str.includes('"')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            })
            .join(',')
        ),
      ].join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'results.csv';
      a.click();
      URL.revokeObjectURL(url);
    } else {
      onExport();
    }
  }, [columns, rows, onExport]);

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-gray-800 rounded-lg w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-medium text-gray-200">
            Query Results
            <span className="ml-2 text-gray-500">
              ({rowCount} row{rowCount !== 1 ? 's' : ''}
              {rowCount > MAX_DISPLAY_ROWS && `, showing ${MAX_DISPLAY_ROWS}`})
            </span>
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition"
            >
              Export CSV
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition"
              title="Close (Esc)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-750 sticky top-0">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    className="px-3 py-2 text-left font-medium text-gray-300 border-b border-gray-700 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-gray-750">
                  {columns.map((col) => (
                    <td
                      key={col}
                      className="px-3 py-1.5 border-b border-gray-700/50 text-gray-300"
                    >
                      {row[col] === null || row[col] === undefined ? (
                        <span className="text-gray-600">NULL</span>
                      ) : (
                        formatCellValue(row[col], col)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ExpandedResults;
