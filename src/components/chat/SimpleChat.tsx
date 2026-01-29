/**
 * Simple custom chat interface for SQL generation.
 * Sends user questions + schema to LLM, executes queries, displays results.
 * Receives schema and executeQuery from parent (App) to ensure single source of truth.
 */

import { useState, useRef, useEffect } from 'react';
import { useAI } from '../../hooks/useAI';
import { SqlBlock } from './SqlBlock';
import { CompactResults } from './CompactResults';
import { ExpandedResults } from './ExpandedResults';
import { ChatMessage, QueryResult, DatabaseSchema } from '../../types';
import { Send, AlertCircle } from 'lucide-react';

interface SimpleChatProps {
  schema: DatabaseSchema;
  schemaLoading: boolean;
  executeQuery: (sql: string) => Promise<QueryResult>;
  /** Pre-built messages injected by the tutorial demo */
  demoMessages?: ChatMessage[];
}

export const SimpleChat = ({ schema, schemaLoading, executeQuery, demoMessages }: SimpleChatProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedResults, setExpandedResults] = useState<QueryResult | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { generateSql, interpretResults } = useAI();

  // Use ref to always get latest schema (avoids stale closure issues)
  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  // Inject demo messages from tutorial
  useEffect(() => {
    if (demoMessages && demoMessages.length > 0) {
      setMessages(demoMessages);
    }
  }, [demoMessages]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle running SQL from preview
  const handleRunSql = async (messageId: string, sql: string) => {
    try {
      // Update message to show it's executing
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? { ...msg, content: 'Executing query...', isGenerating: true }
          : msg
      ));

      // Execute the SQL
      const results = await executeQuery(sql);

      // Get user's original question from the previous message
      const msgIndex = messages.findIndex(m => m.id === messageId);
      const userQuestion = msgIndex > 0 ? messages[msgIndex - 1].content : 'query';

      // Get AI insight
      const insight = await interpretResults(userQuestion, results);

      // Update message with results
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
              ...msg,
              content: `Found ${results.rowCount} result${results.rowCount !== 1 ? 's' : ''}`,
              sql,
              sqlExecuted: true,
              results,
              insight,
              isGenerating: false
            }
          : msg
      ));
    } catch (error: unknown) {
      // Update message with error
      setMessages(prev => prev.map(msg =>
        msg.id === messageId
          ? {
              ...msg,
              content: 'Query failed',
              error: error instanceof Error ? error.message : 'Unknown error',
              isGenerating: false
            }
          : msg
      ));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || schemaLoading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Build conversation history (last 10 messages for context)
      // Include SQL queries and results to give AI full context
      const history = messages.slice(-10).map(msg => {
        if (msg.role === 'assistant' && msg.sql) {
          return {
            role: msg.role,
            content: `Generated SQL: ${msg.sql}\nResult: ${msg.content}${msg.error ? `\nError: ${msg.error}` : ''}`
          };
        }
        return {
          role: msg.role,
          content: msg.content
        };
      });

      // Generate SQL from user question with conversation context
      // Use schemaRef.current to always get latest schema (avoids stale closure)
      const currentSchema = schemaRef.current;
      const sqlQuery = await generateSql(input, currentSchema, history);

      // Check if it's conversational or clarification (not SQL)
      if (!sqlQuery || sqlQuery.startsWith('CLARIFY:') || sqlQuery.startsWith('CHAT:')) {
        let content = sqlQuery || "I understand. How can I help you with your data?";

        // Remove prefixes for display
        if (content.startsWith('CLARIFY:')) {
          content = content.substring('CLARIFY:'.length).trim();
        } else if (content.startsWith('CHAT:')) {
          content = content.substring('CHAT:'.length).trim();
        }

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content,
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }

      // Show SQL but DON'T execute it yet - user will click Run button
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Generated SQL query. Click "Run" to execute it.',
        timestamp: Date.now(),
        sql: sqlQuery,
        sqlExecuted: false
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: unknown) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Query failed',
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[80%] bg-purple-700 text-gray-100 rounded-lg px-4 py-2">
                {msg.content}
              </div>
            ) : (
              <div className="max-w-[90%] space-y-3">
                <div className="text-gray-300 text-sm">{msg.content}</div>

                {msg.sql && (
                  <SqlBlock
                    sql={msg.sql}
                    onRun={(sql) => handleRunSql(msg.id, sql)}
                    editable={!msg.sqlExecuted}
                    executed={msg.sqlExecuted}
                  />
                )}

                {msg.error && (
                  <div className="px-3 py-2 bg-red-900/30 border border-red-700/50 rounded flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-red-300">{msg.error}</span>
                  </div>
                )}

                {msg.results && msg.results.rows.length > 0 && (
                  <CompactResults
                    results={msg.results}
                    onExpand={() => setExpandedResults(msg.results!)}
                  />
                )}

                {msg.insight && (
                  <div className="px-3 py-2 bg-blue-900/20 border border-blue-500/30 rounded">
                    <p className="text-sm text-blue-100 italic">{msg.insight}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="text-gray-400 text-sm">Generating SQL...</div>
          </div>
        )}

        {/* Scroll target */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input - sticky at bottom */}
      <form onSubmit={handleSubmit} className="sticky bottom-0 p-4 border-t border-gray-700 bg-gray-900">
        {/* Warning when no schema loaded */}
        {Object.keys(schema).length === 0 && !schemaLoading && (
          <div className="mb-3 px-3 py-2 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
            <p className="text-yellow-400 text-sm">
              ⚠️ No tables loaded. Import a CSV or load sample data to enable SQL queries.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your data..."
            disabled={isLoading || schemaLoading}
            className="flex-1 bg-gray-800 text-gray-100 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim() || schemaLoading}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 flex items-center gap-2 transition-colors"
          >
            {schemaLoading ? (
              <span className="text-sm">Loading schema...</span>
            ) : isLoading ? (
              <span className="text-sm">Thinking...</span>
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </form>

      {/* Expanded Results Modal */}
      {expandedResults && (
        <ExpandedResults
          results={expandedResults}
          onClose={() => setExpandedResults(null)}
        />
      )}
    </div>
  );
};
