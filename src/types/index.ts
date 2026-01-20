/**
 * Core type definitions for DuckQuery chat application.
 * Provides strong typing for messages, queries, and UI state.
 */

/** Message types in chat flow */
export type MessageType = 'user' | 'assistant' | 'error';

/** Query result from DuckDB execution */
export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** Single chat message in conversation */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  sql?: string;
  sqlExecuted?: boolean;
  results?: QueryResult;
  insight?: string;
  error?: string;
  isGenerating?: boolean;
}

/** Application error with user-friendly message */
export interface AppError {
  code: ErrorCode;
  message: string;
  technical?: string;
  recoverable: boolean;
}

/** Known error codes for categorization */
export type ErrorCode =
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'BAD_REQUEST'
  | 'API_ERROR'
  | 'SQL_ERROR'
  | 'NETWORK'
  | 'UNKNOWN';

/** Table column metadata */
export interface ColumnInfo {
  name: string;
  type: string;
}

/** Table statistics from SUMMARIZE */
export interface ColumnStats {
  column: string;
  type: string;
  min: unknown;
  max: unknown;
  approx_unique: number;
  count: number;
}

/** Complete table schema with samples and stats */
export interface TableSchema {
  columns: ColumnInfo[];
  samples: Record<string, unknown>[];
  stats: ColumnStats[];
}

/** Schema for all tables in database */
export type DatabaseSchema = Record<string, TableSchema>;

/** Query history entry */
export interface HistoryEntry {
  nl: string;
  sql: string;
  time: Date;
}

/** Custom prompts for AI operations */
export interface CustomPrompts {
  generateSql?: string;
  interpretResults?: string;
  discoverData?: string;
}

/** OpenAI API configuration */
export interface AIConfig {
  apiKey: string;
  apiUrl: string;
  model: string;
  customPrompts?: CustomPrompts;
}

/** Distinct value entry for categorical columns */
export interface DistinctValueEntry {
  value: string;
  count: number;
}

/** Props for chat components */
export interface ChatInputProps {
  onSubmit: (query: string) => void;
  suggestions: string[];
  disabled?: boolean;
  loading?: boolean;
}

export interface QueryMessageProps {
  message: ChatMessage;
  onExpandResults?: (messageId: string) => void;
  onEditSql?: (sql: string) => void;
}

export interface CompactResultsProps {
  results: QueryResult;
  onExpand: () => void;
  maxRows?: number;
}

export interface ExpandedResultsProps {
  results: QueryResult;
  onClose: () => void;
  onExport?: () => void;
}

export interface SqlBlockProps {
  sql: string;
  onCopy?: () => void;
  onEdit?: (sql: string) => void;
  collapsed?: boolean;
}
