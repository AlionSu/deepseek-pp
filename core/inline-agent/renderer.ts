import { renderInlineMarkdown } from './markdown';
import { summarizeInlineAgentToolParams } from './display-text';
import { injectInjectedThemeStyles } from '../ui/injected-theme';
import { INLINE_AGENT_MAX_STEPS } from './types';
import type { ToolExecutionRecord, ToolResult } from '../types';

const AGENT_STEP_STYLE_ID = 'dpp-inline-agent-css';

// ---------------------------------------------------------------------------
// Inline SVG icons (fill="currentColor" so each icon inherits the themed color
// of its container). Replaces the previous unicode glyphs (●⚙✓✗▼▸■) that
// rendered as emoji or jagged text on some platforms (Issue #544).
// ---------------------------------------------------------------------------
const svgDataUri = (body: string, viewBox = '0 0 24 24'): string =>
  `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor">${body}</svg>`,
  )}")`;
const ICON_CHECK = svgDataUri('<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>');
const ICON_CROSS = svgDataUri('<path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>');
const ICON_GEAR = svgDataUri('<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>');
const ICON_CHEVRON_DOWN = svgDataUri('<path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>');
const ICON_CHEVRON_RIGHT = svgDataUri('<path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>');

let agentDomSequence = 0;

function nextAgentDomId(prefix: string): string {
  agentDomSequence += 1;
  return `${prefix}-${agentDomSequence}`;
}

export interface InlineAgentRendererLabels {
  starting: string;
  stop: string;
  running: (stepNumber: number, toolCount: number, elapsedSeconds: number) => string;
  consoleComplete: (totalSteps: number, totalTools: number, elapsedSeconds: number) => string;
  consolePaused: (totalSteps: number, totalTools: number, elapsedSeconds: number) => string;
  consoleError: (totalSteps: number, totalTools: number, elapsedSeconds: number) => string;
  toolOk: string;
  toolError: string;
  /** Tool-group header, e.g. "Called 3 tools" (Codex-style work log). */
  toolGroup: (count: number) => string;
  /** Reasoning-step note header, e.g. "Thought · step 3" (folded by default). */
  reasoningStep: (stepNumber: number) => string;
  /** Explanation shown when a folded reasoning note is expanded. */
  reasoningNotPersisted: string;
}

// ---------------------------------------------------------------------------
// Per-stream bookkeeping. The stream is a time-ordered sequence of narration
// segments and tool groups; tool entries are appended to the CURRENT group
// and consecutive tool calls without narration between them stay in one
// group. A narration segment seals the current group (and collapses it unless
// the user toggled it), so groups only span textless steps.
// ---------------------------------------------------------------------------
interface AgentStreamState {
  currentToolGroup: HTMLElement | null;
  pendingRowsByStep: Map<number, HTMLElement[]>;
}
const agentStreamStates = new WeakMap<HTMLElement, AgentStreamState>();

function getAgentStreamState(stream: HTMLElement): AgentStreamState {
  let state = agentStreamStates.get(stream);
  if (!state) {
    state = { currentToolGroup: null, pendingRowsByStep: new Map() };
    agentStreamStates.set(stream, state);
  }
  return state;
}

export function injectInlineAgentStyles(): void {
  injectInjectedThemeStyles();
  if (document.getElementById(AGENT_STEP_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = AGENT_STEP_STYLE_ID;
  style.textContent = `
    /* The agent run renders as a lightweight work-log stream inside the
       assistant message (Issue #551 redesign): no card, no console shell,
       no answer-area split. A one-line status row, the narration body stream
       (never folded or truncated) and collapsed single-line tool entries. */
    .dpp-agent-container {
      position: relative;
      margin-top: 10px;
      color: var(--dpp-ui-text);
    }
    .dpp-agent-container[data-restored="true"] {
      margin-bottom: 10px;
    }
    .dpp-agent-status-line {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--dpp-ui-text-muted);
    }
    .dpp-agent-status-dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--dpp-ui-text-subtle);
    }
    .dpp-agent-container[data-console-phase="starting"] .dpp-agent-status-dot,
    .dpp-agent-container[data-console-phase="running"] .dpp-agent-status-dot {
      background: var(--dpp-ui-accent);
      animation: dpp-agent-console-pulse 1.1s ease-in-out infinite;
    }
    .dpp-agent-container[data-console-phase="complete"] .dpp-agent-status-dot {
      background: var(--dpp-ui-success);
    }
    .dpp-agent-container[data-console-phase="paused"] .dpp-agent-status-dot {
      background: var(--dpp-ui-text-subtle);
    }
    .dpp-agent-container[data-console-phase="error"] .dpp-agent-status-dot {
      background: var(--dpp-ui-error);
    }
    @keyframes dpp-agent-console-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    .dpp-agent-status-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dpp-agent-container[data-console-phase="error"] .dpp-agent-status-text {
      color: var(--dpp-ui-error);
    }
    .dpp-agent-stop-btn {
      flex: none;
      padding: 2px 9px;
      font-size: 12px;
      border: 1px solid var(--dpp-ui-error);
      border-radius: 6px;
      background: transparent;
      color: var(--dpp-ui-error);
      cursor: pointer;
    }
    .dpp-agent-stop-btn:hover {
      background: var(--dpp-ui-danger-panel);
    }
    .dpp-agent-stop-btn:focus-visible {
      outline: 2px solid var(--dpp-ui-error);
      outline-offset: 1px;
    }
    /* Narration body stream: normal message typography, never folded. */
    .dpp-agent-stream {
      /* Pure flow container: segments stack in time order, no card shell. */
    }
    .dpp-agent-narration {
      margin: 4px 0 6px;
    }
    .dpp-agent-step-body {
      font-size: 14px;
      line-height: 1.7;
      color: var(--dpp-ui-text);
      word-break: break-word;
    }
    .dpp-agent-step-body:empty {
      display: none;
    }
    .dpp-agent-step-body * { color: inherit; }
    .dpp-agent-step-body h2,
    .dpp-agent-step-body h3,
    .dpp-agent-step-body h4 {
      margin: 8px 0 5px;
      font-weight: 600;
      line-height: 1.35;
    }
    .dpp-agent-step-body h2 { font-size: 1.1em; }
    .dpp-agent-step-body h3,
    .dpp-agent-step-body h4 { font-size: 1.02em; }
    .dpp-agent-step-body p { margin: 4px 0; }
    .dpp-agent-step-body ul,
    .dpp-agent-step-body ol {
      margin: 4px 0 4px 18px;
    }
    .dpp-agent-step-body li {
      margin: 2px 0;
    }
    .dpp-agent-step-body strong {
      font-weight: 600;
    }
    .dpp-agent-step-body em {
      font-style: italic;
    }
    .dpp-agent-step-body code {
      padding: 1px 4px;
      border-radius: 6px;
      background: var(--dpp-ui-code-bg);
      font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    .dpp-agent-step-body pre {
      margin: 6px 0;
      padding: 8px;
      border-radius: 8px;
      background: var(--dpp-ui-code-bg);
      overflow-x: auto;
    }
    .dpp-agent-step-body pre code {
      padding: 0;
      background: transparent;
      white-space: pre;
    }
    .dpp-agent-step-body table {
      width: 100%;
      margin: 8px 0;
      border-collapse: collapse;
      font-size: 12px;
    }
    .dpp-agent-step-body th,
    .dpp-agent-step-body td {
      padding: 5px 6px;
      border-bottom: 1px solid var(--dpp-ui-border);
      text-align: left;
      vertical-align: top;
    }
    .dpp-agent-step-body th {
      font-weight: 600;
      color: var(--dpp-ui-text-muted);
    }
    /* Tool groups: one-line low-emphasis headers over single-line tool rows. */
    .dpp-agent-tool-group {
      margin: 2px 0;
    }
    .dpp-agent-tool-group-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 2px 0;
      border: none;
      background: transparent;
      font-size: 12px;
      color: var(--dpp-ui-text-muted);
      cursor: pointer;
      user-select: none;
      text-align: left;
    }
    .dpp-agent-tool-group-toggle:focus-visible {
      outline: 2px solid var(--dpp-ui-accent);
      outline-offset: -2px;
      border-radius: 4px;
    }
    .dpp-agent-tool-group-icon {
      flex: none;
      width: 12px;
      height: 12px;
      background-image: ${ICON_GEAR};
      background-repeat: no-repeat;
      background-position: center;
      background-size: 12px 12px;
      color: var(--dpp-ui-text-subtle);
    }
    .dpp-agent-tool-group-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dpp-agent-tool-group-chevron {
      flex: none;
      width: 12px;
      height: 12px;
      background-image: ${ICON_CHEVRON_DOWN};
      background-repeat: no-repeat;
      background-position: center;
      background-size: 12px 12px;
      color: var(--dpp-ui-text-subtle);
      transition: transform 0.2s ease;
    }
    .dpp-agent-tool-group[data-collapsed="true"] .dpp-agent-tool-group-chevron {
      transform: rotate(-90deg);
    }
    .dpp-agent-tool-group[data-collapsed="true"] .dpp-agent-tool-group-items {
      display: none;
    }
    .dpp-agent-tool-group-items {
      display: flex;
      flex-direction: column;
    }
    /* Single-line tool entries (small, gray, left icon). */
    .dpp-agent-tool-item {
      min-width: 0;
    }
    .dpp-agent-tool-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 1px 0;
      border: none;
      background: transparent;
      font-size: 12px;
      color: var(--dpp-ui-text-muted);
      cursor: pointer;
      user-select: none;
      text-align: left;
    }
    .dpp-agent-tool-toggle:focus-visible {
      outline: 2px solid var(--dpp-ui-accent);
      outline-offset: -2px;
      border-radius: 4px;
    }
    .dpp-agent-tool-state-icon {
      flex: none;
      width: 12px;
      height: 12px;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 12px 12px;
    }
    .dpp-agent-tool-item[data-tool-status="ok"] .dpp-agent-tool-state-icon {
      background-image: ${ICON_CHECK};
      color: var(--dpp-ui-success);
    }
    .dpp-agent-tool-item[data-tool-status="err"] .dpp-agent-tool-state-icon {
      background-image: ${ICON_CROSS};
      color: var(--dpp-ui-error);
    }
    .dpp-agent-tool-item[data-tool-status="pending"] .dpp-agent-tool-state-icon {
      background-color: var(--dpp-ui-accent);
      border-radius: 50%;
      animation: dpp-agent-console-pulse 1.1s ease-in-out infinite;
    }
    .dpp-agent-tool-item[data-tool-status="interrupted"] .dpp-agent-tool-state-icon {
      background-color: var(--dpp-ui-text-subtle);
      border-radius: 50%;
    }
    .dpp-agent-tool-name {
      flex: none;
      max-width: 45%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      color: var(--dpp-ui-text);
    }
    .dpp-agent-tool-param {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dpp-agent-tool-state {
      flex: none;
      font-size: 11px;
      color: var(--dpp-ui-text-subtle);
    }
    .dpp-agent-tool-chevron {
      flex: none;
      width: 10px;
      height: 10px;
      background-image: ${ICON_CHEVRON_RIGHT};
      background-repeat: no-repeat;
      background-position: center;
      background-size: 10px 10px;
      color: var(--dpp-ui-text-subtle);
      transition: transform 0.15s ease;
    }
    .dpp-agent-tool-toggle[aria-expanded="true"] .dpp-agent-tool-chevron {
      transform: rotate(90deg);
    }
    .dpp-agent-tool-summary {
      padding: 2px 0 4px 18px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--dpp-ui-text-muted);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 160px;
      overflow-y: auto;
    }
    .dpp-agent-reasoning-adopted {
      margin-left: 16px;
      border-left: 1px solid var(--dpp-ui-border);
      padding-left: 16px;
    }
    /* Per-step reasoning note: a folded one-line row like the native
       ""Thought (N s)" chip, rendered by the stream itself because the
       continuation turns' thinking text is not retained in the message flow. */
    .dpp-agent-reasoning-note {
      margin: 2px 0;
    }
    .dpp-agent-reasoning-note-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 2px 0;
      border: none;
      background: transparent;
      font-size: 12px;
      color: var(--dpp-ui-text-muted);
      cursor: pointer;
      user-select: none;
      text-align: left;
    }
    .dpp-agent-reasoning-note-toggle:focus-visible {
      outline: 2px solid var(--dpp-ui-accent);
      outline-offset: -2px;
      border-radius: 4px;
    }
    .dpp-agent-reasoning-note-icon {
      flex: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--dpp-ui-accent);
      opacity: 0.55;
    }
    .dpp-agent-reasoning-note-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dpp-agent-reasoning-note-chevron {
      flex: none;
      width: 12px;
      height: 12px;
      background-image: ${ICON_CHEVRON_DOWN};
      background-repeat: no-repeat;
      background-position: center;
      background-size: 12px 12px;
      color: var(--dpp-ui-text-subtle);
      transition: transform 0.15s ease;
    }
    .dpp-agent-reasoning-note-toggle[aria-expanded="true"] .dpp-agent-reasoning-note-chevron {
      transform: rotate(180deg);
    }
    .dpp-agent-reasoning-note-body {
      padding: 2px 0 4px 18px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--dpp-ui-text-muted);
    }
    /* HTML artifact deliverables: the code block plus a sandboxed iframe so
       the file actually runs inline (Issue #551 follow-up). */
    .dpp-agent-artifact-preview {
      margin: 2px 0 6px;
    }
    .dpp-agent-artifact-frame {
      display: block;
      width: 100%;
      height: 360px;
      border: 1px solid var(--dpp-ui-border);
      border-radius: 8px;
      background: #fff;
      box-sizing: border-box;
    }
    .dpp-agent-starting {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 13px;
      color: var(--dpp-ui-text-muted);
    }
    .dpp-agent-starting::before {
      content: '';
      flex: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid var(--dpp-ui-accent-panel);
      border-top-color: var(--dpp-ui-accent);
      animation: dpp-agent-starting-spin 0.8s linear infinite;
    }
    @keyframes dpp-agent-starting-spin {
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .dpp-agent-starting::before,
      .dpp-agent-container[data-console-phase="starting"] .dpp-agent-status-dot,
      .dpp-agent-container[data-console-phase="running"] .dpp-agent-status-dot,
      .dpp-agent-tool-item[data-tool-status="pending"] .dpp-agent-tool-state-icon {
        animation: none;
      }
      .dpp-agent-tool-group-chevron,
      .dpp-agent-tool-chevron {
        transition: none;
      }
    }
  `;
  document.head.appendChild(style);
}

export function removeInlineAgentStyles(): void {
  document.getElementById(AGENT_STEP_STYLE_ID)?.remove();
}

export function createAgentContainer(
  onStop?: () => void,
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dpp-agent-container';
  container.setAttribute('data-dpp-agent', 'true');
  container.setAttribute('data-console-phase', 'starting');

  const statusLine = document.createElement('div');
  statusLine.className = 'dpp-agent-status-line';

  const dot = document.createElement('span');
  dot.className = 'dpp-agent-status-dot';
  dot.setAttribute('aria-hidden', 'true');

  const status = document.createElement('span');
  status.className = 'dpp-agent-status-text';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = labels?.starting ?? 'Starting…';

  statusLine.appendChild(dot);
  statusLine.appendChild(status);

  if (onStop) {
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'dpp-agent-stop-btn';
    stopBtn.textContent = labels?.stop ?? 'Stop';
    stopBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      onStop();
    });
    statusLine.appendChild(stopBtn);
  }

  const stream = document.createElement('div');
  stream.className = 'dpp-agent-stream';

  container.appendChild(statusLine);
  container.appendChild(stream);
  return container;
}

export function getAgentConsoleBody(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.dpp-agent-stream');
}

export type AgentConsolePhase = 'starting' | 'running' | 'complete' | 'paused' | 'error';

export interface AgentConsoleState {
  phase: AgentConsolePhase;
  /** 0-based current step number while running. */
  stepNumber: number;
  toolCount: number;
  totalSteps: number;
  totalTools: number;
  elapsedSeconds: number;
  /** Overrides the phase default text (e.g. the explicit stopped/error label). */
  labelOverride?: string;
}

export function updateAgentConsoleHeader(
  container: HTMLElement,
  state: AgentConsoleState,
  labels?: Partial<InlineAgentRendererLabels>,
): void {
  container.setAttribute('data-console-phase', state.phase);
  const status = container.querySelector<HTMLElement>('.dpp-agent-status-text');
  if (status) status.textContent = getAgentConsoleStatusText(state, labels);
  const stopBtn = container.querySelector<HTMLElement>('.dpp-agent-stop-btn');
  if (stopBtn) stopBtn.hidden = state.phase !== 'starting' && state.phase !== 'running';
}

function getAgentConsoleStatusText(
  state: AgentConsoleState,
  labels?: Partial<InlineAgentRendererLabels>,
): string {
  if (state.labelOverride) return state.labelOverride;
  switch (state.phase) {
    case 'starting':
      return labels?.starting ?? 'Starting…';
    case 'running':
      return labels?.running?.(state.stepNumber, state.toolCount, state.elapsedSeconds)
        ?? `Running · step ${state.stepNumber + 1} · ${state.toolCount} tool calls · ${state.elapsedSeconds}s`;
    case 'complete':
      return labels?.consoleComplete?.(state.totalSteps, state.totalTools, state.elapsedSeconds)
        ?? `Complete · ${state.totalSteps} steps · ${state.totalTools} tool calls · ${state.elapsedSeconds}s`;
    case 'paused':
      return labels?.consolePaused?.(state.totalSteps, state.totalTools, state.elapsedSeconds)
        ?? `Paused · ${state.totalSteps} steps · ${state.totalTools} tool calls · ${state.elapsedSeconds}s`;
    case 'error':
      return labels?.consoleError?.(state.totalSteps, state.totalTools, state.elapsedSeconds)
        ?? `Error · ${state.totalSteps} steps · ${state.totalTools} tool calls · ${state.elapsedSeconds}s`;
  }
}

/**
 * Visually adopts a native DeepSeek reasoning block into the agent stream
 * (Issue #551). CSS-only: the host DOM is never moved or re-parented, so host
 * React re-renders cannot lose extension state. Returns true when the class
 * was newly applied (idempotent, safe to call on every mutation).
 */
export function adoptReasoningBlock(host: HTMLElement): boolean {
  if (host.classList.contains('dpp-agent-reasoning-adopted')) return false;
  host.classList.add('dpp-agent-reasoning-adopted');
  return true;
}

/**
 * Creates the narration segment for one step. The segment is NOT attached to
 * the stream yet: it is mounted (and the previous tool group sealed) on the
 * first non-empty text via {@link mountAgentNarration}, so textless tool-only
 * steps never leave an empty paragraph in the flow.
 */
export function createAgentStepElement(stepIndex: number): HTMLElement {
  const narration = document.createElement('div');
  narration.className = 'dpp-agent-step dpp-agent-narration';
  narration.setAttribute('data-step-index', String(stepIndex));
  narration.setAttribute('data-status', 'streaming');

  const body = document.createElement('div');
  body.className = 'dpp-agent-step-body';

  narration.appendChild(body);
  return narration;
}

/**
 * Places a narration segment into the stream at its chronological position
 * (after every segment of earlier steps, before any segment of the same or a
 * later step) and seals the current tool group: narration text separates tool
 * groups, so consecutive textless steps keep sharing one group while any
 * narration between tool batches starts a fresh one. A folded reasoning note
 * for the step ("Thought · step N") is mounted right before the narration.
 */
export function mountAgentNarration(
  step: HTMLElement,
  stream: HTMLElement,
  labels?: Partial<InlineAgentRendererLabels>,
): void {
  if (step.parentElement === stream) return;
  sealCurrentToolGroup(stream);
  const stepIndex = Number(step.getAttribute('data-step-index') ?? 0);
  let insertBefore: HTMLElement | null = null;
  for (const child of Array.from(stream.children) as HTMLElement[]) {
    const childStepIndex = Number(child.getAttribute('data-step-index') ?? -1);
    if (childStepIndex >= stepIndex) {
      insertBefore = child;
      break;
    }
  }
  const note = createAgentReasoningNoteElement(stepIndex, labels);
  if (insertBefore) {
    stream.insertBefore(note, insertBefore);
    stream.insertBefore(step, insertBefore);
  } else {
    stream.appendChild(note);
    stream.appendChild(step);
  }
}

/**
 * Folded per-step reasoning note (default collapsed), mirroring the native
 * "Thought (N s)" row. The continuation turns' thinking text is not
 * retained in the message flow, so the expanded body states that plainly
 * instead of faking content.
 */
export function createAgentReasoningNoteElement(
  stepNumber: number,
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const note = document.createElement('div');
  note.className = 'dpp-agent-reasoning-note';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dpp-agent-reasoning-note-toggle';
  toggle.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('span');
  icon.className = 'dpp-agent-reasoning-note-icon';
  icon.setAttribute('aria-hidden', 'true');

  const title = document.createElement('span');
  title.className = 'dpp-agent-reasoning-note-title';
  title.textContent = labels?.reasoningStep?.(stepNumber) ?? `Thought · step ${stepNumber + 1}`;

  const chevron = document.createElement('span');
  chevron.className = 'dpp-agent-reasoning-note-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  toggle.appendChild(icon);
  toggle.appendChild(title);
  toggle.appendChild(chevron);

  const body = document.createElement('div');
  body.className = 'dpp-agent-reasoning-note-body';
  body.hidden = true;
  body.textContent = labels?.reasoningNotPersisted
    ?? 'The thinking process for this step is not retained in the message stream.';

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    body.hidden = expanded;
  });

  note.appendChild(toggle);
  note.appendChild(body);
  return note;
}

function sealCurrentToolGroup(stream: HTMLElement): void {
  const state = getAgentStreamState(stream);
  const group = state.currentToolGroup;
  if (!group) return;
  state.currentToolGroup = null;
  // Sealed groups collapse to their one-line header; a manual toggle is never
  // overridden (Issue #544).
  if (group.getAttribute('data-user-toggled') !== 'true') {
    setAgentToolGroupCollapsed(group, true);
  }
}

function setAgentToolGroupCollapsed(group: HTMLElement, collapsed: boolean): void {
  group.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  const toggle = group.querySelector<HTMLElement>('.dpp-agent-tool-group-toggle');
  toggle?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

/**
 * Collapses every tool group of a finished run (unless the user toggled it)
 * and forgets the open-group bookkeeping.
 */
export function collapseAllAgentToolGroups(stream: HTMLElement): void {
  for (const group of stream.querySelectorAll<HTMLElement>(':scope > .dpp-agent-tool-group')) {
    if (group.getAttribute('data-user-toggled') !== 'true') {
      setAgentToolGroupCollapsed(group, true);
    }
  }
  const state = agentStreamStates.get(stream);
  if (state) state.currentToolGroup = null;
}

export function updateStepStreamText(step: HTMLElement, visibleText: string): void {
  const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
  if (!body) return;
  if (!visibleText) {
    // Drop the folded reasoning note mounted right before this narration.
    const previous = step.previousElementSibling;
    if (previous?.classList.contains('dpp-agent-reasoning-note')) previous.remove();
    step.remove();
    return;
  }
  body.setAttribute('data-dpp-raw-text', visibleText);
  body.innerHTML = renderAgentStreamText(visibleText);
  followAgentStreamScroll(step);
}

export function updateStepStatus(step: HTMLElement, status: string): void {
  step.setAttribute('data-status', status);
}

// ---------------------------------------------------------------------------
// Agent-stream text rendering: the narration body is markdown, with artifact
// deliverable blocks rendered structurally so HTML files can actually run
// inline. `convertInlineAgentArtifactBlocks` emits "**filename** + 4-backtick
// fenced block" (open fence while streaming); this parser recognizes exactly
// that deterministic shape and swaps the code block for the same markup plus
// a preview placeholder that {@link hydrateAgentArtifactPreviews} fills with a
// sandboxed iframe once the text is stable.
// ---------------------------------------------------------------------------
// NOTE: no /m flag — `$` must mean "end of the whole text" so the lazy
// content match cannot stop at an arbitrary line end. `^` is replaced by
// `(?:^|\n)` so blocks can appear mid-text, and the closing fence matches a
// full line via `(?=\n|$)` without consuming the following newline.
const ARTIFACT_DISPLAY_BLOCK_RE = /(?:^|\n)\*\*([^*\n`]+)\*\*\n{2,}(`{3,})([^\n`]*)\n([\s\S]*?)(?:\n\2[ \t]*(?=\n|$)|$)/g;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders agent-stream narration text: ordinary markdown, except artifact
 * blocks (filename + fenced code) are emitted as filename + `<pre>` + a
 * preview placeholder carrying the raw content in a `<template>`. Only blocks
 * whose header looks like a real file name (the conversion output always
 * carries one) get the structured treatment — a plain `**label**` paragraph
 * above a code block stays ordinary markdown.
 */
export function renderAgentStreamText(text: string): string {
  if (!text.includes('**')) return renderInlineMarkdown(text);
  let output = '';
  let cursor = 0;
  let matched = false;
  ARTIFACT_DISPLAY_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ARTIFACT_DISPLAY_BLOCK_RE.exec(text)) !== null) {
    matched = true;
    output += renderInlineMarkdown(text.slice(cursor, match.index));
    const [, filename, , lang, content] = match;
    if (filename.includes('.')) {
      output += renderArtifactBlockHtml(filename, lang, content);
    } else {
      output += renderInlineMarkdown(match[0]);
    }
    cursor = match.index + match[0].length;
  }
  if (!matched) return renderInlineMarkdown(text);
  output += renderInlineMarkdown(text.slice(cursor));
  return output;
}

function renderArtifactBlockHtml(filename: string, lang: string, content: string): string {
  const safeFilename = escapeHtml(filename);
  // `<template>` children are not rendered; `textContent` reads back the
  // original (entity-decoded) content, so the hydrated iframe gets the exact
  // file bytes without double-decoding.
  return `<p><strong>${safeFilename}</strong></p>`
    + `<pre><code>${escapeHtml(content)}</code></pre>`
    + `<div class="dpp-agent-artifact-preview" data-dpp-artifact-filename="${safeFilename}">`
    + `<template class="dpp-agent-artifact-content">${escapeHtml(content)}</template></div>`;
}

function isHtmlArtifactFilename(filename: string): boolean {
  return /\.(?:html?|xhtml)$/i.test(filename);
}

/**
 * Fills every artifact preview placeholder with a sandboxed iframe running the
 * delivered file inline (HTML deliverables only; other languages keep their
 * code block). Idempotent: an existing iframe is never replaced, so hydration
 * is safe to run after every stabilization point.
 */
export function hydrateAgentArtifactPreviews(stream: HTMLElement): void {
  for (const preview of stream.querySelectorAll<HTMLElement>('.dpp-agent-artifact-preview')) {
    if (preview.querySelector('iframe')) continue;
    const filename = preview.getAttribute('data-dpp-artifact-filename') ?? '';
    if (!isHtmlArtifactFilename(filename)) continue;
    const template = preview.querySelector<HTMLTemplateElement>('template.dpp-agent-artifact-content');
    const content = template?.content.textContent ?? '';
    if (!content) continue;
    const frame = document.createElement('iframe');
    frame.className = 'dpp-agent-artifact-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', filename);
    frame.srcdoc = content;
    preview.appendChild(frame);
  }
}

// ---------------------------------------------------------------------------
// Page scroll follow: while the agent streams, the chat scroller stays pinned
// to the bottom as long as the reader is already there; a reader who scrolled
// up is never yanked down. The scroller is discovered once by walking up from
// the stream and cached.
// ---------------------------------------------------------------------------
const AGENT_STREAM_SCROLL_FOLLOW_TOLERANCE_PX = 24;
let cachedAgentStreamScroller: HTMLElement | null | undefined;

function getAgentStreamScroller(stream: HTMLElement): HTMLElement | null {
  const cached = cachedAgentStreamScroller;
  if (cached !== undefined && cached !== null && cached.isConnected) return cached;
  let el: HTMLElement | null = stream.parentElement;
  while (el && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY)) {
        cachedAgentStreamScroller = el;
        return el;
      }
    }
    el = el.parentElement;
  }
  cachedAgentStreamScroller = null;
  return null;
}

function followAgentStreamScroll(stream: HTMLElement): void {
  const scroller = getAgentStreamScroller(stream);
  if (!scroller) return;
  const distanceToBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
  if (distanceToBottom > AGENT_STREAM_SCROLL_FOLLOW_TOLERANCE_PX) return;
  scroller.scrollTop = scroller.scrollHeight;
}

/**
 * Pins the chat scroller to the bottom after new stream content (narration
 * segments, appended answer segments) while the reader is already near it.
 */
export function followAgentStreamBottom(stream: HTMLElement): void {
  followAgentStreamScroll(stream);
}

// ---------------------------------------------------------------------------
// Native reasoning blocks: after the host finishes thinking (its title reads
// ("Thought (N s)"), the block is folded once by clicking the page's own
// title toggle. Idempotent per host, so a later manual expand is never
// re-folded, and the page's React state stays authoritative.
// ---------------------------------------------------------------------------
const REASONING_HOST_TEXT_RE = /^(?:已(?:深度)?思考|深度思考|思考过程|思考中|正在思考|thinking|reasoning|thought)(?:[\s（(:：]|$)/i;
const REASONING_COMPLETED_TEXT_RE = /^(?:已(?:深度)?思考|深度思考|思考过程|thought)(?:[\s（(:：]|$)/i;

function findReasoningHostTitle(host: HTMLElement): HTMLElement | null {
  // Prefer the most specific (shortest) matching descendant — the page's
  // title row — over the host container whose textContent also includes the
  // thinking body.
  let best: HTMLElement | null = null;
  for (const el of Array.from(host.querySelectorAll<HTMLElement>('*'))) {
    const text = (el.textContent ?? '').trim();
    if (!text || text.length > 80) continue;
    if (!REASONING_HOST_TEXT_RE.test(text)) continue;
    if (!best || text.length < (best.textContent ?? '').trim().length) best = el;
  }
  if (best) return best;
  // Fallback: the host itself when it carries the title text directly.
  const hostText = (host.textContent ?? '').trim();
  if (hostText && hostText.length <= 80 && REASONING_HOST_TEXT_RE.test(hostText)) return host;
  return null;
}

/**
 * Folds a completed native reasoning block once (Issue #551 follow-up). No-op
 * while the host is still thinking, and no-op after the first fold so the
 * user's own expand/collapse choices are never overridden.
 */
export function autoCollapseCompletedReasoningHost(host: HTMLElement): boolean {
  if (host.getAttribute('data-dpp-reasoning-auto-folded') === 'true') return false;
  const title = findReasoningHostTitle(host);
  if (!title) return false;
  const text = (title.textContent ?? '').trim();
  if (!REASONING_COMPLETED_TEXT_RE.test(text)) return false;
  host.setAttribute('data-dpp-reasoning-auto-folded', 'true');
  title.click();
  return true;
}

function createAgentToolGroup(stepIndex: number): HTMLElement {
  const group = document.createElement('div');
  group.className = 'dpp-agent-tool-group';
  group.setAttribute('data-step-index', String(stepIndex));
  group.setAttribute('data-collapsed', 'false');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dpp-agent-tool-group-toggle';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.addEventListener('click', () => {
    // Manual toggle: later auto-collapse must not override the user's choice.
    group.setAttribute('data-user-toggled', 'true');
    setAgentToolGroupCollapsed(group, group.getAttribute('data-collapsed') !== 'true');
  });

  const icon = document.createElement('span');
  icon.className = 'dpp-agent-tool-group-icon';
  icon.setAttribute('aria-hidden', 'true');

  const title = document.createElement('span');
  title.className = 'dpp-agent-tool-group-title';

  const chevron = document.createElement('span');
  chevron.className = 'dpp-agent-tool-group-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  toggle.appendChild(icon);
  toggle.appendChild(title);
  toggle.appendChild(chevron);

  const items = document.createElement('div');
  items.className = 'dpp-agent-tool-group-items';

  group.appendChild(toggle);
  group.appendChild(items);
  return group;
}

function updateAgentToolGroupCount(group: HTMLElement, labels?: Partial<InlineAgentRendererLabels>): void {
  const title = group.querySelector<HTMLElement>('.dpp-agent-tool-group-title');
  if (!title) return;
  const count = group.querySelectorAll('.dpp-agent-tool-item').length;
  title.textContent = labels?.toolGroup?.(count) ?? `Tool calls (${count})`;
}

function createAgentToolRow(
  toolName: string,
  paramSummary: string | null,
  status: 'pending' | 'ok' | 'err',
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const item = document.createElement('div');
  item.className = 'dpp-agent-tool-item';
  item.setAttribute('data-tool-status', status);

  const summaryId = nextAgentDomId('dpp-agent-tool-summary');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dpp-agent-tool-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', summaryId);

  const icon = document.createElement('span');
  icon.className = 'dpp-agent-tool-state-icon';
  icon.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'dpp-agent-tool-name';
  name.textContent = toolName;

  const param = document.createElement('span');
  param.className = 'dpp-agent-tool-param';
  param.textContent = paramSummary ? `· ${paramSummary}` : '';

  const state = document.createElement('span');
  state.className = 'dpp-agent-tool-state';
  state.textContent = status === 'pending'
    ? ''
    : (status === 'ok' ? (labels?.toolOk ?? 'OK') : (labels?.toolError ?? 'Error'));

  const chevron = document.createElement('span');
  chevron.className = 'dpp-agent-tool-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  toggle.appendChild(icon);
  toggle.appendChild(name);
  toggle.appendChild(param);
  toggle.appendChild(state);
  toggle.appendChild(chevron);

  const detail = document.createElement('div');
  detail.className = 'dpp-agent-tool-summary';
  detail.id = summaryId;
  detail.hidden = true;

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    detail.hidden = expanded;
  });

  item.appendChild(toggle);
  item.appendChild(detail);
  return item;
}

function appendToolRowToGroup(stream: HTMLElement, stepIndex: number, row: HTMLElement): HTMLElement {
  const state = getAgentStreamState(stream);
  let group = state.currentToolGroup;
  // The group must still belong to THIS stream (a re-mount through the
  // virtual list could have re-parented it otherwise).
  if (!group || group.parentElement !== stream) {
    group = createAgentToolGroup(stepIndex);
    stream.appendChild(group);
    state.currentToolGroup = group;
  }
  group.querySelector('.dpp-agent-tool-group-items')?.appendChild(row);
  return group;
}

/**
 * Renders one single-line tool entry when the model's tool call is detected
 * (status: pending). The row carries the payload parameter summary, sits in
 * the current tool group and is completed by
 * {@link resolveAgentToolEntry} once the execution result arrives.
 */
export function addAgentToolEntry(
  stream: HTMLElement,
  stepIndex: number,
  call: { name: string; payload?: unknown },
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const row = createAgentToolRow(call.name, summarizeInlineAgentToolParams(call.payload), 'pending', labels);
  const group = appendToolRowToGroup(stream, stepIndex, row);
  updateAgentToolGroupCount(group, labels);

  const state = getAgentStreamState(stream);
  const rows = state.pendingRowsByStep.get(stepIndex) ?? [];
  rows.push(row);
  state.pendingRowsByStep.set(stepIndex, rows);
  return row;
}

/**
 * Completes the oldest pending tool entry of the step with its execution
 * result. When no pending row exists (restored traces, missed detection) a
 * completed row is created in the current group instead.
 */
export function resolveAgentToolEntry(
  stream: HTMLElement,
  stepIndex: number,
  execution: ToolExecutionRecord,
  labels?: Partial<InlineAgentRendererLabels>,
): void {
  const state = getAgentStreamState(stream);
  const pending = state.pendingRowsByStep.get(stepIndex) ?? [];
  const row = pending.shift();
  if (row && row.parentElement) {
    setAgentToolRowResult(row, execution, labels);
    return;
  }
  const paramFallback = execution.result.summary.trim();
  const completed = createAgentToolRow(
    execution.name,
    paramFallback || null,
    execution.result.ok ? 'ok' : 'err',
    labels,
  );
  const group = appendToolRowToGroup(stream, stepIndex, completed);
  updateAgentToolGroupCount(group, labels);
  setAgentToolRowResult(completed, execution, labels);
}

/**
 * Terminal-state cleanup: tool entries that were detected but never resolved
 * (loop aborted mid-step) switch from the pulsing "pending" state to a
 * neutral dot instead of blinking forever.
 */
export function finalizePendingAgentToolEntries(stream: HTMLElement): void {
  const state = agentStreamStates.get(stream);
  if (!state) return;
  for (const rows of state.pendingRowsByStep.values()) {
    for (const row of rows) {
      if (row.getAttribute('data-tool-status') !== 'pending') continue;
      row.setAttribute('data-tool-status', 'interrupted');
    }
  }
  state.pendingRowsByStep.clear();
}

function setAgentToolRowResult(
  row: HTMLElement,
  execution: ToolExecutionRecord,
  labels?: Partial<InlineAgentRendererLabels>,
): void {
  const { ok } = execution.result;
  row.setAttribute('data-tool-status', ok ? 'ok' : 'err');

  const state = row.querySelector<HTMLElement>('.dpp-agent-tool-state');
  if (state) state.textContent = ok ? (labels?.toolOk ?? 'OK') : (labels?.toolError ?? 'Error');

  const detail = row.querySelector<HTMLElement>('.dpp-agent-tool-summary');
  if (!detail) return;
  detail.textContent = getToolResultDetailText(execution.result);
  // Entries default to the collapsed single line; a user-expanded detail is
  // never force-closed, and an empty detail stays hidden either way.
  const userExpanded = row.querySelector('.dpp-agent-tool-toggle')?.getAttribute('aria-expanded') === 'true';
  detail.hidden = !(userExpanded && detail.textContent.length > 0);
}

function getToolResultDetailText(result: Pick<ToolResult, 'ok' | 'summary' | 'detail' | 'output' | 'error'>): string {
  const lines: string[] = [];
  if (result.ok) {
    lines.push(result.summary);
    if (result.detail) lines.push(clampDisplayText(result.detail, 2000));
  } else {
    const reason = result.detail?.trim() || result.error?.message.trim() || '';
    if (!reason || reason === result.summary.trim()) {
      lines.push(result.summary);
    } else {
      lines.push(`${result.summary}\n${reason}`);
    }
    if (result.error) lines.push(`error: ${clampDisplayText(JSON.stringify(result.error), 2000)}`);
  }
  if (result.output !== undefined) {
    lines.push(`output: ${clampDisplayText(JSON.stringify(result.output), 4000)}`);
  }
  return lines.filter(Boolean).join('\n');
}

function clampDisplayText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}

/**
 * "Starting" placeholder shown between container mount and the first step
 * (the loop waits 2.5-6.5s for the first model turn; without this the stream
 * appears dead) (Issue #544).
 */
export function createAgentStartingElement(labels?: Partial<InlineAgentRendererLabels>): HTMLElement {
  const element = document.createElement('div');
  element.className = 'dpp-agent-starting';
  element.setAttribute('role', 'status');
  element.textContent = labels?.starting ?? 'Starting…';
  return element;
}

/**
 * True when `text` is exactly the budget-exhaustion notice for some completed
 * step count (1..maxSteps). The loop fabricates that notice by translating
 * `content.agent.budgetReached`, so the renderer recognizes it by
 * reconstructing the same strings instead of adding a wire-protocol field
 * (the AGENT_* protocol is byte-locked by the golden contract test). Used to
 * render the neutral "paused" footer instead of the green "complete" one for
 * budget-paused loops (Issue #541).
 *
 * The default range allows a +2 margin over {@link INLINE_AGENT_MAX_STEPS}:
 * the loop reports `stepIndex` (and `stepIndex + 1` on the nudge path) as the
 * completed-round count, so the notice can exceed maxSteps by one.
 */
export function isInlineAgentBudgetFinalText(
  text: string,
  budgetNoticeForCount: (count: number) => string,
  maxSteps: number = INLINE_AGENT_MAX_STEPS + 2,
): boolean {
  if (!text) return false;
  for (let count = 1; count <= maxSteps; count += 1) {
    if (text === budgetNoticeForCount(count)) return true;
  }
  return false;
}
