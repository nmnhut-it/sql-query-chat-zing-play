/**
 * Collapsible SQL code block with copy, edit, and run actions.
 * Displays generated SQL in a formatted, interactive block.
 */

import { useState, useCallback } from 'react';
import { Play } from 'lucide-react';

interface SqlBlockProps {
  sql: string;
  onCopy?: () => void;
  onEdit?: (sql: string) => void;
  onRun?: (sql: string) => void;
  collapsed?: boolean;
  editable?: boolean;
  executed?: boolean;
}

const COPY_TIMEOUT_MS = 2000;

export const SqlBlock = ({
  sql,
  onCopy,
  onEdit,
  onRun,
  collapsed = false,
  editable = false,
  executed = false
}: SqlBlockProps) => {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedSql, setEditedSql] = useState(sql);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(editedSql);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), COPY_TIMEOUT_MS);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [editedSql, onCopy]);

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleRun = useCallback(() => {
    onRun?.(editedSql);
    setIsEditing(false);
  }, [editedSql, onRun]);

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
          <span className="font-medium">SQL {executed && '(executed)'}</span>
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-600/50 rounded transition"
            title="Copy SQL"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {editable && !executed && (
            <button
              onClick={handleEdit}
              className="px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-600/50 rounded transition"
              title="Edit SQL"
            >
              {isEditing ? 'Editing...' : 'Edit'}
            </button>
          )}
          {onRun && !executed && (
            <button
              onClick={handleRun}
              className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition flex items-center gap-1.5"
              title="Run Query"
            >
              <Play className="w-3 h-3" />
              Run
            </button>
          )}
        </div>
      </div>

      {/* Code */}
      {!isCollapsed && (
        isEditing ? (
          <textarea
            value={editedSql}
            onChange={(e) => setEditedSql(e.target.value)}
            className="w-full px-3 py-2 text-xs font-mono text-green-400 bg-gray-900/50 border-0 focus:outline-none focus:ring-1 focus:ring-green-500 resize-none"
            rows={Math.min(editedSql.split('\n').length + 2, 10)}
            autoFocus
          />
        ) : (
          <pre className="px-3 py-2 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">
            {editedSql}
          </pre>
        )
      )}
    </div>
  );
};

export default SqlBlock;
