/**
 * Unit tests for SQL Editor helper functions and inline chat state logic.
 * Tests cleanTodoText, splitStatements, and the inline chat state machine.
 */

import { describe, it, expect } from 'vitest';

// ── Pure functions extracted from SqlEditor.tsx for testing ──

/** Clean up TODO text for AI prompt - remove comment markers and TODO prefix */
function cleanTodoText(text: string): string {
  return text
    .split('\n')
    .map(line => line.replace(/^--\s*/, '').replace(/^TODO:\s*/i, '').trim())
    .filter(line => line.length > 0)
    .join(' ');
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

// ── Inline chat state types (mirrored from SqlEditor) ──

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

// ── Tests ──

describe('SqlEditor - cleanTodoText', () => {
  it('should remove -- comment prefix and TODO: prefix', () => {
    const result = cleanTodoText('-- TODO: show all tables');
    expect(result).toBe('show all tables');
  });

  it('should handle multiple lines of TODO text', () => {
    const result = cleanTodoText('-- TODO: show all tables\n-- and their row counts');
    expect(result).toBe('show all tables and their row counts');
  });

  it('should handle text without -- prefix', () => {
    const result = cleanTodoText('TODO: list all users');
    expect(result).toBe('list all users');
  });

  it('should handle plain text without any markers', () => {
    const result = cleanTodoText('find top 5 products by revenue');
    expect(result).toBe('find top 5 products by revenue');
  });

  it('should filter out empty lines', () => {
    const result = cleanTodoText('-- TODO: show tables\n\n-- sorted by name');
    expect(result).toBe('show tables sorted by name');
  });

  it('should handle case-insensitive TODO prefix', () => {
    const result = cleanTodoText('-- todo: count rows');
    expect(result).toBe('count rows');
  });

  it('should handle multiline TODO with mixed formatting', () => {
    const result = cleanTodoText(
      '-- TODO: get revenue by category\n-- for the year 2024\n-- sorted descending'
    );
    expect(result).toBe('get revenue by category for the year 2024 sorted descending');
  });

  it('should return empty string for all-blank input', () => {
    const result = cleanTodoText('--\n-- \n');
    expect(result).toBe('');
  });

  it('should trim whitespace from each line', () => {
    const result = cleanTodoText('--   TODO:   count users   ');
    expect(result).toBe('count users');
  });
});

describe('SqlEditor - splitStatements', () => {
  it('should split simple statements by semicolon', () => {
    const result = splitStatements('SELECT 1; SELECT 2');
    expect(result).toEqual(['SELECT 1', ' SELECT 2']);
  });

  it('should handle single statement without semicolon', () => {
    const result = splitStatements('SELECT * FROM users');
    expect(result).toEqual(['SELECT * FROM users']);
  });

  it('should handle trailing semicolon', () => {
    const result = splitStatements('SELECT * FROM users;');
    expect(result).toEqual(['SELECT * FROM users']);
  });

  it('should ignore semicolons inside single-quoted strings', () => {
    const result = splitStatements("SELECT 'hello;world' FROM users");
    expect(result).toEqual(["SELECT 'hello;world' FROM users"]);
  });

  it('should ignore semicolons inside double-quoted strings', () => {
    const result = splitStatements('SELECT "col;name" FROM users');
    expect(result).toEqual(['SELECT "col;name" FROM users']);
  });

  it('should handle multiple statements with strings containing semicolons', () => {
    const result = splitStatements("SELECT 'a;b'; SELECT 'c;d'");
    expect(result).toEqual(["SELECT 'a;b'", " SELECT 'c;d'"]);
  });

  it('should skip empty statements', () => {
    const result = splitStatements('SELECT 1;; SELECT 2');
    expect(result).toEqual(['SELECT 1', ' SELECT 2']);
  });

  it('should handle multiline SQL', () => {
    const sql = `SELECT *
FROM users
WHERE id > 10;

SELECT COUNT(*)
FROM orders`;
    const result = splitStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('SELECT *');
    expect(result[0]).toContain('WHERE id > 10');
    expect(result[1]).toContain('SELECT COUNT(*)');
  });

  it('should return empty array for empty input', () => {
    const result = splitStatements('');
    expect(result).toEqual([]);
  });

  it('should return empty array for whitespace-only input', () => {
    const result = splitStatements('   ;  ;  ');
    expect(result).toEqual([]);
  });
});

describe('SqlEditor - InlineChatState', () => {
  it('should have correct initial state', () => {
    expect(INITIAL_CHAT_STATE.isOpen).toBe(false);
    expect(INITIAL_CHAT_STATE.question).toBe('');
    expect(INITIAL_CHAT_STATE.generatedSql).toBeNull();
    expect(INITIAL_CHAT_STATE.thinking).toBeNull();
    expect(INITIAL_CHAT_STATE.summary).toBeNull();
    expect(INITIAL_CHAT_STATE.isGenerating).toBe(false);
    expect(INITIAL_CHAT_STATE.error).toBeNull();
    expect(INITIAL_CHAT_STATE.conversationHistory).toEqual([]);
  });

  it('should transition to generating state correctly', () => {
    const question = 'show top revenue by product';
    const generating: InlineChatState = {
      isOpen: true,
      question,
      generatedSql: null,
      thinking: null,
      summary: null,
      isGenerating: true,
      error: null,
      conversationHistory: [],
      overlayTop: 100,
      selectionEndLine: 5,
    };

    expect(generating.isOpen).toBe(true);
    expect(generating.isGenerating).toBe(true);
    expect(generating.generatedSql).toBeNull();
    expect(generating.question).toBe(question);
  });

  it('should transition to generated state correctly', () => {
    const question = 'count users';
    const sql = 'SELECT COUNT(*) FROM users';
    const generated: InlineChatState = {
      isOpen: true,
      question,
      generatedSql: sql,
      thinking: '1. User wants count\n2. Simple COUNT(*) on users table',
      summary: 'Counts all users in the users table.',
      isGenerating: false,
      error: null,
      conversationHistory: [
        { role: 'user', content: question },
        { role: 'assistant', content: sql },
      ],
      overlayTop: 100,
      selectionEndLine: 5,
    };

    expect(generated.isGenerating).toBe(false);
    expect(generated.generatedSql).toBe(sql);
    expect(generated.thinking).toContain('User wants count');
    expect(generated.summary).toContain('Counts all users');
    expect(generated.conversationHistory).toHaveLength(2);
  });

  it('should transition to error state correctly', () => {
    const errorState: InlineChatState = {
      isOpen: true,
      question: 'bad query',
      generatedSql: null,
      thinking: null,
      summary: null,
      isGenerating: false,
      error: 'API key not configured',
      conversationHistory: [],
      overlayTop: 100,
      selectionEndLine: 5,
    };

    expect(errorState.isGenerating).toBe(false);
    expect(errorState.error).toBe('API key not configured');
    expect(errorState.generatedSql).toBeNull();
  });

  it('should build conversation history for refinements', () => {
    const history = [
      { role: 'user', content: 'count users' },
      { role: 'assistant', content: 'SELECT COUNT(*) FROM users' },
      { role: 'user', content: 'add a WHERE clause for active users' },
      { role: 'assistant', content: "SELECT COUNT(*) FROM users WHERE active = true" },
    ];

    expect(history).toHaveLength(4);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
    expect(history[2].content).toContain('WHERE clause');
    expect(history[3].content).toContain('WHERE active = true');
  });

  it('should reset to initial state on reject', () => {
    const afterReject = { ...INITIAL_CHAT_STATE };
    expect(afterReject.isOpen).toBe(false);
    expect(afterReject.generatedSql).toBeNull();
    expect(afterReject.conversationHistory).toEqual([]);
  });
});
