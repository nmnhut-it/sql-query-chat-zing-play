/**
 * Collapsible SQL code block with copy and edit actions.
 * Displays generated SQL in a formatted, interactive block.
 */

import { useState, useCallback } from 'react';

interface SqlBlockProps {
  sql: string;
  onCopy?: () => void;
  onEdit?: (sql: string) => void;
  collapsed?: boolean;
}

const COPY_TIMEOUT_MS = 2000;

export const SqlBlock = ({ sql, onCopy, onEdit, collapsed = false }: SqlBlockProps) => {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), COPY_TIMEOUT_MS);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [sql, onCopy]);

  const handleEdit = useCallback(() => {
    onEdit?.(sql);
  }, [sql, onEdit]);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <div className="rounded bg-gray-800/50 border border-gray-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-700/30">
        <button
          onClick={toggleCollapse}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-300 transition"
        >
          <span className="text-gray-500">{isCollapsed ? '>' : 'v'}</span>
          <span className="font-medium">SQL</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-600/50 rounded transition"
            title="Copy SQL"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {onEdit && (
            <button
              onClick={handleEdit}
              className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-600/50 rounded transition"
              title="Edit SQL"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Code */}
      {!isCollapsed && (
        <pre className="px-3 py-2 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">
          {sql}
        </pre>
      )}
    </div>
  );
};

export default SqlBlock;
