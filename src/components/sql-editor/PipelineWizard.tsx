/**
 * Pipeline Wizard - chat-based wizard for building layered SQL view pipelines.
 *
 * Design philosophy:
 * - Avoids JOINs; uses WHERE ... IN (SELECT ...) for referencing across layers.
 * - Each layer is a CREATE OR REPLACE VIEW statement.
 * - Views build on top of each other: raw -> cleaned -> enriched -> final.
 * - The chat guides the user through defining each layer step by step.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Play, Check, Plus, Trash2, Copy, ChevronDown, ChevronRight, Workflow, Layers } from 'lucide-react';
import type { QueryResult, DatabaseSchema } from '../../types';
import type { GenerateSqlResult } from '../../hooks/useAI';
import { ThinkingBlock, ThinkingIndicator } from '../chat/ThinkingBlock';
import { CompactResults } from '../chat/CompactResults';

/** A single layer (view) in the pipeline */
interface PipelineLayer {
  id: string;
  name: string;
  description: string;
  sql: string;
  /** The CREATE OR REPLACE VIEW statement */
  viewSql: string;
  /** Whether this view has been executed/created */
  created: boolean;
  /** Result from executing the view's SELECT */
  previewResult?: QueryResult;
  /** Error from creating the view */
  error?: string;
}

/** Chat message within the wizard */
interface WizardMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  summary?: string;
  /** If this message produced a layer */
  layerId?: string;
  timestamp: number;
}

interface PipelineWizardProps {
  schema: DatabaseSchema;
  executeQuery: (sql: string) => Promise<QueryResult>;
  generateSqlWithThinking: (
    question: string,
    schema: DatabaseSchema,
    conversationHistory?: Array<{ role: string; content: string }>
  ) => Promise<GenerateSqlResult>;
  onClose: () => void;
}

const PIPELINE_SYSTEM_CONTEXT = `You are a data pipeline architect. The user wants to build a data pipeline using layered SQL views in DuckDB.

CRITICAL RULES:
1. NEVER use JOIN. Instead, use WHERE column IN (SELECT column FROM other_view).
2. Each layer should be a CREATE OR REPLACE VIEW statement.
3. Views should be layered: base/raw -> cleaned/filtered -> enriched/calculated -> final/aggregated.
4. Keep each view focused on ONE transformation step.
5. Name views with a prefix pattern like: v_raw_*, v_clean_*, v_enrich_*, v_final_*.
6. Always reference previous views (not raw tables) once they exist.

RESPONSE FORMAT:
Always include a <think> section and a <summary> section before your SQL.

<think>
Your step-by-step reasoning about the pipeline layer.
</think>

<summary>
Plain-English explanation of what this view does and how it fits in the pipeline.
</summary>

After </summary>, output ONLY the CREATE OR REPLACE VIEW statement.
No markdown, no backticks, no extra text.

If the user is asking a question (not requesting a view), start with "CHAT:" followed by your response.
If you need clarification, start with "CLARIFY:" followed by your question.`;

export function PipelineWizard({ schema, executeQuery, generateSqlWithThinking, onClose }: PipelineWizardProps) {
  const [messages, setMessages] = useState<WizardMessage[]>([]);
  const [layers, setLayers] = useState<PipelineLayer[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedLayers, setExpandedLayers] = useState<Record<string, boolean>>({});
  const [previewingLayer, setPreviewingLayer] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  /** Build conversation history for the AI, including layer context */
  const buildHistory = useCallback((): Array<{ role: string; content: string }> => {
    const layerContext = layers.length > 0
      ? `\n\nEXISTING PIPELINE LAYERS:\n${layers.map((l, i) => `Layer ${i + 1} (${l.name}): ${l.description}\nSQL: ${l.viewSql}`).join('\n\n')}`
      : '';

    const history: Array<{ role: string; content: string }> = [
      { role: 'system', content: PIPELINE_SYSTEM_CONTEXT + layerContext },
    ];

    // Include last 10 messages for context
    const recentMessages = messages.slice(-10);
    for (const msg of recentMessages) {
      if (msg.role === 'system') continue;
      history.push({ role: msg.role, content: msg.content });
    }

    return history;
  }, [layers, messages]);

  /** Parse a CREATE OR REPLACE VIEW statement to extract view name and select SQL */
  const parseViewStatement = (sql: string): { name: string; selectSql: string; viewSql: string } | null => {
    const match = sql.match(/CREATE\s+OR\s+REPLACE\s+VIEW\s+(\S+)\s+AS\s+([\s\S]+)/i);
    if (!match) return null;
    const name = match[1].replace(/[";]/g, '');
    const selectSql = match[2].replace(/;\s*$/, '');
    return { name, selectSql, viewSql: sql.replace(/;\s*$/, '') + ';' };
  };

  /** Handle sending a message */
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: WizardMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = buildHistory();
      history.push({ role: 'user', content: text });

      const result = await generateSqlWithThinking(text, schema, history);
      const response = result.response.replace(/```sql\n?|\n?```/g, '').trim();

      // Check if it's a conversational/clarification response
      if (response.startsWith('CHAT:') || response.startsWith('CLARIFY:')) {
        const content = response.replace(/^(CHAT:|CLARIFY:)\s*/, '');
        const assistantMsg: WizardMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content,
          thinking: result.thinking || undefined,
          timestamp: Date.now(),
        };
        setMessages(prev => [...prev, assistantMsg]);
      } else {
        // It's a CREATE VIEW statement
        const parsed = parseViewStatement(response);

        if (parsed) {
          const layerId = (Date.now() + 2).toString();
          const newLayer: PipelineLayer = {
            id: layerId,
            name: parsed.name,
            description: result.summary || 'Pipeline layer',
            sql: parsed.selectSql,
            viewSql: parsed.viewSql,
            created: false,
          };

          setLayers(prev => [...prev, newLayer]);
          setExpandedLayers(prev => ({ ...prev, [layerId]: true }));

          const assistantMsg: WizardMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: result.summary || `Created view \`${parsed.name}\`. Click "Create View" to execute it.`,
            thinking: result.thinking || undefined,
            summary: result.summary || undefined,
            layerId,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, assistantMsg]);
        } else {
          // Couldn't parse as VIEW - show as plain response
          const assistantMsg: WizardMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: response,
            thinking: result.thinking || undefined,
            summary: result.summary || undefined,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, assistantMsg]);
        }
      }
    } catch (err) {
      const errorMsg: WizardMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Failed to generate'}`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, buildHistory, generateSqlWithThinking, schema]);

  /** Create a view (execute the CREATE OR REPLACE VIEW statement) */
  const handleCreateView = useCallback(async (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    try {
      await executeQuery(layer.viewSql);

      // Preview the view
      const preview = await executeQuery(`SELECT * FROM ${layer.name} LIMIT 10`);

      setLayers(prev => prev.map(l =>
        l.id === layerId
          ? { ...l, created: true, previewResult: preview, error: undefined }
          : l
      ));

      const sysMsg: WizardMessage = {
        id: Date.now().toString(),
        role: 'system',
        content: `View \`${layer.name}\` created successfully (${preview.rowCount} rows previewed).`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, sysMsg]);
    } catch (err) {
      const errorStr = err instanceof Error ? err.message : 'Failed to create view';
      setLayers(prev => prev.map(l =>
        l.id === layerId
          ? { ...l, error: errorStr }
          : l
      ));
    }
  }, [layers, executeQuery]);

  /** Remove a layer */
  const handleRemoveLayer = useCallback((layerId: string) => {
    setLayers(prev => prev.filter(l => l.id !== layerId));
  }, []);

  /** Copy all view SQL to clipboard */
  const handleCopyAll = useCallback(async () => {
    const allSql = layers.map(l => l.viewSql).join('\n\n');
    try {
      await navigator.clipboard.writeText(allSql);
    } catch {
      // Ignore clipboard errors
    }
  }, [layers]);

  /** Preview a layer's SELECT results */
  const handlePreviewLayer = useCallback(async (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    setPreviewingLayer(layerId);
    try {
      // If not created yet, try to execute the SELECT directly
      const sql = layer.created
        ? `SELECT * FROM ${layer.name} LIMIT 20`
        : `${layer.sql} LIMIT 20`;
      const result = await executeQuery(sql);
      setLayers(prev => prev.map(l =>
        l.id === layerId ? { ...l, previewResult: result } : l
      ));
    } catch (err) {
      setLayers(prev => prev.map(l =>
        l.id === layerId
          ? { ...l, error: err instanceof Error ? err.message : 'Preview failed' }
          : l
      ));
    } finally {
      setPreviewingLayer(null);
    }
  }, [layers, executeQuery]);

  /** Execute all layers in order */
  const handleCreateAll = useCallback(async () => {
    for (const layer of layers) {
      if (!layer.created) {
        await handleCreateView(layer.id);
      }
    }
  }, [layers, handleCreateView]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-5xl h-[85vh] mx-4 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <Workflow className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-gray-100">Pipeline Wizard</h2>
            <span className="text-xs text-gray-500 bg-gray-700 px-2 py-0.5 rounded-full">
              {layers.length} layer{layers.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {layers.length > 0 && (
              <>
                <button
                  onClick={handleCopyAll}
                  className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition flex items-center gap-1.5"
                >
                  <Copy className="w-3 h-3" />
                  Copy All SQL
                </button>
                <button
                  onClick={handleCreateAll}
                  disabled={layers.every(l => l.created)}
                  className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 disabled:bg-green-700/30 rounded transition flex items-center gap-1.5"
                >
                  <Play className="w-3 h-3" />
                  Create All Views
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-gray-300 transition"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body: two columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Chat */}
          <div className="flex-1 flex flex-col border-r border-gray-700">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Welcome message */}
              {messages.length === 0 && (
                <div className="text-center py-8 space-y-3">
                  <Layers className="w-10 h-10 text-cyan-500/50 mx-auto" />
                  <div className="text-gray-400 text-sm max-w-md mx-auto space-y-2">
                    <p className="font-medium text-gray-300">Build a data pipeline with layered views</p>
                    <p>Describe what you want to analyze. I'll help you build it step by step using layered SQL views.</p>
                    <p className="text-xs text-gray-500">
                      Each view builds on the previous one. No JOINs — we use WHERE...IN for cross-table references.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    {[
                      'Start with a base view of all orders',
                      'Filter to only 2024 data',
                      'Add revenue calculations per category',
                    ].map((suggestion, i) => (
                      <button
                        key={i}
                        onClick={() => setInput(suggestion)}
                        className="px-3 py-1.5 text-xs bg-gray-800 border border-gray-700 hover:border-cyan-500/50 hover:text-cyan-400 rounded-full text-gray-400 transition"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map(msg => (
                <div key={msg.id}>
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-cyan-800/40 border border-cyan-700/30 text-gray-100 rounded-lg px-4 py-2 text-sm">
                        {msg.content}
                      </div>
                    </div>
                  ) : msg.role === 'system' ? (
                    <div className="flex justify-center">
                      <div className="px-3 py-1 bg-green-900/20 border border-green-700/30 rounded-full text-xs text-green-400">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-[90%] space-y-2">
                      {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                      <div className="text-sm text-gray-300">{msg.content}</div>
                      {msg.layerId && (
                        <div className="text-xs text-cyan-400">
                          → Layer added to pipeline panel
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start max-w-[90%]">
                  <ThinkingIndicator />
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Describe the next pipeline layer..."
                  disabled={isLoading}
                  className="flex-1 bg-gray-800 text-gray-100 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>

          {/* Right: Pipeline layers panel */}
          <div className="w-80 flex flex-col bg-gray-850 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700">
              <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyan-400" />
                Pipeline Layers
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {layers.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-8">
                  No layers yet. Start chatting to build your pipeline.
                </p>
              ) : (
                layers.map((layer, index) => (
                  <div
                    key={layer.id}
                    className={`rounded-lg border overflow-hidden ${
                      layer.created
                        ? 'border-green-700/40 bg-green-900/10'
                        : layer.error
                        ? 'border-red-700/40 bg-red-900/10'
                        : 'border-gray-700 bg-gray-800/50'
                    }`}
                  >
                    {/* Layer header */}
                    <div className="flex items-center justify-between px-3 py-2">
                      <button
                        onClick={() => setExpandedLayers(prev => ({ ...prev, [layer.id]: !prev[layer.id] }))}
                        className="flex items-center gap-2 text-xs font-medium text-gray-300 hover:text-white transition"
                      >
                        {expandedLayers[layer.id] ? (
                          <ChevronDown className="w-3 h-3 text-gray-500" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-gray-500" />
                        )}
                        <span className="text-gray-500">{index + 1}.</span>
                        <span className="text-cyan-400">{layer.name}</span>
                        {layer.created && <Check className="w-3 h-3 text-green-400" />}
                      </button>
                      <div className="flex gap-1">
                        {!layer.created && (
                          <button
                            onClick={() => handleCreateView(layer.id)}
                            className="p-1 text-green-400 hover:text-green-300 transition"
                            title="Create this view"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveLayer(layer.id)}
                          className="p-1 text-gray-500 hover:text-red-400 transition"
                          title="Remove layer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {expandedLayers[layer.id] && (
                      <div className="border-t border-gray-700/50 px-3 py-2 space-y-2">
                        <p className="text-xs text-gray-400">{layer.description}</p>
                        <pre className="text-xs font-mono text-green-400/80 bg-gray-900/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                          {layer.viewSql}
                        </pre>

                        {layer.error && (
                          <div className="text-xs text-red-400 bg-red-900/20 rounded p-2">
                            {layer.error}
                          </div>
                        )}

                        {layer.created && !layer.previewResult && (
                          <button
                            onClick={() => handlePreviewLayer(layer.id)}
                            disabled={previewingLayer === layer.id}
                            className="text-xs text-cyan-400 hover:text-cyan-300 transition"
                          >
                            {previewingLayer === layer.id ? 'Loading...' : 'Preview data'}
                          </button>
                        )}

                        {layer.previewResult && (
                          <div className="max-h-40 overflow-auto">
                            <CompactResults
                              results={layer.previewResult}
                              onExpand={() => {}}
                              maxRows={5}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Pipeline visualization (simple) */}
            {layers.length > 1 && (
              <div className="border-t border-gray-700 px-4 py-3">
                <div className="text-xs text-gray-500 mb-2">Pipeline flow:</div>
                <div className="flex flex-wrap items-center gap-1">
                  {layers.map((layer, i) => (
                    <span key={layer.id} className="flex items-center gap-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        layer.created
                          ? 'bg-green-900/30 text-green-400 border border-green-700/30'
                          : 'bg-gray-800 text-gray-400 border border-gray-700'
                      }`}>
                        {layer.name}
                      </span>
                      {i < layers.length - 1 && (
                        <span className="text-gray-600 text-xs">→</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
