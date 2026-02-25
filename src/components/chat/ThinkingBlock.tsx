/**
 * Collapsible block showing AI's thinking/planning process.
 * Displays the reasoning steps the AI went through before generating SQL.
 */

import { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

interface ThinkingBlockProps {
  thinking: string;
  defaultExpanded?: boolean;
}

export const ThinkingBlock = ({ thinking, defaultExpanded = false }: ThinkingBlockProps) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded bg-purple-900/20 border border-purple-500/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-purple-300 hover:bg-purple-900/30 transition"
      >
        <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
        <span className="font-medium">Thinking & Planning</span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 ml-auto text-purple-500" />
        ) : (
          <ChevronRight className="w-3 h-3 ml-auto text-purple-500" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 border-t border-purple-500/10">
          <p className="text-xs text-purple-200/70 whitespace-pre-wrap leading-relaxed pt-2">
            {thinking}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Animated thinking indicator shown while AI is processing.
 */
export const ThinkingIndicator = () => (
  <div className="flex items-center gap-2 px-3 py-2 rounded bg-purple-900/20 border border-purple-500/20">
    <Brain className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
    <span className="text-xs text-purple-300">Analyzing your question...</span>
    <div className="flex gap-1 ml-1">
      <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  </div>
);

export default ThinkingBlock;
