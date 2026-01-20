/**
 * Error handling utilities for user-friendly error messages.
 * Parses API errors, SQL errors, and network issues.
 */

import type { AppError, ErrorCode } from '../types';

/** HTTP status code to error mapping */
const HTTP_ERROR_MAP: Record<number, { code: ErrorCode; message: string; recoverable: boolean }> = {
  400: { code: 'BAD_REQUEST', message: 'Request format error. Check your input.', recoverable: false },
  401: { code: 'AUTH', message: 'Invalid API key. Please check your settings.', recoverable: true },
  403: { code: 'AUTH', message: 'Access denied. Check your API key permissions.', recoverable: true },
  429: { code: 'RATE_LIMIT', message: 'Too many requests. Please wait and try again.', recoverable: true },
  500: { code: 'API_ERROR', message: 'Server error. The service may be temporarily unavailable.', recoverable: true },
  502: { code: 'API_ERROR', message: 'Service temporarily unavailable. Please try again.', recoverable: true },
  503: { code: 'API_ERROR', message: 'Service unavailable. Please try again later.', recoverable: true },
};

/**
 * Parse API HTTP status into user-friendly error.
 */
export const parseApiError = (status: number, technical?: string): AppError => {
  const mapped = HTTP_ERROR_MAP[status];
  if (mapped) {
    return { ...mapped, technical };
  }

  return {
    code: 'API_ERROR',
    message: 'An unexpected error occurred. Please try again.',
    technical,
    recoverable: true,
  };
};

/** Common SQL error patterns and friendly messages */
const SQL_ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /table.*does not exist/i, message: 'Table not found. Check the table name.' },
  { pattern: /column.*not found/i, message: 'Column not found. Check column names.' },
  { pattern: /syntax error/i, message: 'SQL syntax error. Check the query format.' },
  { pattern: /ambiguous.*column/i, message: 'Ambiguous column name. Specify the table.' },
  { pattern: /type mismatch/i, message: 'Data type mismatch. Check value types.' },
  { pattern: /division by zero/i, message: 'Division by zero error in calculation.' },
  { pattern: /conversion failed/i, message: 'Data conversion failed. Check data types.' },
];

/**
 * Parse DuckDB SQL error into user-friendly message.
 */
export const parseSqlError = (error: Error | string): AppError => {
  const errorMessage = typeof error === 'string' ? error : error.message;

  for (const { pattern, message } of SQL_ERROR_PATTERNS) {
    if (pattern.test(errorMessage)) {
      return {
        code: 'SQL_ERROR',
        message,
        technical: errorMessage,
        recoverable: true,
      };
    }
  }

  return {
    code: 'SQL_ERROR',
    message: 'Query execution failed. Try modifying your query.',
    technical: errorMessage,
    recoverable: true,
  };
};

/**
 * Parse network/fetch errors into user-friendly message.
 */
export const parseNetworkError = (error: Error): AppError => {
  const message = error.message.toLowerCase();

  if (message.includes('failed to fetch') || message.includes('network')) {
    return {
      code: 'NETWORK',
      message: 'Connection lost. Check your internet connection.',
      technical: error.message,
      recoverable: true,
    };
  }

  if (message.includes('timeout') || message.includes('timed out')) {
    return {
      code: 'NETWORK',
      message: 'Request timed out. Please try again.',
      technical: error.message,
      recoverable: true,
    };
  }

  return {
    code: 'UNKNOWN',
    message: 'An unexpected error occurred.',
    technical: error.message,
    recoverable: true,
  };
};

/**
 * General error parser - determines error type and returns friendly message.
 */
export const parseError = (error: unknown): AppError => {
  if (error instanceof Response) {
    return parseApiError(error.status);
  }

  if (error instanceof Error) {
    if (error.message.includes('fetch')) {
      return parseNetworkError(error);
    }
    return parseSqlError(error);
  }

  if (typeof error === 'string') {
    return parseSqlError(error);
  }

  return {
    code: 'UNKNOWN',
    message: 'An unexpected error occurred.',
    technical: String(error),
    recoverable: true,
  };
};

/**
 * Create error message for display with optional technical details.
 */
export const formatErrorForDisplay = (error: AppError, showTechnical = false): string => {
  if (showTechnical && error.technical) {
    return `${error.message}\n\nDetails: ${error.technical}`;
  }
  return error.message;
};
