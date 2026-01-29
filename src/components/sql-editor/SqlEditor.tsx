/**
 * SQL Editor component with Monaco editor.
 * Allows writing multiple queries, selecting text, and running selected/current query.
 * Supports converting natural language TODOs to SQL using AI.
 * Results displayed in a panel below the editor.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { QueryResult, DatabaseSchema } from '../../types';
import { CompactResults } from '../chat/CompactResults';
import { ExpandedResults } from '../chat/ExpandedResults';
import { TutorialStepId, TUTORIAL_TARGET_ATTR } from '../../constants/tutorialSteps';

/** Ref type for action handlers to avoid stale closures */
interface ActionHandlers {
  runQuery: () => Promise<void>;
  convertToSql: () => Promise<void>;
}

/** Minimum rows for results preview */
const RESULTS_PREVIEW_ROWS = 10;

/** localStorage key for persisting SQL content */
const STORAGE_KEY = 'duckquery_sql_editor_content';

/** Default content for new editor */
const DEFAULT_CONTENT = `-- Write your SQL queries here
-- Select text and press Ctrl+Enter to run
-- Select a TODO and press Ctrl+Shift+Enter to convert to SQL

-- Example TODO:
-- TODO: show all tables and their row counts

`;

interface SqlEditorProps {
  schema: DatabaseSchema;
  executeQuery: (sql: string) => Promise<QueryResult>;
  generateSql: (question: string, schema: DatabaseSchema) => Promise<string>;
}

/** Extract the query at cursor position or selected text */
function getQueryToRun(
  editor: editor.IStandaloneCodeEditor
): string | null {
  const model = editor.getModel();
  if (!model) return null;

  const selection = editor.getSelection();

  // If there's a selection, use it
  if (selection && !selection.isEmpty()) {
    return model.getValueInRange(selection).trim();
  }

  // Otherwise, find the statement at cursor
  const position = editor.getPosition();
  if (!position) return null;

  const content = model.getValue();
  const offset = model.getOffsetAt(position);

  // Find statement boundaries (semicolon-separated)
  const statements = splitStatements(content);
  let currentOffset = 0;

  for (const stmt of statements) {
    const stmtEnd = currentOffset + stmt.length;
    if (offset >= currentOffset && offset <= stmtEnd) {
      return stmt.trim();
    }
    currentOffset = stmtEnd + 1; // +1 for semicolon
  }

  // Fallback: return entire content if single statement
  return content.trim();
}

/** Split SQL content into statements by semicolon */
function splitStatements(content: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      current += char;
    } else if (inString && char === stringChar) {
      inString = false;
      current += char;
    } else if (!inString && char === ';') {
      if (current.trim()) {
        statements.push(current);
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    statements.push(current);
  }

  return statements;
}

/** Load initial content from localStorage or use default */
function loadContent(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved || DEFAULT_CONTENT;
  } catch {
    return DEFAULT_CONTENT;
  }
}

/** Extract selected text from editor */
function getSelectedText(editorInstance: editor.IStandaloneCodeEditor): string | null {
  const model = editorInstance.getModel();
  const selection = editorInstance.getSelection();
  if (!model || !selection || selection.isEmpty()) return null;
  return model.getValueInRange(selection).trim();
}

/** Clean up TODO text for AI prompt - remove comment markers and TODO prefix */
function cleanTodoText(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^--\s*/, '').replace(/^TODO:\s*/i, '').trim())
    .filter(line => line.length > 0)
    .join(' ');
}

export function SqlEditor({ schema, executeQuery, generateSql }: SqlEditorProps) {
  const [content, setContent] = useState(loadContent);
  const [results, setResults] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [expandedResults, setExpandedResults] = useState(false);
  const [lastQuery, setLastQuery] = useState<string>('');
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Ref to hold latest action handlers - avoids stale closures in Monaco actions
  const handlersRef = useRef<ActionHandlers | null>(null);

  /** Save content to localStorage */
  const handleContentChange = useCallback((value: string | undefined) => {
    const newContent = value || '';
    setContent(newContent);
    try {
      localStorage.setItem(STORAGE_KEY, newContent);
    } catch {
      // Ignore storage errors
    }
  }, []);

  /** Convert selected TODO/natural language to SQL */
  const handleConvertToSql = useCallback(async () => {
    if (!editorRef.current) return;

    const selectedText = getSelectedText(editorRef.current);
    if (!selectedText) {
      setError('Select a TODO or description to convert to SQL');
      return;
    }

    const question = cleanTodoText(selectedText);
    if (!question) {
      setError('No text to convert');
      return;
    }

    setConverting(true);
    setError(null);

    try {
      const sql = await generateSql(question, schema);

      // Insert generated SQL after the selection
      const model = editorRef.current.getModel();
      const selection = editorRef.current.getSelection();
      if (!model || !selection) return;

      const endLine = selection.endLineNumber;
      const lineContent = model.getLineContent(endLine);
      const insertPosition = { lineNumber: endLine, column: lineContent.length + 1 };

      // Insert newlines and the generated SQL
      const textToInsert = `\n\n${sql};\n`;

      editorRef.current.executeEdits('convert-to-sql', [{
        range: {
          startLineNumber: insertPosition.lineNumber,
          startColumn: insertPosition.column,
          endLineNumber: insertPosition.lineNumber,
          endColumn: insertPosition.column,
        },
        text: textToInsert,
      }]);

      // Move cursor to end of inserted SQL
      const newPosition = model.getPositionAt(
        model.getOffsetAt(insertPosition) + textToInsert.length
      );
      editorRef.current.setPosition(newPosition);
      editorRef.current.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate SQL');
    } finally {
      setConverting(false);
    }
  }, [generateSql, schema]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    // Add Ctrl+Enter to run query - uses ref to avoid stale closure
    editor.addAction({
      id: 'run-query',
      label: 'Run Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => handlersRef.current?.runQuery(),
    });

    // Add Ctrl+Shift+Enter to convert TODO to SQL - uses ref to avoid stale closure
    editor.addAction({
      id: 'convert-to-sql',
      label: 'Convert to SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => handlersRef.current?.convertToSql(),
    });

    // Configure SQL language - schema autocomplete
    monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        // Add table names as suggestions
        const tableItems = Object.keys(schema).map(table => ({
          label: table,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: table,
          range,
        }));

        // Add column names as suggestions
        const columnItems = Object.entries(schema).flatMap(([table, tableSchema]) =>
          tableSchema.columns.map(col => ({
            label: `${table}.${col.name}`,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: col.name,
            detail: col.type,
            range,
          }))
        );

        return { suggestions: [...tableItems, ...columnItems] };
      },
    });
  }, [schema]);

  const handleRunQuery = useCallback(async () => {
    if (!editorRef.current) return;

    const query = getQueryToRun(editorRef.current);
    if (!query) {
      setError('No query to run');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);
    setLastQuery(query);

    try {
      const result = await executeQuery(query);
      setResults(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query execution failed');
    } finally {
      setLoading(false);
    }
  }, [executeQuery]);

  // Keep handlers ref up to date with latest function references
  useEffect(() => {
    handlersRef.current = {
      runQuery: handleRunQuery,
      convertToSql: handleConvertToSql,
    };
  }, [handleRunQuery, handleConvertToSql]);

  const handleExport = useCallback(() => {
    if (!results) return;

    const headers = results.columns.join(',');
    const rows = results.rows.map(row =>
      results.columns.map(col => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(',')
    );

    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-800"
        {...{ [TUTORIAL_TARGET_ATTR]: TutorialStepId.SQL_EDITOR_CONTENT }}
      >
        <button
          onClick={handleRunQuery}
          disabled={loading || converting}
          className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 rounded transition flex items-center gap-1.5"
        >
          {loading ? (
            <>
              <span className="animate-spin">⟳</span>
              Running...
            </>
          ) : (
            <>▶ Run</>
          )}
        </button>
        <button
          onClick={handleConvertToSql}
          disabled={loading || converting}
          className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 rounded transition flex items-center gap-1.5"
        >
          {converting ? (
            <>
              <span className="animate-spin">⟳</span>
              Converting...
            </>
          ) : (
            <>✨ Convert to SQL</>
          )}
        </button>
        <span className="text-xs text-gray-500">
          Ctrl+Enter: run | Ctrl+Shift+Enter: convert
        </span>
        {lastQuery && (
          <span className="ml-auto text-xs text-gray-500 truncate max-w-xs">
            Last: {lastQuery.slice(0, 50)}...
          </span>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={content}
          onChange={handleContentChange}
          onMount={handleEditorMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            suggestOnTriggerCharacters: true,
          }}
        />
      </div>

      {/* Results Panel */}
      <div className="border-t border-gray-700 bg-gray-850 max-h-[40%] overflow-auto">
        {loading && (
          <div className="p-4 text-center text-gray-400">
            <span className="animate-spin inline-block">⟳</span> Executing query...
          </div>
        )}

        {error && (
          <div className="p-4 text-red-400 bg-red-900/20 border-l-2 border-red-500">
            <div className="font-medium">Error</div>
            <div className="text-sm mt-1">{error}</div>
          </div>
        )}

        {results && !loading && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">
                {results.rowCount} row{results.rowCount !== 1 ? 's' : ''} returned
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleExport}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition"
                >
                  Export CSV
                </button>
                <button
                  onClick={() => setExpandedResults(true)}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition"
                >
                  Expand
                </button>
              </div>
            </div>
            <CompactResults
              results={results}
              onExpand={() => setExpandedResults(true)}
              maxRows={RESULTS_PREVIEW_ROWS}
            />
          </div>
        )}

        {!loading && !error && !results && (
          <div className="p-4 text-center text-gray-500 text-sm">
            Run a query to see results
          </div>
        )}
      </div>

      {/* Expanded Results Modal */}
      {expandedResults && results && (
        <ExpandedResults
          results={results}
          onClose={() => setExpandedResults(false)}
          onExport={handleExport}
        />
      )}
    </div>
  );
}
