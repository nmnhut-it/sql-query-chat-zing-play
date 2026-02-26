/**
 * Parses local LLM responses that may contain embedded tool call tags.
 * Local models (e.g. Qwen) sometimes emit tool calls as inline XML tags
 * instead of the OpenAI tool_calls format. This parses those tags into
 * structured tool calls — mirroring the server-side llm-proxy.js logic.
 */

/** Known cloud API host patterns that don't need local parsing */
const CLOUD_API_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'api.mistral.ai',
  'api.together.xyz',
  'api.deepseek.com',
];

/** A parsed tool call extracted from inline tags */
export interface ParsedToolCall {
  name: string;
  args: Record<string, string>;
}

/** Result of parsing local LLM content */
export interface ParsedLlmResponse {
  /** Content with tool call tags removed */
  text: string;
  /** Structured tool calls extracted from tags */
  toolCalls: ParsedToolCall[];
}

/** Matches a full <function=NAME>...</function> block (non-greedy) */
const FUNCTION_BLOCK_PATTERN = /<function=([\w.-]+)>([\s\S]*?)<\/function>/gi;

/** Matches <parameter=KEY>VALUE</parameter> within a function block */
const PARAMETER_PATTERN = /<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/gi;

/** Matches orphaned <tool_call> / </tool_call> wrappers */
const TOOL_CALL_WRAPPER_PATTERN = /<\/?tool_call>/gi;

/** Check if a URL points to a known cloud API (no local parsing needed) */
export function isCloudApiUrl(apiUrl: string): boolean {
  try {
    const host = new URL(apiUrl).hostname;
    return CLOUD_API_HOSTS.some(cloudHost => host.endsWith(cloudHost));
  } catch {
    return false;
  }
}

/**
 * Parses Qwen-style tool call tags from LLM response content.
 * Format: <function=NAME><parameter=KEY>VALUE</parameter></function>
 * Returns structured tool calls + clean text (tags removed).
 */
export function parseLocalLlmContent(content: string): ParsedLlmResponse {
  if (!content) {
    return { text: '', toolCalls: [] };
  }

  const toolCalls: ParsedToolCall[] = [];

  // Extract each <function=NAME>...</function> block
  let match: RegExpExecArray | null;
  while ((match = FUNCTION_BLOCK_PATTERN.exec(content)) !== null) {
    const funcName = match[1];
    const funcBody = match[2];
    const args: Record<string, string> = {};

    // Extract <parameter=KEY>VALUE</parameter> pairs within this function
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = PARAMETER_PATTERN.exec(funcBody)) !== null) {
      args[paramMatch[1]] = paramMatch[2].trim();
    }

    toolCalls.push({ name: funcName, args });
  }

  // Reset lastIndex after global regex usage
  FUNCTION_BLOCK_PATTERN.lastIndex = 0;
  PARAMETER_PATTERN.lastIndex = 0;

  // Remove tool call tags and wrappers from the text
  const text = content
    .replace(FUNCTION_BLOCK_PATTERN, '')
    .replace(TOOL_CALL_WRAPPER_PATTERN, '')
    .trim();

  // Reset again after cleanup
  FUNCTION_BLOCK_PATTERN.lastIndex = 0;

  return { text, toolCalls };
}

/**
 * Extracts usable content from parsed tool calls.
 * Checks common argument names where models put their actual response.
 * Returns the first non-empty value found, or null.
 */
/** OpenAI-format tool call from API response (model hallucinated tool usage) */
interface ApiToolCall {
  function?: {
    name?: string;
    arguments?: string;
  };
}

/**
 * Extracts content from OpenAI-format tool_calls on the message object.
 * Local models sometimes hallucinate tool calls even when none were provided.
 * Parses each tool call's JSON arguments and extracts usable content.
 */
export function extractContentFromApiToolCalls(apiToolCalls: ApiToolCall[]): string | null {
  if (!apiToolCalls?.length) return null;

  for (const tc of apiToolCalls) {
    const argsStr = tc.function?.arguments;
    if (!argsStr) continue;

    try {
      const args = JSON.parse(argsStr) as Record<string, unknown>;
      // Convert to ParsedToolCall format and reuse extraction logic
      const stringArgs: Record<string, string> = {};
      for (const [k, v] of Object.entries(args)) {
        if (typeof v === 'string') stringArgs[k] = v;
      }
      const result = extractContentFromToolCalls([{ name: tc.function?.name ?? '', args: stringArgs }]);
      if (result) return result;
    } catch {
      // If args aren't valid JSON, use the raw string
      if (argsStr.trim()) return argsStr.trim();
    }
  }
  return null;
}

const CONTENT_ARG_NAMES = ['content', 'response', 'sql', 'query', 'result', 'text', 'answer'];

export function extractContentFromToolCalls(toolCalls: ParsedToolCall[]): string | null {
  for (const call of toolCalls) {
    // Check known content argument names
    for (const key of CONTENT_ARG_NAMES) {
      if (call.args[key]?.trim()) {
        return call.args[key].trim();
      }
    }
    // Fallback: if there's exactly one argument, use its value
    const values = Object.values(call.args).filter(v => v.trim());
    if (values.length === 1) {
      return values[0].trim();
    }
  }
  return null;
}
