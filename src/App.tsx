import { useState, useEffect, useRef, useCallback } from 'react';
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.28.0/+esm';

export default function DuckQuery() {
    const [db, setDb] = useState<any>(null);
    const [conn, setConn] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // OpenAI settings
    const [showSettings, setShowSettings] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [apiUrl, setApiUrl] = useState('https://api.openai.com/v1/chat/completions');
    const [model, setModel] = useState('gpt-4o-mini');

    // Data state
    const [tables, setTables] = useState<string[]>([]);
    const [schema, setSchema] = useState<Record<string, { name: string, type: string }[]>>({});
    const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

    // Query state
    const [nlQuery, setNlQuery] = useState('');
    const [sqlQuery, setSqlQuery] = useState('');
    const [results, setResults] = useState<any[] | null>(null);
    const [columns, setColumns] = useState<string[]>([]);
    const [queryLoading, setQueryLoading] = useState(false);
    const [history, setHistory] = useState<any[]>([]);

    // Import state
    const [importing, setImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const fileInputRef = useRef(null);

    // Initialize DuckDB
    useEffect(() => {
        async function initDuckDB() {
            try {
                const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
                const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
                const worker_url = URL.createObjectURL(
                    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
                );
                const worker = new Worker(worker_url);
                const logger = new duckdb.ConsoleLogger();
                const database = new duckdb.AsyncDuckDB(logger, worker);
                await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
                URL.revokeObjectURL(worker_url);
                const connection = await database.connect();
                setDb(database);
                setConn(connection);
                setLoading(false);
            } catch (err) {
                setError('Failed to initialize DuckDB: ' + err.message);
                setLoading(false);
            }
        }
        initDuckDB();
    }, []);

    // Refresh schema
    const refreshSchema = useCallback(async () => {
        if (!conn) return;
        try {
            const tableResult = await conn.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`);
            const tableNames = tableResult.toArray().map(r => r.table_name);
            setTables(tableNames);

            const schemaObj = {};
            for (const table of tableNames) {
                const colResult = await conn.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}'`);
                schemaObj[table] = colResult.toArray().map(r => ({ name: r.column_name, type: r.data_type }));
            }
            setSchema(schemaObj);
        } catch (err) {
            console.error('Schema refresh error:', err);
        }
    }, [conn]);

    // Import CSV
    const handleFileImport = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !db || !conn) return;

        setImporting(true);
        setImportProgress(0);

        try {
            const tableName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');

            // Register file with DuckDB
            await db.registerFileHandle(file.name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);

            // Create table from CSV
            setImportProgress(50);
            await conn.query(`CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${file.name}')`);

            setImportProgress(100);
            await refreshSchema();
            setExpandedTables(prev => ({ ...prev, [tableName]: true }));

            setTimeout(() => {
                setImporting(false);
                setImportProgress(0);
            }, 500);
        } catch (err) {
            setError('Import failed: ' + err.message);
            setImporting(false);
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Generate SQL from natural language
    const generateSQL = async () => {
        if (!nlQuery.trim() || !apiKey) {
            if (!apiKey) setShowSettings(true);
            return;
        }

        setQueryLoading(true);

        const schemaDesc = Object.entries(schema)
            .map(([table, cols]) => `Table "${table}": ${cols.map(c => `${c.name} (${c.type})`).join(', ')}`)
            .join('\n');

        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'system', content: `You are a SQL expert specializing in DuckDB. Generate ONLY DuckDB compatible SQL queries. 
Do not use features from other dialects if they are not supported by DuckDB.
Only output the raw SQL query, nothing else. No markdown, no explanation, no backticks.

Current Database Schema:
${schemaDesc}`
                        },
                        { role: 'user', content: nlQuery }
                    ],
                    temperature: 0
                })
            });

            if (!res.ok) throw new Error(`API error: ${res.status}`);

            const data = await res.json();
            const sql = data.choices[0].message.content.trim().replace(/```sql\n?|\n?```/g, '');
            setSqlQuery(sql);
            setError(null);
        } catch (err: any) {
            setError('Failed to generate SQL: ' + err.message);
        }

        setQueryLoading(false);
    };

    // Fix SQL from natural language and error
    const fixSQL = async () => {
        if (!sqlQuery.trim() || !apiKey || !error) return;

        setQueryLoading(true);
        const currentError = error;

        const schemaDesc = Object.entries(schema)
            .map(([table, cols]) => `Table "${table}": ${cols.map(c => `${c.name} (${c.type})`).join(', ')}`)
            .join('\n');

        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: 'system',
                            content: `You are a DuckDB expert. A user tried to run a SQL query but it failed with an error. 
Your task is to FIX the SQL query based on the provided error message and the database schema.
Only output the corrected raw SQL query, nothing else. No markdown, no explanation, no backticks.`
                        },
                        {
                            role: 'user',
                            content: `Database Schema:\n${schemaDesc}\n\nOriginal Natural Language Intent: ${nlQuery}\n\nFailing SQL Query:\n${sqlQuery}\n\nDuckDB Error Message:\n${currentError}`
                        }
                    ],
                    temperature: 0
                })
            });

            if (!res.ok) throw new Error(`API error: ${res.status}`);

            const data = await res.json();
            const sql = data.choices[0].message.content.trim().replace(/```sql\n?|\n?```/g, '');
            setSqlQuery(sql);
            setError(null);
        } catch (err) {
            setError('Failed to fix SQL: ' + err.message);
        }

        setQueryLoading(false);
    };

    // Execute SQL
    const executeSQL = async () => {
        if (!sqlQuery.trim() || !conn) return;

        setQueryLoading(true);
        setError(null);

        try {
            const result = await conn.query(sqlQuery);
            const cols = result.schema.fields.map(f => f.name);
            const rows = result.toArray().map(r => {
                const obj = {};
                cols.forEach(c => { obj[c] = r[c]; });
                return obj;
            });

            setColumns(cols);
            setResults(rows);
            setHistory(prev => [{ nl: nlQuery, sql: sqlQuery, time: new Date() }, ...prev.slice(0, 49)]);
            await refreshSchema();
        } catch (err: any) {
            setError(err.message);
            setResults(null);
        }

        setQueryLoading(false);
    };

    // Export results
    const exportCSV = () => {
        if (!results || !columns.length) return;
        const csv = [columns.join(','), ...results.map(r => columns.map(c => {
            const val = r[c];
            if (val === null || val === undefined) return '';
            const str = String(val);
            return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
        }).join(','))].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'results.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading) {
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
                    <span>🦆</span> DuckQuery
                </h1>
                <div className="flex gap-2">
                    <button onClick={() => setShowSettings(true)} className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded transition">
                        ⚙️ OpenAI Settings
                    </button>
                    <label className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded cursor-pointer transition">
                        📁 Import CSV
                        <input type="file" accept=".csv" onChange={handleFileImport} className="hidden" ref={fileInputRef} />
                    </label>
                </div>
            </header>

            {/* Import progress */}
            {importing && (
                <div className="px-4 py-2 bg-gray-800 border-b border-gray-700">
                    <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400">Importing...</span>
                        <div className="flex-1 h-2 bg-gray-700 rounded overflow-hidden">
                            <div className="h-full bg-blue-500 transition-all" style={{ width: `${importProgress}%` }} />
                        </div>
                        <span className="text-sm text-gray-400">{importProgress}%</span>
                    </div>
                </div>
            )}

            {/* Main content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <aside className="w-56 border-r border-gray-700 flex flex-col bg-gray-850 overflow-hidden">
                    {/* Schema */}
                    <div className="flex-1 overflow-auto p-3">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Schema</h2>
                        {tables.length === 0 ? (
                            <p className="text-sm text-gray-500">No tables yet</p>
                        ) : (
                            <ul className="space-y-1">
                                {tables.map(table => (
                                    <li key={table}>
                                        <button
                                            onClick={() => setExpandedTables(p => ({ ...p, [table]: !p[table] }))}
                                            className="w-full text-left text-sm py-1 px-2 hover:bg-gray-700 rounded flex items-center gap-1"
                                        >
                                            <span className="text-gray-500">{expandedTables[table] ? '▼' : '▶'}</span>
                                            <span className="text-blue-400">{table}</span>
                                        </button>
                                        {expandedTables[table] && schema[table] && (
                                            <ul className="ml-5 mt-1 space-y-0.5">
                                                {schema[table].map(col => (
                                                    <li key={col.name} className="text-xs text-gray-400 flex justify-between">
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

                    {/* History */}
                    <div className="border-t border-gray-700 p-3 max-h-64 overflow-auto">
                        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">History</h2>
                        {history.length === 0 ? (
                            <p className="text-sm text-gray-500">No queries yet</p>
                        ) : (
                            <ul className="space-y-1">
                                {history.map((h, i) => (
                                    <li key={i}>
                                        <button
                                            onClick={() => { setNlQuery(h.nl); setSqlQuery(h.sql); }}
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

                {/* Main area */}
                <main className="flex-1 flex flex-col overflow-hidden p-4 gap-3">
                    {/* Error */}
                    {error && (
                        <div className="px-3 py-2 bg-red-900/50 border border-red-700 rounded text-sm text-red-200 flex items-center justify-between gap-4">
                            <div className="flex-1 flex items-start gap-2">
                                <span className="mt-0.5">❌</span>
                                <span className="break-all">{error}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={fixSQL}
                                    disabled={queryLoading || !apiKey}
                                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-xs transition flex items-center gap-1.5"
                                >
                                    {queryLoading ? '...' : '✨ Fix with AI'}
                                </button>
                                <button onClick={() => setError(null)} className="p-1 hover:bg-red-800 rounded transition">
                                    ✕
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Natural language input */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={nlQuery}
                            onChange={e => setNlQuery(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && generateSQL()}
                            placeholder="Ask a question about your data..."
                            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500 text-sm"
                        />
                        <button
                            onClick={generateSQL}
                            disabled={queryLoading || !tables.length}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition"
                        >
                            Generate SQL
                        </button>
                    </div>

                    {/* SQL editor */}
                    <div className="flex gap-2">
                        <textarea
                            value={sqlQuery}
                            onChange={e => setSqlQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) executeSQL(); }}
                            placeholder="SQL query will appear here (editable)..."
                            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded focus:outline-none focus:border-blue-500 text-sm font-mono resize-none h-24"
                        />
                        <button
                            onClick={executeSQL}
                            disabled={queryLoading || !sqlQuery.trim()}
                            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm transition self-end"
                        >
                            {queryLoading ? '...' : 'Run ▶'}
                        </button>
                    </div>

                    {/* Results */}
                    <div className="flex-1 overflow-auto border border-gray-700 rounded bg-gray-800">
                        {results === null ? (
                            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                                {tables.length === 0 ? 'Import a CSV to get started' : 'Run a query to see results'}
                            </div>
                        ) : results.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                                Query returned no results
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-gray-750 sticky top-0">
                                    <tr>
                                        {columns.map(col => (
                                            <th key={col} className="px-3 py-2 text-left font-medium text-gray-300 border-b border-gray-700">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {results.slice(0, 1000).map((row, i) => (
                                        <tr key={i} className="hover:bg-gray-750">
                                            {columns.map(col => (
                                                <td key={col} className="px-3 py-1.5 border-b border-gray-700/50 text-gray-300">
                                                    {row[col] === null ? <span className="text-gray-600">NULL</span> : String(row[col])}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Results footer */}
                    {results && results.length > 0 && (
                        <div className="flex justify-between items-center text-sm text-gray-500">
                            <span>{results.length} row{results.length !== 1 ? 's' : ''}{results.length > 1000 ? ' (showing first 1000)' : ''}</span>
                            <button onClick={exportCSV} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition">
                                Export CSV ↓
                            </button>
                        </div>
                    )}
                </main>
            </div>

            {/* Settings modal */}
            {showSettings && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
                    <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
                        <h2 className="text-lg font-semibold mb-4">OpenAI Settings</h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">API URL</label>
                                <input
                                    type="text"
                                    value={apiUrl}
                                    onChange={e => setApiUrl(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">API Key</label>
                                <input
                                    type="password"
                                    value={apiKey}
                                    onChange={e => setApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-gray-400 mb-1">Model</label>
                                <input
                                    type="text"
                                    value={model}
                                    onChange={e => setModel(e.target.value)}
                                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-blue-500"
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 mt-6">
                            <button onClick={() => setShowSettings(false)} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}