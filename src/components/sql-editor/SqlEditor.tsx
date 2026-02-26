/**
 * SQL Editor component with Monaco editor and tab system.
 * Supports multiple tabs (scratch + pipeline), inline AI SQL generation,
 * and per-tab query execution with results panel.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import type { QueryResult, DatabaseSchema, EditorTab, PipelineTabRequest } from '../../types';
import type { GenerateSqlResult } from '../../hooks/useAI';
import { CompactResults } from '../chat/CompactResults';
import { ExpandedResults } from '../chat/ExpandedResults';
import { InlineSqlChat } from './InlineSqlChat';
import { TutorialStepId, TUTORIAL_TARGET_ATTR } from '../../constants/tutorialSteps';
import { exportResultsToCsv } from '../../utils/csvExport';
import { Workflow, Plus, X } from 'lucide-react';

/** Ref type for action handlers to avoid stale closures */
interface ActionHandlers {
  runQuery: () => Promise<void>;
  convertToSql: () => Promise<void>;
}

/** Minimum rows for results preview */
const RESULTS_PREVIEW_ROWS = 10;

/** localStorage key for persisting SQL content */
const STORAGE_KEY = 'duckquery_sql_editor_content';

/** Identifier for the default scratch tab */
const SCRATCH_TAB_ID = 'scratch';

/** Default content for new editor */
const DEFAULT_CONTENT = `-- Write your SQL queries here
-- Select text and press Ctrl+Enter to run
-- Select a TODO and press Ctrl+Shift+Enter to convert to SQL

-- Example TODO:
-- TODO: show all tables and their row counts

`;

/** State for the inline SQL generation chat */
interface InlineChatState {
  isOpen: boolean;
  question: string;
  generatedSql: string | null;
  thinking: string | null;
  summary: string | null;
  isGenerating: boolean;
  error: string | null;
  conversationHistory: Array<{ role: string; content: string }>;
  overlayTop: number;
  selectionEndLine: number;
}

const INITIAL_CHAT_STATE: InlineChatState = {
  isOpen: false,
  question: '',
  generatedSql: null,
  thinking: null,
  summary: null,
  isGenerating: false,
  error: null,
  conversationHistory: [],
  overlayTop: 0,
  selectionEndLine: 0,
};

interface SqlEditorProps {
  schema: DatabaseSchema;
  executeQuery: (sql: string) => Promise<QueryResult>;
  generateSql: (question: string, schema: DatabaseSchema) => Promise<string>;
  generateSqlWithThinking: (
    question: string,
    schema: DatabaseSchema,
    conversationHistory?: Array<{ role: string; content: string }>
  ) => Promise<GenerateSqlResult>;
  onOpenPipelineWizard?: () => void;
  /** Tabs requested by PipelineWizard (consumed once) */
  pendingTabs?: PipelineTabRequest[];
  /** Called after pendingTabs have been consumed */
  onTabsConsumed?: () => void;
}

// ─── Pure helper functions ──────────────────────────────────────

/** Extract the query at cursor position or selected text */
function getQueryToRun(ed: editor.IStandaloneCodeEditor): string | null {
  const model = ed.getModel();
  if (!model) return null;

  const selection = ed.getSelection();
  if (selection && !selection.isEmpty()) {
    return model.getValueInRange(selection).trim();
  }

  const position = ed.getPosition();
  if (!position) return null;

  const content = model.getValue();
  const offset = model.getOffsetAt(position);
  const statements = splitStatements(content);
  let currentOffset = 0;

  for (const stmt of statements) {
    const stmtEnd = currentOffset + stmt.length;
    if (offset >= currentOffset && offset <= stmtEnd) {
      return stmt.trim();
    }
    currentOffset = stmtEnd + 1;
  }

  return content.trim();
}

/** Split SQL content into statements by semicolon (respects strings) */
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
      if (current.trim()) statements.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current);
  return statements;
}

/** Load scratch tab content from localStorage */
function loadScratchContent(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_CONTENT;
  } catch {
    return DEFAULT_CONTENT;
  }
}

/** Extract selected text from editor */
function getSelectedText(ed: editor.IStandaloneCodeEditor): string | null {
  const model = ed.getModel();
  const selection = ed.getSelection();
  if (!model || !selection || selection.isEmpty()) return null;
  return model.getValueInRange(selection).trim();
}

/** Clean up TODO text for AI prompt */
function cleanTodoText(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^--\s*/, '').replace(/^TODO:\s*/i, '').trim())
    .filter(line => line.length > 0)
    .join(' ');
}

/** Create the default scratch tab */
function createScratchTab(): EditorTab {
  return {
    id: SCRATCH_TAB_ID,
    label: 'Scratch',
    content: loadScratchContent(),
    closable: false,
    results: null,
    error: null,
    loading: false,
    lastQuery: '',
  };
}

/** Create a tab from a pipeline request */
function createPipelineTab(request: PipelineTabRequest): EditorTab {
  return {
    id: `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: request.label,
    content: request.sql,
    closable: true,
    results: null,
    error: null,
    loading: request.autoRun,
    lastQuery: request.autoRun ? request.sql : '',
  };
}

// ─── Component ──────────────────────────────────────────────────

export function SqlEditor({
  schema,
  executeQuery,
  generateSql,
  generateSqlWithThinking,
  onOpenPipelineWizard,
  pendingTabs,
  onTabsConsumed,
}: SqlEditorProps) {
  const [tabs, setTabs] = useState<EditorTab[]>(() => [createScratchTab()]);
  const [activeTabId, setActiveTabId] = useState(SCRATCH_TAB_ID);
  const [expandedResults, setExpandedResults] = useState(false);
  const [inlineChat, setInlineChat] = useState<InlineChatState>(INITIAL_CHAT_STATE);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const handlersRef = useRef<ActionHandlers | null>(null);
  /** Guards against onChange firing during programmatic setValue calls */
  const switchingRef = useRef(false);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  // ─── Tab helpers ──────────────────────────────────────────────

  /** Immutable update of a single tab */
  const updateTab = useCallback((tabId: string, updates: Partial<EditorTab>) => {
    setTabs(prev => prev.map(t => t.id === tabId ? { ...t, ...updates } : t));
  }, []);

  /** Persist scratch tab content to localStorage */
  const persistScratchContent = useCallback((content: string) => {
    try { localStorage.setItem(STORAGE_KEY, content); } catch { /* ignore */ }
  }, []);

  /** Save current editor content back into the active tab state */
  const syncEditorToActiveTab = useCallback(() => {
    if (!editorRef.current) return;
    const value = editorRef.current.getModel()?.getValue() || '';
    updateTab(activeTabId, { content: value });
    if (activeTabId === SCRATCH_TAB_ID) persistScratchContent(value);
  }, [activeTabId, updateTab, persistScratchContent]);

  /** Switch to a different tab */
  const handleTabSwitch = useCallback((newTabId: string) => {
    if (newTabId === activeTabId || !editorRef.current) return;
    syncEditorToActiveTab();
    setActiveTabId(newTabId);
    const target = tabs.find(t => t.id === newTabId);
    if (target) {
      switchingRef.current = true;
      editorRef.current.setValue(target.content);
      switchingRef.current = false;
    }
  }, [activeTabId, tabs, syncEditorToActiveTab]);

  /** Close a tab */
  const handleCloseTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId);
      if (tabId === activeTabId) {
        const idx = prev.findIndex(t => t.id === tabId);
        const next = filtered[Math.min(idx, filtered.length - 1)] || filtered[0];
        setActiveTabId(next.id);
        switchingRef.current = true;
        editorRef.current?.setValue(next.content);
        switchingRef.current = false;
      }
      return filtered;
    });
  }, [activeTabId]);

  /** Add a new blank tab */
  const handleAddTab = useCallback(() => {
    syncEditorToActiveTab();
    const id = `tab-${Date.now()}`;
    const newTab: EditorTab = {
      id,
      label: 'Untitled',
      content: '',
      closable: true,
      results: null,
      error: null,
      loading: false,
      lastQuery: '',
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
    switchingRef.current = true;
    editorRef.current?.setValue('');
    switchingRef.current = false;
  }, [syncEditorToActiveTab]);

  // ─── Editor content / query ───────────────────────────────────

  /** Handle Monaco content change (skipped during programmatic tab switches) */
  const handleContentChange = useCallback((value: string | undefined) => {
    if (switchingRef.current) return;
    const newContent = value || '';
    updateTab(activeTabId, { content: newContent });
    if (activeTabId === SCRATCH_TAB_ID) persistScratchContent(newContent);
  }, [activeTabId, updateTab, persistScratchContent]);

  /** Run the query at cursor or selection in the active tab */
  const handleRunQuery = useCallback(async () => {
    if (!editorRef.current) return;
    const query = getQueryToRun(editorRef.current);
    if (!query) {
      updateTab(activeTabId, { error: 'No query to run' });
      return;
    }
    updateTab(activeTabId, { loading: true, error: null, results: null, lastQuery: query });
    try {
      const result = await executeQuery(query);
      updateTab(activeTabId, { results: result, loading: false });
    } catch (err) {
      updateTab(activeTabId, {
        error: err instanceof Error ? err.message : 'Query execution failed',
        loading: false,
      });
    }
  }, [activeTabId, executeQuery, updateTab]);

  /** Export active tab results to CSV */
  const handleExport = useCallback(() => {
    if (activeTab.results) exportResultsToCsv(activeTab.results);
  }, [activeTab.results]);

  // ─── Consume pending tabs from pipeline ───────────────────────

  /** Auto-run a list of pipeline tabs sequentially */
  const runPipelineTabs = useCallback(async (pipelineTabs: EditorTab[]) => {
    for (const tab of pipelineTabs) {
      try {
        const result = await executeQuery(tab.content);
        updateTab(tab.id, { results: result, loading: false });
      } catch (err) {
        updateTab(tab.id, {
          error: err instanceof Error ? err.message : 'Query execution failed',
          loading: false,
        });
      }
    }
  }, [executeQuery, updateTab]);

  useEffect(() => {
    if (!pendingTabs?.length) return;
    syncEditorToActiveTab();

    const newTabs = pendingTabs.map(createPipelineTab);
    setTabs(prev => [...prev, ...newTabs]);

    if (newTabs.length > 0) {
      const first = newTabs[0];
      setActiveTabId(first.id);
      switchingRef.current = true;
      editorRef.current?.setValue(first.content);
      switchingRef.current = false;
    }

    onTabsConsumed?.();

    const autoRunTabs = newTabs.filter(t => t.loading);
    if (autoRunTabs.length > 0) {
      // Small delay to let React state settle before running queries
      setTimeout(() => runPipelineTabs(autoRunTabs), 150);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTabs]);

  // ─── Inline chat handlers ────────────────────────────────────

  const getOverlayTop = useCallback((lineNumber: number): number => {
    if (!editorRef.current) return 100;
    const editorTop = editorRef.current.getTopForLineNumber(lineNumber);
    const scrollTop = editorRef.current.getScrollTop();
    return Math.min(editorTop - scrollTop + 40, 200);
  }, []);

  const handleConvertToSql = useCallback(async () => {
    if (!editorRef.current) return;
    const selectedText = getSelectedText(editorRef.current);
    if (!selectedText) {
      updateTab(activeTabId, { error: 'Select a TODO or description to convert to SQL' });
      return;
    }
    const question = cleanTodoText(selectedText);
    if (!question) {
      updateTab(activeTabId, { error: 'No text to convert' });
      return;
    }

    const selection = editorRef.current.getSelection();
    const endLine = selection?.endLineNumber || 1;
    const overlayTop = getOverlayTop(endLine);

    setInlineChat({
      isOpen: true, question, generatedSql: null, thinking: null, summary: null,
      isGenerating: true, error: null, conversationHistory: [],
      overlayTop, selectionEndLine: endLine,
    });
    updateTab(activeTabId, { error: null });

    try {
      const result = await generateSqlWithThinking(question, schema);
      setInlineChat(prev => ({
        ...prev, generatedSql: result.response, thinking: result.thinking,
        summary: result.summary, isGenerating: false,
        conversationHistory: [
          { role: 'user', content: question },
          { role: 'assistant', content: result.response },
        ],
      }));
    } catch (err) {
      setInlineChat(prev => ({
        ...prev, isGenerating: false,
        error: err instanceof Error ? err.message : 'Failed to generate SQL',
      }));
    }
  }, [generateSqlWithThinking, schema, getOverlayTop, activeTabId, updateTab]);

  const handleAcceptSql = useCallback((sql: string) => {
    if (!editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;

    const endLine = inlineChat.selectionEndLine;
    const lineContent = model.getLineContent(endLine);
    const insertPosition = { lineNumber: endLine, column: lineContent.length + 1 };
    const textToInsert = `\n\n${sql};\n`;

    editorRef.current.executeEdits('convert-to-sql', [{
      range: {
        startLineNumber: insertPosition.lineNumber, startColumn: insertPosition.column,
        endLineNumber: insertPosition.lineNumber, endColumn: insertPosition.column,
      },
      text: textToInsert,
    }]);

    const newPosition = model.getPositionAt(
      model.getOffsetAt(insertPosition) + textToInsert.length
    );
    editorRef.current.setPosition(newPosition);
    editorRef.current.focus();
    setInlineChat(INITIAL_CHAT_STATE);
  }, [inlineChat.selectionEndLine]);

  const handleRejectSql = useCallback(() => {
    setInlineChat(INITIAL_CHAT_STATE);
    editorRef.current?.focus();
  }, []);

  const handleRetrySql = useCallback(async () => {
    const { question } = inlineChat;
    if (!question) return;
    setInlineChat(prev => ({ ...prev, isGenerating: true, error: null }));
    try {
      const result = await generateSqlWithThinking(question, schema);
      setInlineChat(prev => ({
        ...prev, generatedSql: result.response, thinking: result.thinking,
        summary: result.summary, isGenerating: false,
        conversationHistory: [
          { role: 'user', content: question },
          { role: 'assistant', content: result.response },
        ],
      }));
    } catch (err) {
      setInlineChat(prev => ({
        ...prev, isGenerating: false,
        error: err instanceof Error ? err.message : 'Failed to generate SQL',
      }));
    }
  }, [inlineChat.question, generateSqlWithThinking, schema]);

  const handleRefineSql = useCallback(async (message: string) => {
    setInlineChat(prev => ({ ...prev, isGenerating: true, error: null }));
    try {
      const history = [...inlineChat.conversationHistory, { role: 'user', content: message }];
      const result = await generateSqlWithThinking(message, schema, history);
      setInlineChat(prev => ({
        ...prev, generatedSql: result.response, thinking: result.thinking,
        summary: result.summary, isGenerating: false,
        conversationHistory: [...history, { role: 'assistant', content: result.response }],
      }));
    } catch (err) {
      setInlineChat(prev => ({
        ...prev, isGenerating: false,
        error: err instanceof Error ? err.message : 'Failed to refine SQL',
      }));
    }
  }, [inlineChat.conversationHistory, generateSqlWithThinking, schema]);

  // ─── Monaco mount ─────────────────────────────────────────────

  const handleEditorMount: OnMount = useCallback((ed, monaco) => {
    editorRef.current = ed;

    ed.addAction({
      id: 'run-query', label: 'Run Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => handlersRef.current?.runQuery(),
    });
    ed.addAction({
      id: 'convert-to-sql', label: 'Convert to SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => handlersRef.current?.convertToSql(),
    });

    monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: word.startColumn, endColumn: word.endColumn,
        };
        const tableItems = Object.keys(schema).map(table => ({
          label: table, kind: monaco.languages.CompletionItemKind.Class,
          insertText: table, range,
        }));
        const columnItems = Object.entries(schema).flatMap(([table, ts]) =>
          ts.columns.map(col => ({
            label: `${table}.${col.name}`, kind: monaco.languages.CompletionItemKind.Field,
            insertText: col.name, detail: col.type, range,
          }))
        );
        return { suggestions: [...tableItems, ...columnItems] };
      },
    });
  }, [schema]);

  useEffect(() => {
    handlersRef.current = { runQuery: handleRunQuery, convertToSql: handleConvertToSql };
  }, [handleRunQuery, handleConvertToSql]);

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-0 bg-gray-900 border-b border-gray-700 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabSwitch(tab.id)}
            className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-t transition border border-b-0 ${
              tab.id === activeTabId
                ? 'bg-gray-800 text-white border-gray-700'
                : 'bg-gray-900 text-gray-500 border-transparent hover:text-gray-300 hover:bg-gray-800/50'
            }`}
          >
            <span className="truncate max-w-[120px]">{tab.label}</span>
            {tab.loading && <span className="animate-spin text-[10px]">⟳</span>}
            {tab.closable && (
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                className="ml-0.5 p-0.5 rounded hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </span>
            )}
          </button>
        ))}
        <button
          onClick={handleAddTab}
          className="p-1.5 text-gray-600 hover:text-gray-300 transition"
          title="New tab"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-800"
        {...{ [TUTORIAL_TARGET_ATTR]: TutorialStepId.SQL_EDITOR_CONTENT }}
      >
        <button
          onClick={handleRunQuery}
          disabled={activeTab.loading || inlineChat.isGenerating}
          className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 rounded transition flex items-center gap-1.5"
        >
          {activeTab.loading ? (
            <><span className="animate-spin">⟳</span> Running...</>
          ) : (
            <>▶ Run</>
          )}
        </button>
        <button
          onClick={handleConvertToSql}
          disabled={activeTab.loading || inlineChat.isOpen}
          className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 rounded transition flex items-center gap-1.5"
        >
          {inlineChat.isGenerating ? (
            <><span className="animate-spin">⟳</span> Converting...</>
          ) : (
            <>✨ Convert to SQL</>
          )}
        </button>
        {onOpenPipelineWizard && (
          <button
            onClick={onOpenPipelineWizard}
            disabled={activeTab.loading}
            className="px-3 py-1.5 text-sm bg-cyan-700 hover:bg-cyan-600 disabled:bg-cyan-700/50 rounded transition flex items-center gap-1.5"
            title="Build a data pipeline of layered SQL views"
          >
            <Workflow className="w-4 h-4" />
            Pipeline Wizard
          </button>
        )}
        <span className="text-xs text-gray-500">
          Ctrl+Enter: run | Ctrl+Shift+Enter: convert
        </span>
        {activeTab.lastQuery && (
          <span className="ml-auto text-xs text-gray-500 truncate max-w-xs">
            Last: {activeTab.lastQuery.slice(0, 50)}...
          </span>
        )}
      </div>

      {/* Editor + Inline Chat overlay */}
      <div className="flex-1 min-h-0 relative" ref={editorContainerRef}>
        <Editor
          height="100%"
          defaultLanguage="sql"
          value={activeTab.content}
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

        {inlineChat.isOpen && (
          <InlineSqlChat
            question={inlineChat.question}
            generatedSql={inlineChat.generatedSql}
            thinking={inlineChat.thinking}
            summary={inlineChat.summary}
            isGenerating={inlineChat.isGenerating}
            error={inlineChat.error}
            onAccept={handleAcceptSql}
            onReject={handleRejectSql}
            onRefine={handleRefineSql}
            onRetry={handleRetrySql}
            top={inlineChat.overlayTop}
          />
        )}
      </div>

      {/* Results Panel */}
      <div className="border-t border-gray-700 bg-gray-850 max-h-[40%] overflow-auto">
        {activeTab.loading && (
          <div className="p-4 text-center text-gray-400">
            <span className="animate-spin inline-block">⟳</span> Executing query...
          </div>
        )}

        {activeTab.error && (
          <div className="p-4 text-red-400 bg-red-900/20 border-l-2 border-red-500">
            <div className="font-medium">Error</div>
            <div className="text-sm mt-1">{activeTab.error}</div>
          </div>
        )}

        {activeTab.results && !activeTab.loading && (
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">
                {activeTab.results.rowCount} row{activeTab.results.rowCount !== 1 ? 's' : ''} returned
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
              results={activeTab.results}
              onExpand={() => setExpandedResults(true)}
              maxRows={RESULTS_PREVIEW_ROWS}
            />
          </div>
        )}

        {!activeTab.loading && !activeTab.error && !activeTab.results && (
          <div className="p-4 text-center text-gray-500 text-sm">
            Run a query to see results
          </div>
        )}
      </div>

      {/* Expanded Results Modal */}
      {expandedResults && activeTab.results && (
        <ExpandedResults
          results={activeTab.results}
          onClose={() => setExpandedResults(false)}
          onExport={handleExport}
        />
      )}
    </div>
  );
}
