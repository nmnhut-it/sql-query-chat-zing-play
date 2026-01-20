/**
 * Compact results table showing preview rows with expand option.
 * Displays first N rows with ability to expand to full view.
 */

import type { QueryResult } from '../../types';
import { formatCellValue } from '../../utils/dateFormatter';

interface CompactResultsProps {
  results: QueryResult;
  onExpand: () => void;
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 5;

export const CompactResults = ({
  results,
  onExpand,
  maxRows = DEFAULT_MAX_ROWS,
}: CompactResultsProps) => {
  const { columns, rows, rowCount } = results;
  const previewRows = rows.slice(0, maxRows);
  const hasMore = rowCount > maxRows;

  if (rowCount === 0) {
    return (
      <div className="px-3 py-2 text-sm text-gray-500 italic">
        Query returned no results
      </div>
    );
  }

  return (
    <div className="rounded bg-gray-800/30 border border-gray-700/50 overflow-hidden">
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-700/30">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-2 py-1.5 text-left font-medium text-gray-400 whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, idx) => (
              <tr key={idx} className="border-t border-gray-700/30">
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-2 py-1 text-gray-300 whitespace-nowrap max-w-[200px] truncate"
                    title={formatCellValue(row[col], col)}
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

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-700/20 border-t border-gray-700/30">
        <span className="text-xs text-gray-500">
          {rowCount} row{rowCount !== 1 ? 's' : ''}
          {hasMore && ` (showing ${maxRows})`}
        </span>
        <button
          onClick={onExpand}
          className="flex items-center gap-1 px-2 py-0.5 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition"
        >
          Expand
          <span className="text-[10px]">^</span>
        </button>
      </div>
    </div>
  );
};

export default CompactResults;
