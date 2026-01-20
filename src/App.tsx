/**
 * DuckQuery - AI-powered SQL chat interface for DuckDB.
 * Main application component orchestrating chat, database, and AI operations.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useDuckDB, useAI } from './hooks';
import { SimpleChat } from './components/chat/SimpleChat';
import { parseError } from './utils/errorHandler';
import { DEFAULT_PROMPTS } from './constants/aiPrompts';
import type { HistoryEntry } from './types';

export default function DuckQuery() {
  // Core hooks
  const {
    loading: dbLoading,
    error: dbError,
    tables,
    schema,
    schemaLoading,
    executeQuery,
    loadSampleData,
    importCsv,
    getDistinctValues,
  } = useDuckDB();

  const { config, setConfig, generateSql, interpretResults, generateSuggestions, explorePreliminary, fixSql, discoverData } = useAI();

  // Settings tabs
  type SettingsTab = 'api' | 'prompt';

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('api');
  const [editedPrompt, setEditedPrompt] = useState('');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [discovery, setDiscovery] = useState<string | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load suggestions when schema is ready
  useEffect(() => {
    const loadSuggestions = async () => {
      if (tables.length > 0 && config.apiKey && suggestions.length === 0) {
        try {
          const newSuggestions = await generateSuggestions(schema);
          setSuggestions(newSuggestions);
        } catch (err) {
          console.error('Failed to generate suggestions:', err);
        }
      }
    };
    loadSuggestions();
  }, [tables, config.apiKey, schema, suggestions.length, generateSuggestions]);

  // Discover data when new table is added
  useEffect(() => {
    const discover = async () => {
      if (tables.length > 0 && config.apiKey && !discovery) {
        const lastTable = tables[tables.length - 1];
        const tableSchema = schema[lastTable];
        if (tableSchema) {
          try {
            // Find low-cardinality string columns for distinct value analysis
            const categoricalCols = tableSchema.stats.filter(
              (s) => s.type.toLowerCase().includes('varchar') && s.approx_unique <= 20
            );

            // Get distinct values for categorical columns
            let distinctInfo = '';
            for (const col of categoricalCols.slice(0, 3)) {
              try {
                const values = await getDistinctValues(lastTable, col.column, 5);
                const formatted = values.map((v) => `${v.value} (${v.count})`).join(', ');
                distinctInfo += `${col.column}: ${formatted}\n`;
              } catch {
                // Skip if distinct values query fails
              }
            }

            const insight = await discoverData(
              lastTable,
              tableSchema.stats[0]?.count || 0,
              tableSchema.samples,
              distinctInfo || undefined
            );
            setDiscovery(insight);
          } catch (err) {
            console.error('Discovery failed:', err);
          }
        }
      }
    };
    discover();
  }, [tables, config.apiKey, schema, discovery, discoverData, getDistinctValues]);

  // Handle CSV import
  const handleFileImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setImporting(true);
      setImportProgress(0);

      try {
        const tableName = await importCsv(file, setImportProgress);
        setExpandedTables((prev) => ({ ...prev, [tableName]: true }));
        setDiscovery(null); // Reset to trigger new discovery
        setSuggestions([]); // Reset suggestions for new data
      } catch (err) {
        console.error('Import failed:', err);
      }

      setImporting(false);
      setImportProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [importCsv]
  );

  // Handle sample data load
  const handleLoadSample = useCallback(async () => {
    setQueryLoading(true);
    try {
      await loadSampleData();
      setDiscovery('Loaded sample sales dataset with category and revenue data.');
    } catch (err) {
      console.error('Failed to load sample data:', err);
    }
    setQueryLoading(false);
  }, [loadSampleData]);

  // Handle refresh suggestions
  const handleRefreshSuggestions = useCallback(async () => {
    if (!config.apiKey || !tables.length) return;
    try {
      const newSuggestions = await generateSuggestions(schema);
      setSuggestions(newSuggestions);
    } catch (err) {
      console.error('Failed to refresh suggestions:', err);
    }
  }, [config.apiKey, tables.length, schema, generateSuggestions]);

  // Loading state
  if (dbLoading) {
    return (
      <div className="h-screen bg-gray-900 text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400">Initializing DuckDB...</p>
        </div>
      </div>
    );
  }

  return (
      <div className="h-screen bg-gray-900 text-gray-100 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <span>DuckQuery</span>
          </h1>
          <div className="flex gap-2">
            {!tables.length && (
              <button
                onClick={handleLoadSample}
                disabled={queryLoading}
                className="px-3 py-1.5 text-sm bg-purple-600/20 text-purple-400 border border-purple-500/30 hover:bg-purple-600/30 rounded transition flex items-center gap-1.5"
              >
                Sample Data
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition"
            >
              Settings
            </button>
            <label className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded cursor-pointer transition">
              Import CSV
              <input
                type="file"
                accept=".csv"
                onChange={handleFileImport}
                className="hidden"
                ref={fileInputRef}
              />
            </label>
          </div>
        </header>

        {/* Import progress */}
        {importing && (
          <div className="px-4 py-2 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-400">Importing...</span>
              <div className="flex-1 h-2 bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
              <span className="text-sm text-gray-400">{importProgress}%</span>
            </div>
          </div>
        )}

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar - Schema */}
          <aside className="w-56 border-r border-gray-700 flex flex-col bg-gray-850 overflow-hidden">
            {/* Schema */}
            <div className="flex-1 overflow-auto p-3">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Schema
              </h2>
              {tables.length === 0 ? (
                <p className="text-sm text-gray-500">No tables yet</p>
              ) : (
                <ul className="space-y-1">
                  {tables.map((table) => (
                    <li key={table}>
                      <button
                        onClick={() =>
                          setExpandedTables((p) => ({ ...p, [table]: !p[table] }))
                        }
                        className="w-full text-left text-sm py-1 px-2 hover:bg-gray-700 rounded flex items-center gap-1"
                      >
                        <span className="text-gray-500">
                          {expandedTables[table] ? 'v' : '>'}
                        </span>
                        <span className="text-blue-400">{table}</span>
                      </button>
                      {expandedTables[table] && schema[table] && (
                        <ul className="ml-5 mt-1 space-y-0.5">
                          {schema[table].columns.map((col) => (
                            <li
                              key={col.name}
                              className="text-xs text-gray-400 flex justify-between"
                            >
                              <span>{col.name}</span>
                              <span className="text-gray-600">{col.type}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Discovery */}
            {discovery && (
              <div className="border-t border-gray-700 p-3 max-h-64 overflow-auto">
                <h2 className="text-xs font-semibold text-purple-400 uppercase tracking-wide mb-2">
                  Discovery
                </h2>
                <p className="text-xs text-gray-400 whitespace-pre-wrap">{discovery}</p>
              </div>
            )}

            {/* History */}
            <div className="border-t border-gray-700 p-3 max-h-64 overflow-auto">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                History
              </h2>
              {history.length === 0 ? (
                <p className="text-sm text-gray-500">No queries yet</p>
              ) : (
                <ul className="space-y-1">
                  {history.map((h, i) => (
                    <li key={i}>
                      <button
                        className="w-full text-left text-xs py-1 px-2 hover:bg-gray-700 rounded truncate text-gray-400"
                        title={h.nl || h.sql}
                      >
                        {h.nl || h.sql.slice(0, 40)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          {/* Main chat area */}
          <div className="flex-1 flex overflow-hidden">
            <main className="flex-1 flex flex-col overflow-hidden">
              {/* Suggestions bar */}
              {suggestions.length > 0 && (
                <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-gray-700">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      className="px-3 py-1 bg-gray-800 border border-gray-700 hover:border-purple-500 rounded-full text-xs text-gray-400 hover:text-purple-400 transition"
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    onClick={handleRefreshSuggestions}
                    className="p-1 text-gray-600 hover:text-gray-400 transition"
                    title="Refresh suggestions"
                  >
                    Refresh
                  </button>
                </div>
              )}

              {/* Simple Chat */}
              <SimpleChat
                  schema={schema}
                  schemaLoading={schemaLoading}
                  executeQuery={executeQuery}
                />
            </main>
          </div>
        </div>

        {/* Settings modal */}
        {showSettings && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setShowSettings(false)}
          >
            <div
              className="bg-gray-800 rounded-lg p-6 w-full max-w-lg mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold mb-4">Settings</h2>

              {/* Tabs */}
              <div className="flex gap-2 mb-4 border-b border-gray-700">
                <button
                  onClick={() => setSettingsTab('api')}
                  className={`px-4 py-2 text-sm transition ${
                    settingsTab === 'api'
                      ? 'text-blue-400 border-b-2 border-blue-400'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  API
                </button>
                <button
                  onClick={() => {
                    setSettingsTab('prompt');
                    setEditedPrompt(config.customPrompts?.generateSql ?? DEFAULT_PROMPTS.GENERATE_SQL);
                  }}
                  className={`px-4 py-2 text-sm transition ${
                    settingsTab === 'prompt'
                      ? 'text-blue-400 border-b-2 border-blue-400'
                      : 'text-gray-400 hover:text-gray-300'
                  }`}
                >
                  System Prompt
                </button>
              </div>

              {/* API Tab */}
              {settingsTab === 'api' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">API URL</label>
                    <input
                      type="text"
                      value={config.apiUrl}
                      onChange={(e) => setConfig({ apiUrl: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">API Key</label>
                    <input
                      type="password"
                      value={config.apiKey}
                      onChange={(e) => setConfig({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Model</label>
                    <input
                      type="text"
                      value={config.model}
                      onChange={(e) => setConfig({ model: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              )}

              {/* System Prompt Tab */}
              {settingsTab === 'prompt' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      SQL Generation Prompt
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Schema is automatically included in user messages when tables exist.
                    </p>
                    <textarea
                      value={editedPrompt}
                      onChange={(e) => setEditedPrompt(e.target.value)}
                      rows={12}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setConfig({ customPrompts: { ...config.customPrompts, generateSql: editedPrompt } });
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm transition"
                    >
                      Save Prompt
                    </button>
                    <button
                      onClick={() => {
                        setEditedPrompt(DEFAULT_PROMPTS.GENERATE_SQL);
                        setConfig({ customPrompts: { ...config.customPrompts, generateSql: undefined } });
                      }}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
                    >
                      Reset to Default
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={() => setShowSettings(false)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}
