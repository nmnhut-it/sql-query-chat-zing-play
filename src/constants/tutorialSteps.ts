/**
 * Tutorial step definitions for the interactive spotlight walkthrough.
 * Each step targets a UI element via data-tutorial-step attribute.
 */

/** Tooltip placement relative to the highlighted element */
export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

/** Tab that must be active for a step to display */
export type RequiredTab = 'chat' | 'editor';

/** Unique identifiers for each tutorial step */
export enum TutorialStepId {
  WELCOME = 'welcome',
  IMPORT_DATA = 'import-data',
  SCHEMA = 'schema',
  CHAT_AREA = 'chat-area',
  SQL_EDITOR_TAB = 'sql-editor-tab',
  SQL_EDITOR_CONTENT = 'sql-editor-content',
  SETTINGS = 'settings',
  HISTORY = 'history',
  DONE = 'done',
}

/** Configuration for a single tutorial step */
export interface TutorialStep {
  readonly id: TutorialStepId;
  /** Override which element to highlight (defaults to own id) */
  readonly targetId?: TutorialStepId;
  readonly title: string;
  readonly description: string;
  readonly tooltipPosition: TooltipPosition;
  /** Tab that must be active before showing this step */
  readonly requiredTab?: RequiredTab;
}

/** Data attribute name used to mark tutorial target elements */
export const TUTORIAL_TARGET_ATTR = 'data-tutorial-step';

/** Builds a CSS selector for a tutorial step target element */
export const getTutorialSelector = (step: TutorialStep): string =>
  `[${TUTORIAL_TARGET_ATTR}="${step.targetId ?? step.id}"]`;

/** All tutorial steps in display order */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: TutorialStepId.WELCOME,
    title: 'Welcome to DuckQuery!',
    description: 'An AI-powered SQL assistant that runs entirely in your browser. Let\u2019s walk through the key features.',
    tooltipPosition: 'bottom',
  },
  {
    id: TutorialStepId.IMPORT_DATA,
    title: 'Import Your Data',
    description: 'Load a CSV file or try the sample dataset to get started. Your data stays in the browser \u2014 nothing is uploaded.',
    tooltipPosition: 'bottom',
  },
  {
    id: TutorialStepId.SCHEMA,
    title: 'Schema Browser',
    description: 'View your tables and columns here. Click a table name to expand its columns and data types.',
    tooltipPosition: 'right',
  },
  {
    id: TutorialStepId.CHAT_AREA,
    title: 'Chat with Your Data',
    description: 'Ask questions in plain English. The AI generates SQL for you to review before running.',
    tooltipPosition: 'left',
    requiredTab: 'chat',
  },
  {
    id: TutorialStepId.SQL_EDITOR_TAB,
    title: 'SQL Editor',
    description: 'Switch to the SQL Editor for direct query writing with syntax highlighting and autocomplete.',
    tooltipPosition: 'bottom',
  },
  {
    id: TutorialStepId.SQL_EDITOR_CONTENT,
    title: 'Write & Run SQL',
    description: 'Press Ctrl+Enter to run a query, or Ctrl+Shift+Enter to convert a TODO comment into SQL using AI.',
    tooltipPosition: 'bottom',
    requiredTab: 'editor',
  },
  {
    id: TutorialStepId.SETTINGS,
    title: 'API Settings',
    description: 'Configure your OpenAI API key here to enable AI-powered features like natural language queries.',
    tooltipPosition: 'bottom',
  },
  {
    id: TutorialStepId.HISTORY,
    title: 'Query History',
    description: 'Your recent queries appear here for quick reference and reuse.',
    tooltipPosition: 'right',
  },
  {
    id: TutorialStepId.DONE,
    targetId: TutorialStepId.WELCOME,
    title: 'You\u2019re All Set!',
    description: 'Start by importing data or loading the sample dataset, then ask away. Happy querying!',
    tooltipPosition: 'bottom',
  },
] as const;
