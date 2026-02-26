/**
 * Inline chat overlay for SQL generation in the editor.
 * Shows generated SQL with accept/reject/iterate controls.
 * Replaces the old "fire-and-replace" flow with a human-in-the-loop review.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X, RefreshCw, Send, Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface InlineSqlChatProps {
  /** The original natural language question */
  question: string;
  /** Generated SQL (null while loading) */
  generatedSql: string | null;
  /** AI thinking/reasoning (null while loading) */
  thinking: string | null;
  /** AI summary of what the SQL does */
  summary: string | null;
  /** Whether the AI is currently generating */
  isGenerating: boolean;
  /** Error from generation */
  error: string | null;
  /** Accept the SQL and insert into editor */
  onAccept: (sql: string) => void;
  /** Reject / close the overlay */
  onReject: () => void;
  /** Send a follow-up message to refine the SQL */
  onRefine: (message: string) => void;
  /** Retry the original generation after an error */
  onRetry: () => void;
  /** Position info for overlay placement */
  top: number;
}

export function InlineSqlChat({
  question,
  generatedSql,
  thinking,
  summary,
  isGenerating,
  error,
  onAccept,
  onReject,
  onRefine,
  onRetry,
  top,
}: InlineSqlChatProps) {
  const [refineInput, setRefineInput] = useState('');
  const [editedSql, setEditedSql] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Sync editedSql when generatedSql changes
  useEffect(() => {
    if (generatedSql) {
      setEditedSql(generatedSql);
      setIsEditing(false);
    }
  }, [generatedSql]);

  // Focus refine input when SQL arrives
  useEffect(() => {
    if (generatedSql && !isGenerating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [generatedSql, isGenerating]);

  // Escape to reject
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onReject();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onReject]);

  const handleRefineSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const msg = refineInput.trim();
    if (!msg || isGenerating) return;
    setRefineInput('');
    onRefine(msg);
  }, [refineInput, isGenerating, onRefine]);

  const handleAccept = useCallback(() => {
    const sql = isEditing ? editedSql : (generatedSql || '');
    if (sql.trim()) {
      onAccept(sql.trim());
    }
  }, [isEditing, editedSql, generatedSql, onAccept]);

  return (
    <div
      ref={panelRef}
      className="absolute left-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 duration-200"
      style={{ top: `${top}px` }}
    >
      <div className="bg-gray-800 border border-purple-500/40 rounded-lg shadow-xl shadow-purple-900/20 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-purple-900/30 border-b border-purple-500/20">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-purple-300">AI SQL Generation</span>
            <span className="text-xs text-gray-500">|</span>
            <span className="text-xs text-gray-400 truncate max-w-md" title={question}>
              "{question}"
            </span>
          </div>
          <button
            onClick={onReject}
            className="p-1 text-gray-500 hover:text-gray-300 transition"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Thinking block (collapsible) */}
        {thinking && (
          <div className="border-b border-gray-700/50">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-purple-300 hover:bg-purple-900/20 transition"
            >
              <Brain className="w-3 h-3 text-purple-400" />
              <span>Thinking & Planning</span>
              {showThinking ? (
                <ChevronDown className="w-3 h-3 ml-auto text-purple-500" />
              ) : (
                <ChevronRight className="w-3 h-3 ml-auto text-purple-500" />
              )}
            </button>
            {showThinking && (
              <div className="px-4 pb-2">
                <p className="text-xs text-purple-200/60 whitespace-pre-wrap leading-relaxed">
                  {thinking}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="px-4 py-2 border-b border-gray-700/50 bg-blue-900/10">
            <p className="text-xs text-blue-300">{summary}</p>
          </div>
        )}

        {/* SQL Preview / Loading */}
        <div className="px-4 py-3">
          {isGenerating && !generatedSql ? (
            <div className="flex items-center gap-3 py-4">
              <Brain className="w-4 h-4 text-purple-400 animate-pulse" />
              <span className="text-sm text-purple-300">Generating SQL...</span>
              <div className="flex gap-1 ml-1">
                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          ) : error ? (
            <div className="py-2 flex items-center gap-3">
              <span className="text-sm text-red-400">{error}</span>
              <button
                onClick={onRetry}
                disabled={isGenerating}
                className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 rounded transition flex items-center gap-1.5"
                title="Retry generation"
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </button>
            </div>
          ) : isEditing ? (
            <textarea
              value={editedSql}
              onChange={(e) => setEditedSql(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono text-green-400 bg-gray-900/70 border border-gray-600 rounded focus:outline-none focus:border-purple-500 resize-none"
              rows={Math.min(editedSql.split('\n').length + 1, 12)}
              autoFocus
            />
          ) : generatedSql ? (
            <pre
              className="px-3 py-2 text-sm font-mono text-green-400 bg-gray-900/50 rounded overflow-x-auto whitespace-pre-wrap cursor-pointer hover:bg-gray-900/70 transition"
              onClick={() => setIsEditing(true)}
              title="Click to edit"
            >
              {generatedSql}
            </pre>
          ) : null}
        </div>

        {/* Action buttons + refine input */}
        {(generatedSql || error) && (
          <div className="px-4 pb-3 space-y-2">
            {/* Refine input */}
            <form onSubmit={handleRefineSubmit} className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={refineInput}
                onChange={(e) => setRefineInput(e.target.value)}
                placeholder={error ? "Try a different description..." : "Refine: e.g. 'add a WHERE clause for 2024'"}
                disabled={isGenerating}
                className="flex-1 px-3 py-1.5 text-sm bg-gray-900/60 border border-gray-600 rounded focus:outline-none focus:border-purple-500 placeholder-gray-500 disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    handleRefineSubmit(e);
                  }
                }}
              />
              <button
                type="submit"
                disabled={!refineInput.trim() || isGenerating}
                className="px-2 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:cursor-not-allowed rounded transition"
                title="Send refinement"
              >
                {isGenerating ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </form>

            {/* Accept / Reject buttons */}
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  onClick={handleAccept}
                  disabled={!generatedSql || isGenerating}
                  className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-500 disabled:bg-green-600/30 disabled:cursor-not-allowed rounded transition flex items-center gap-1.5 font-medium"
                  title="Accept and insert SQL (Enter)"
                >
                  <Check className="w-4 h-4" />
                  Accept
                </button>
                <button
                  onClick={onReject}
                  className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition flex items-center gap-1.5"
                  title="Discard (Esc)"
                >
                  <X className="w-4 h-4" />
                  Discard
                </button>
              </div>
              <span className="text-xs text-gray-600">
                {isEditing ? 'Editing SQL' : 'Click SQL to edit'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
