/**
 * Hook for DuckDB database operations.
 * Handles initialization, queries, schema, and CSV import.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as duckdb from '@duckdb/duckdb-wasm';
import type { DatabaseSchema, QueryResult, ColumnStats, DistinctValueEntry } from '../types';
import { convertBigIntToNumber } from '../utils/serialization';
import { parseSqlError } from '../utils/errorHandler';

interface UseDuckDBReturn {
  db: duckdb.AsyncDuckDB | null;
  conn: duckdb.AsyncDuckDBConnection | null;
  loading: boolean;
  schemaLoading: boolean;
  error: string | null;
  tables: string[];
  schema: DatabaseSchema;
  executeQuery: (sql: string) => Promise<QueryResult>;
  refreshSchema: () => Promise<void>;
  importCsv: (file: File, onProgress?: (pct: number) => void) => Promise<string>;
  loadSampleData: () => Promise<void>;
  getDistinctValues: (table: string, column: string, limit?: number) => Promise<DistinctValueEntry[]>;
}

export const useDuckDB = (): UseDuckDBReturn => {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [schema, setSchema] = useState<DatabaseSchema>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize DuckDB on mount
  useEffect(() => {
    const initDuckDB = async () => {
      try {
        const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
        const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
        const workerUrl = URL.createObjectURL(
          new Blob([`importScripts("${bundle.mainWorker}");`], {
            type: 'text/javascript',
          })
        );
        const worker = new Worker(workerUrl);
        const logger = new duckdb.ConsoleLogger();
        const database = new duckdb.AsyncDuckDB(logger, worker);
        await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
        URL.revokeObjectURL(workerUrl);

        const connection = await database.connect();
        setDb(database);
        setConn(connection);
        setLoading(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to initialize DuckDB: ${message}`);
        setLoading(false);
      }
    };

    initDuckDB();
  }, []);

  /** Refresh schema for all tables */
  const refreshSchema = useCallback(async () => {
    if (!conn) return;

    setSchemaLoading(true);
    try {
      const tableResult = await conn.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`
      );
      const tableNames = tableResult
        .toArray()
        .map((r: Record<string, unknown>) => String(r.table_name));
      setTables(tableNames);

      const schemaObj: DatabaseSchema = {};
      for (const table of tableNames) {
        // Get columns
        const colResult = await conn.query(`DESCRIBE "${table}"`);
        const cols = colResult.toArray().map((r: Record<string, unknown>) => ({
          name: String(r.column_name),
          type: String(r.column_type),
        }));

        // Get samples
        const sampleResult = await conn.query(`SELECT * FROM "${table}" LIMIT 5`);
        const samples = sampleResult.toArray().map((r: Record<string, unknown>) => {
          const obj: Record<string, unknown> = {};
          sampleResult.schema.fields.forEach((f: { name: string }) => {
            obj[f.name] = convertBigIntToNumber(r[f.name]);
          });
          return obj;
        });

        // Get stats using SUMMARIZE
        const statsResult = await conn.query(`SUMMARIZE "${table}"`);
        const stats: ColumnStats[] = statsResult
          .toArray()
          .map((r: Record<string, unknown>) => ({
            column: String(r.column_name),
            type: String(r.column_type),
            min: convertBigIntToNumber(r.min),
            max: convertBigIntToNumber(r.max),
            approx_unique: Number(r.approx_unique),
            count: Number(r.count),
          }));

        schemaObj[table] = { columns: cols, samples, stats };
      }
      setSchema(schemaObj);

      // Small delay to ensure state update propagates to components
      // This prevents race condition where schemaLoading=false but schema state hasn't updated yet
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (err) {
      console.error('Schema refresh error:', err);
    } finally {
      setSchemaLoading(false);
    }
  }, [conn]);

  // Auto-populate schema when connection is established
  useEffect(() => {
    if (conn && !loading) {
      refreshSchema();
    }
  }, [conn, loading, refreshSchema]);

  /** Execute SQL query and return results */
  const executeQuery = useCallback(
    async (sql: string): Promise<QueryResult> => {
      if (!conn) {
        throw new Error('Database not initialized');
      }

      try {
        const result = await conn.query(sql);
        const cols = result.schema.fields.map((f: { name: string }) => f.name);
        const rows = result.toArray().map((r: Record<string, unknown>) => {
          const obj: Record<string, unknown> = {};
          cols.forEach((c) => {
            obj[c] = convertBigIntToNumber(r[c]);
          });
          return obj;
        });

        return {
          columns: cols,
          rows,
          rowCount: rows.length,
        };
      } catch (err) {
        const appError = parseSqlError(err instanceof Error ? err : String(err));
        throw new Error(appError.technical || appError.message);
      }
    },
    [conn]
  );

  /** Import CSV file into database */
  const importCsv = useCallback(
    async (file: File, onProgress?: (pct: number) => void): Promise<string> => {
      if (!db || !conn) {
        throw new Error('Database not initialized');
      }

      const tableName = file.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_]/g, '_');

      onProgress?.(10);

      // Register file with DuckDB
      await db.registerFileHandle(
        file.name,
        file,
        duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
        true
      );

      onProgress?.(50);

      // Create table from CSV
      await conn.query(
        `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${file.name}')`
      );

      onProgress?.(90);
      await refreshSchema();
      onProgress?.(100);

      return tableName;
    },
    [db, conn, refreshSchema]
  );

/** Limit for distinct value queries */
  const DEFAULT_DISTINCT_LIMIT = 10;

  /** Get distinct values with counts for a column */
  const getDistinctValues = useCallback(
    async (table: string, column: string, limit = DEFAULT_DISTINCT_LIMIT): Promise<DistinctValueEntry[]> => {
      if (!conn) {
        throw new Error('Database not initialized');
      }

      const result = await conn.query(`
        SELECT "${column}" as value, COUNT(*) as count
        FROM "${table}"
        WHERE "${column}" IS NOT NULL
        GROUP BY "${column}"
        ORDER BY count DESC
        LIMIT ${limit}
      `);

      return result.toArray().map((r: Record<string, unknown>) => ({
        value: String(r.value),
        count: Number(r.count),
      }));
    },
    [conn]
  );

  /** Load sample data for testing */
  const loadSampleData = useCallback(async () => {
    if (!conn) return;

    try {
      await conn.query(`
        CREATE OR REPLACE TABLE sales_data AS
        SELECT * FROM (VALUES
          ('2024-01-01', 'Electronics', 1200, 2, 'New York'),
          ('2024-01-02', 'Clothing', 450, 5, 'Los Angeles'),
          ('2024-01-02', 'Electronics', 800, 1, 'Chicago'),
          ('2024-01-03', 'Furniture', 2100, 3, 'New York'),
          ('2024-01-04', 'Electronics', 1500, 2, 'Los Angeles'),
          ('2024-01-05', 'Clothing', 300, 10, 'Chicago'),
          ('2024-01-05', 'Furniture', 950, 1, 'New York')
        ) AS t(date, category, revenue, quantity, city);
      `);
      await refreshSchema();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  }, [conn, refreshSchema]);

  return {
    db,
    conn,
    loading,
    schemaLoading,
    error,
    tables,
    schema,
    executeQuery,
    refreshSchema,
    importCsv,
    loadSampleData,
    getDistinctValues,
  };
};

export type { UseDuckDBReturn };
