/**
 * Simple custom chat interface for SQL generation.
 * Sends user questions + schema to LLM, executes queries, displays results.
 */

import { useState } from 'react';
import { useDuckDB } from '../../hooks/useDuckDB';
import { useAI } from '../../hooks/useAI';
import { SqlBlock } from './SqlBlock';
import { CompactResults } from './CompactResults';
import { ExpandedResults } from './ExpandedResults';
import { ChatMessage, QueryResult } from '../../types';
import { Send, AlertCircle } from 'lucide-react';

export const SimpleChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedResults, setExpandedResults] = useState<QueryResult | null>(null);

  const { schema, executeQuery } = useDuckDB();
  const { generateSql, interpretResults } = useAI();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

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
      // Generate SQL from user question
      const sqlQuery = await generateSql(input, schema);

      // Check if it's conversational (no SQL generated)
      if (!sqlQuery || sqlQuery.startsWith('CLARIFY:')) {
        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: sqlQuery || "I understand. How can I help you with your data?",
          timestamp: Date.now()
        };
        setMessages(prev => [...prev, assistantMessage]);
        setIsLoading(false);
        return;
      }

      // Execute the SQL
      const results = await executeQuery(sqlQuery);

      // Get AI insight
      const insight = await interpretResults(input, results);

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Found ${results.rowCount} result${results.rowCount !== 1 ? 's' : ''}`,
        timestamp: Date.now(),
        sql: sqlQuery,
        results,
        insight
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

                {msg.sql && <SqlBlock sql={msg.sql} />}

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
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your data..."
            disabled={isLoading}
            className="flex-1 bg-gray-800 text-gray-100 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 flex items-center gap-2 transition-colors"
          >
            <Send className="w-4 h-4" />
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
