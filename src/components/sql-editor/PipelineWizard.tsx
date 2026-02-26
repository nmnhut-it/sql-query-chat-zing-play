/**
 * Pipeline Wizard - chat-based wizard for building layered SQL view pipelines.
 *
 * Features:
 * - Chat-driven layer creation with AI assistance
 * - Confirmation step before creating each view (user must click Confirm)
 * - Auto-refreshes schema sidebar after views are created
 * - Pipeline persistence in DuckDB (_pipelines / _pipeline_layers tables)
 * - CRUD: create, resume, delete pipelines
 * - Run pipeline and generate report
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Send, Play, Check, Trash2, Copy, ChevronDown, ChevronRight,
  Workflow, Layers, RefreshCw, Plus, FolderOpen, FileText, AlertCircle,
} from 'lucide-react';
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
  /** Whether the user confirmed this layer for execution */
  confirmed: boolean;
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
  /** Whether this is a confirmation prompt */
  confirmationFor?: string;
  timestamp: number;
}

/** Persisted pipeline metadata */
interface SavedPipeline {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  layer_count: number;
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
  onRefreshSchema?: () => Promise<void>;
}

/** Wizard view modes */
type WizardView = 'manager' | 'editor';

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

/** Ensure persistence tables exist */
async function ensurePipelineTables(executeQuery: (sql: string) => Promise<QueryResult>) {
  await executeQuery(`
    CREATE TABLE IF NOT EXISTS _pipelines (
      id INTEGER PRIMARY KEY,
      name VARCHAR NOT NULL,
      description VARCHAR DEFAULT '',
      created_at TIMESTAMP DEFAULT current_timestamp,
      updated_at TIMESTAMP DEFAULT current_timestamp
    )
  `);
  await executeQuery(`
    CREATE TABLE IF NOT EXISTS _pipeline_layers (
      id INTEGER PRIMARY KEY,
      pipeline_id INTEGER NOT NULL,
      layer_order INTEGER NOT NULL,
      name VARCHAR NOT NULL,
      description VARCHAR DEFAULT '',
      sql_select VARCHAR NOT NULL,
      view_sql VARCHAR NOT NULL,
      created BOOLEAN DEFAULT false
    )
  `);
  // Sequence helper: get next id
  await executeQuery(`
    CREATE SEQUENCE IF NOT EXISTS seq_pipeline START 1
  `);
  await executeQuery(`
    CREATE SEQUENCE IF NOT EXISTS seq_pipeline_layer START 1
  `);
}

export function PipelineWizard({ schema, executeQuery, generateSqlWithThinking, onClose, onRefreshSchema }: PipelineWizardProps) {
  const [view, setView] = useState<WizardView>('manager');
  const [messages, setMessages] = useState<WizardMessage[]>([]);
  const [layers, setLayers] = useState<PipelineLayer[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedLayers, setExpandedLayers] = useState<Record<string, boolean>>({});
  const [previewingLayer, setPreviewingLayer] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pipeline management state
  const [savedPipelines, setSavedPipelines] = useState<SavedPipeline[]>([]);
  const [currentPipelineId, setCurrentPipelineId] = useState<number | null>(null);
  const [currentPipelineName, setCurrentPipelineName] = useState('');
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [dbReady, setDbReady] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [report, setReport] = useState<{ layerName: string; result: QueryResult }[] | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Initialize persistence tables and load saved pipelines
  useEffect(() => {
    const init = async () => {
      try {
        await ensurePipelineTables(executeQuery);
        setDbReady(true);
        await loadPipelines();
      } catch (err) {
        console.error('Failed to init pipeline tables:', err);
        setDbReady(true); // proceed anyway
      }
      setPipelinesLoading(false);
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPipelines = useCallback(async () => {
    try {
      const result = await executeQuery(`
        SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
               (SELECT COUNT(*) FROM _pipeline_layers l WHERE l.pipeline_id = p.id) as layer_count
        FROM _pipelines p
        ORDER BY p.updated_at DESC
      `);
      setSavedPipelines(result.rows.map(r => ({
        id: Number(r.id),
        name: String(r.name),
        description: String(r.description || ''),
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
        layer_count: Number(r.layer_count),
      })));
    } catch {
      setSavedPipelines([]);
    }
  }, [executeQuery]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when editor view
  useEffect(() => {
    if (view === 'editor') inputRef.current?.focus();
  }, [view]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'editor') {
          setView('manager');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, view]);

  /** Create a new pipeline */
  const handleCreatePipeline = useCallback(async () => {
    const name = newPipelineName.trim();
    if (!name) return;

    try {
      const idResult = await executeQuery(`SELECT nextval('seq_pipeline') as id`);
      const id = Number(idResult.rows[0].id);
      await executeQuery(`INSERT INTO _pipelines (id, name) VALUES (${id}, '${name.replace(/'/g, "''")}')`);
      setCurrentPipelineId(id);
      setCurrentPipelineName(name);
      setLayers([]);
      setMessages([]);
      setNewPipelineName('');
      setReport(null);
      setView('editor');
      await loadPipelines();
    } catch (err) {
      console.error('Failed to create pipeline:', err);
    }
  }, [newPipelineName, executeQuery, loadPipelines]);

  /** Resume an existing pipeline */
  const handleResumePipeline = useCallback(async (pipelineId: number) => {
    try {
      const layerResult = await executeQuery(`
        SELECT id, name, description, sql_select, view_sql, created, layer_order
        FROM _pipeline_layers
        WHERE pipeline_id = ${pipelineId}
        ORDER BY layer_order ASC
      `);

      const loadedLayers: PipelineLayer[] = layerResult.rows.map(r => ({
        id: String(r.id),
        name: String(r.name),
        description: String(r.description || ''),
        sql: String(r.sql_select),
        viewSql: String(r.view_sql),
        created: Boolean(r.created),
        confirmed: Boolean(r.created), // already-created layers are implicitly confirmed
      }));

      const pipeline = savedPipelines.find(p => p.id === pipelineId);
      setCurrentPipelineId(pipelineId);
      setCurrentPipelineName(pipeline?.name || `Pipeline #${pipelineId}`);
      setLayers(loadedLayers);
      setMessages([{
        id: 'resume-msg',
        role: 'system',
        content: `Resumed pipeline "${pipeline?.name}" with ${loadedLayers.length} layer(s).`,
        timestamp: Date.now(),
      }]);
      setReport(null);

      // Expand all layers by default
      const expanded: Record<string, boolean> = {};
      loadedLayers.forEach(l => { expanded[l.id] = true; });
      setExpandedLayers(expanded);

      setView('editor');
    } catch (err) {
      console.error('Failed to load pipeline:', err);
    }
  }, [executeQuery, savedPipelines]);

  /** Delete a pipeline */
  const handleDeletePipeline = useCallback(async (pipelineId: number) => {
    try {
      await executeQuery(`DELETE FROM _pipeline_layers WHERE pipeline_id = ${pipelineId}`);
      await executeQuery(`DELETE FROM _pipelines WHERE id = ${pipelineId}`);
      await loadPipelines();
      if (currentPipelineId === pipelineId) {
        setCurrentPipelineId(null);
        setView('manager');
      }
    } catch (err) {
      console.error('Failed to delete pipeline:', err);
    }
  }, [executeQuery, loadPipelines, currentPipelineId]);

  /** Save current layers to the DB */
  const saveLayers = useCallback(async () => {
    if (currentPipelineId == null) return;

    try {
      // Delete old layers and re-insert
      await executeQuery(`DELETE FROM _pipeline_layers WHERE pipeline_id = ${currentPipelineId}`);

      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        const idResult = await executeQuery(`SELECT nextval('seq_pipeline_layer') as id`);
        const id = Number(idResult.rows[0].id);
        await executeQuery(`
          INSERT INTO _pipeline_layers (id, pipeline_id, layer_order, name, description, sql_select, view_sql, created)
          VALUES (${id}, ${currentPipelineId}, ${i}, '${l.name.replace(/'/g, "''")}', '${l.description.replace(/'/g, "''")}', '${l.sql.replace(/'/g, "''")}', '${l.viewSql.replace(/'/g, "''")}', ${l.created})
        `);
      }

      // Update timestamp
      await executeQuery(`UPDATE _pipelines SET updated_at = current_timestamp WHERE id = ${currentPipelineId}`);
    } catch (err) {
      console.error('Failed to save layers:', err);
    }
  }, [currentPipelineId, layers, executeQuery]);

  // Auto-save layers whenever they change (debounced)
  useEffect(() => {
    if (currentPipelineId == null || layers.length === 0) return;
    const timeout = setTimeout(() => saveLayers(), 1000);
    return () => clearTimeout(timeout);
  }, [layers, currentPipelineId, saveLayers]);

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
            confirmed: false,
          };

          setLayers(prev => [...prev, newLayer]);
          setExpandedLayers(prev => ({ ...prev, [layerId]: true }));

          const assistantMsg: WizardMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: result.summary || `Created view \`${parsed.name}\`.`,
            thinking: result.thinking || undefined,
            summary: result.summary || undefined,
            layerId,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, assistantMsg]);

          // Add confirmation prompt in chat
          const confirmMsg: WizardMessage = {
            id: (Date.now() + 3).toString(),
            role: 'system',
            content: `Review the layer "${parsed.name}" in the panel. Click "Confirm" to approve it, then "Create View" to execute.`,
            confirmationFor: layerId,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, confirmMsg]);
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

  /** Confirm a layer (user approves before creating) */
  const handleConfirmLayer = useCallback((layerId: string) => {
    setLayers(prev => prev.map(l =>
      l.id === layerId ? { ...l, confirmed: true } : l
    ));

    const layer = layers.find(l => l.id === layerId);
    const sysMsg: WizardMessage = {
      id: Date.now().toString(),
      role: 'system',
      content: `Layer "${layer?.name}" confirmed. You can now click "Create View" to execute it.`,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, sysMsg]);
  }, [layers]);

  /** Create a view (execute the CREATE OR REPLACE VIEW statement) */
  const handleCreateView = useCallback(async (layerId: string) => {
    const layer = layers.find(l => l.id === layerId);
    if (!layer || !layer.confirmed) return;

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

      // Auto-refresh the schema sidebar
      if (onRefreshSchema) {
        await onRefreshSchema();
      }
    } catch (err) {
      const errorStr = err instanceof Error ? err.message : 'Failed to create view';
      setLayers(prev => prev.map(l =>
        l.id === layerId
          ? { ...l, error: errorStr }
          : l
      ));
    }
  }, [layers, executeQuery, onRefreshSchema]);

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

  /** Execute all confirmed-but-not-created layers in order */
  const handleCreateAll = useCallback(async () => {
    for (const layer of layers) {
      if (layer.confirmed && !layer.created) {
        await handleCreateView(layer.id);
      }
    }
  }, [layers, handleCreateView]);

  /** Run the entire pipeline and produce a report */
  const handleRunPipeline = useCallback(async () => {
    setReportLoading(true);
    setReport(null);
    const results: { layerName: string; result: QueryResult }[] = [];

    try {
      for (const layer of layers) {
        // Ensure the view is created
        if (!layer.created && layer.confirmed) {
          await handleCreateView(layer.id);
        }

        if (layer.created || layer.confirmed) {
          try {
            const result = await executeQuery(`SELECT * FROM ${layer.name} LIMIT 50`);
            results.push({ layerName: layer.name, result });
          } catch {
            // Skip layers that fail
          }
        }
      }

      setReport(results);

      const sysMsg: WizardMessage = {
        id: Date.now().toString(),
        role: 'system',
        content: `Pipeline report generated: ${results.length} layer(s) with data.`,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, sysMsg]);
    } catch (err) {
      console.error('Pipeline run failed:', err);
    } finally {
      setReportLoading(false);
    }
  }, [layers, executeQuery, handleCreateView]);

  // ─── Manager View ────────────────────────────────────────
  if (view === 'manager') {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden shadow-2xl max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-800">
            <div className="flex items-center gap-3">
              <Workflow className="w-5 h-5 text-cyan-400" />
              <h2 className="text-lg font-semibold text-gray-100">Pipeline Manager</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-gray-300 transition"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Create new */}
          <div className="px-5 py-4 border-b border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <Plus className="w-4 h-4 text-cyan-400" />
              New Pipeline
            </h3>
            <form
              onSubmit={(e) => { e.preventDefault(); handleCreatePipeline(); }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={newPipelineName}
                onChange={(e) => setNewPipelineName(e.target.value)}
                placeholder="Pipeline name..."
                className="flex-1 bg-gray-800 text-gray-100 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={!newPipelineName.trim()}
                className="px-4 py-2 text-sm bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition"
              >
                Create
              </button>
            </form>
          </div>

          {/* Saved pipelines list */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-cyan-400" />
              Saved Pipelines
            </h3>

            {pipelinesLoading ? (
              <div className="text-center py-8">
                <RefreshCw className="w-5 h-5 text-gray-500 animate-spin mx-auto" />
                <p className="text-xs text-gray-500 mt-2">Loading...</p>
              </div>
            ) : savedPipelines.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">
                No saved pipelines. Create one above.
              </p>
            ) : (
              <ul className="space-y-2">
                {savedPipelines.map(p => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 hover:border-cyan-700/40 transition"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-200 truncate">{p.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {p.layer_count} layer{p.layer_count !== 1 ? 's' : ''}
                        {' · '}
                        updated {new Date(p.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-3">
                      <button
                        onClick={() => handleResumePipeline(p.id)}
                        className="px-3 py-1 text-xs bg-cyan-800/40 hover:bg-cyan-700/60 text-cyan-400 rounded transition"
                        title="Resume editing"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleDeletePipeline(p.id)}
                        className="p-1 text-gray-500 hover:text-red-400 transition"
                        title="Delete pipeline"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Editor View ─────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-5xl h-[85vh] mx-4 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setView('manager'); loadPipelines(); }}
              className="p-1 text-gray-500 hover:text-gray-300 transition"
              title="Back to pipeline manager"
            >
              <ChevronLeft />
            </button>
            <Workflow className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-semibold text-gray-100 truncate max-w-xs">{currentPipelineName}</h2>
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
                  Copy All
                </button>
                <button
                  onClick={handleCreateAll}
                  disabled={layers.every(l => l.created) || layers.every(l => !l.confirmed)}
                  className="px-3 py-1 text-xs bg-green-700 hover:bg-green-600 disabled:bg-green-700/30 rounded transition flex items-center gap-1.5"
                >
                  <Play className="w-3 h-3" />
                  Create All
                </button>
                <button
                  onClick={handleRunPipeline}
                  disabled={reportLoading || layers.filter(l => l.created).length === 0}
                  className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-blue-700/30 rounded transition flex items-center gap-1.5"
                >
                  <FileText className="w-3 h-3" />
                  {reportLoading ? 'Running...' : 'Run & Report'}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-500 hover:text-gray-300 transition"
              title="Close"
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
                      Each view builds on the previous one. You'll confirm each step before it executes.
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
                      <div className={`px-3 py-1.5 rounded-full text-xs flex items-center gap-2 ${
                        msg.confirmationFor
                          ? 'bg-amber-900/20 border border-amber-700/30 text-amber-400'
                          : 'bg-green-900/20 border border-green-700/30 text-green-400'
                      }`}>
                        {msg.confirmationFor && <AlertCircle className="w-3 h-3" />}
                        {msg.content}
                        {msg.confirmationFor && (() => {
                          const layer = layers.find(l => l.id === msg.confirmationFor);
                          if (layer && !layer.confirmed) {
                            return (
                              <button
                                onClick={() => handleConfirmLayer(msg.confirmationFor!)}
                                className="ml-2 px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded transition"
                              >
                                Confirm
                              </button>
                            );
                          }
                          if (layer?.confirmed) {
                            return <Check className="w-3 h-3 text-green-400 ml-1" />;
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="max-w-[90%] space-y-2">
                      {msg.thinking && <ThinkingBlock thinking={msg.thinking} />}
                      <div className="text-sm text-gray-300">{msg.content}</div>
                      {msg.layerId && (
                        <div className="text-xs text-cyan-400">
                          → Layer added to pipeline panel (needs confirmation)
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

          {/* Right: Pipeline layers panel + report */}
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
                        : layer.confirmed
                        ? 'border-amber-700/40 bg-amber-900/10'
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
                        {layer.confirmed && !layer.created && (
                          <span className="text-[10px] text-amber-400 bg-amber-900/30 px-1 rounded">confirmed</span>
                        )}
                      </button>
                      <div className="flex gap-1">
                        {!layer.confirmed && (
                          <button
                            onClick={() => handleConfirmLayer(layer.id)}
                            className="p-1 text-amber-400 hover:text-amber-300 transition"
                            title="Confirm this layer"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        )}
                        {layer.confirmed && !layer.created && (
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

              {/* Report section */}
              {report && report.length > 0 && (
                <div className="mt-4 border-t border-gray-700 pt-3">
                  <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <FileText className="w-3 h-3" />
                    Pipeline Report
                  </h4>
                  {report.map((r, i) => (
                    <div key={i} className="mb-3">
                      <div className="text-xs font-medium text-gray-300 mb-1">{r.layerName}</div>
                      <div className="text-[10px] text-gray-500 mb-1">{r.result.rowCount} rows</div>
                      <div className="max-h-32 overflow-auto">
                        <CompactResults results={r.result} onExpand={() => {}} maxRows={5} />
                      </div>
                    </div>
                  ))}
                </div>
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
                          : layer.confirmed
                          ? 'bg-amber-900/30 text-amber-400 border border-amber-700/30'
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

/** Simple back-arrow icon */
function ChevronLeft() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}
