import { renderInlineMarkdown } from './markdown';
import { injectInjectedThemeStyles } from '../ui/injected-theme';
import { INLINE_AGENT_MAX_STEPS } from './types';
import type { ToolExecutionRecord } from '../types';

const AGENT_STEP_STYLE_ID = 'dpp-inline-agent-css';
const TOOL_SUMMARY_MAX_CHARS = 600;
/** Distance from the bottom within which streaming output keeps auto-following. */
const STREAM_SCROLL_FOLLOW_TOLERANCE_PX = 24;

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
  step: (stepNumber: number) => string;
  streaming: string;
  executingTools: string;
  starting: string;
  stop: string;
  process: string;
  tools: string;
  results: string;
  running: (stepNumber: number, toolCount: number) => string;
  toolOk: string;
  toolError: string;
  footerComplete: (totalSteps: number, totalTools: number) => string;
  footerPaused: (totalSteps: number, totalTools: number) => string;
  footerError: (totalSteps: number, totalTools: number) => string;
}

export function injectInlineAgentStyles(): void {
  injectInjectedThemeStyles();
  if (document.getElementById(AGENT_STEP_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = AGENT_STEP_STYLE_ID;
  style.textContent = `
    .dpp-agent-container {
      position: relative;
      margin-top: 12px;
      padding-left: 16px;
      border-left: 1px solid var(--dpp-ui-border);
    }
    .dpp-agent-container[data-restored="true"] {
      margin-bottom: 12px;
    }
    .dpp-agent-step {
      position: relative;
      margin-bottom: 8px;
      border: 1px solid var(--dpp-ui-border);
      border-radius: 12px;
      background: var(--dpp-ui-surface);
      color: var(--dpp-ui-text);
    }
    .dpp-agent-step::before {
      content: '';
      position: absolute;
      left: -24px;
      top: 13px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--dpp-ui-surface);
      border: 1px solid var(--dpp-ui-border);
    }
    .dpp-agent-step[data-status="streaming"] {
      border-color: var(--dpp-ui-accent);
    }
    .dpp-agent-step[data-status="streaming"]::before {
      border-color: var(--dpp-ui-accent);
      background: var(--dpp-ui-accent);
    }
    .dpp-agent-step[data-status="executing_tools"] {
      border-color: var(--dpp-ui-warning);
    }
    .dpp-agent-step[data-status="executing_tools"]::before {
      border-color: var(--dpp-ui-warning);
      background: var(--dpp-ui-warning);
    }
    .dpp-agent-step[data-status="complete"]::before {
      border-color: var(--dpp-ui-success);
      background: var(--dpp-ui-success);
    }
    .dpp-agent-step[data-status="error"] {
      border-color: var(--dpp-ui-error);
    }
    .dpp-agent-step[data-status="error"]::before {
      border-color: var(--dpp-ui-error);
      background: var(--dpp-ui-error);
    }
    .dpp-agent-step-header {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--dpp-ui-surface-muted);
      border-radius: 11px 11px 0 0;
    }
    .dpp-agent-step-toggle {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      padding: 6px 10px;
      border: none;
      background: transparent;
      font-size: 12px;
      color: var(--dpp-ui-text-muted);
      cursor: pointer;
      user-select: none;
      text-align: left;
    }
    .dpp-agent-step-toggle:focus-visible {
      outline: 2px solid var(--dpp-ui-accent);
      outline-offset: -2px;
      border-radius: 11px 0 0 0;
    }
    .dpp-agent-step-indicator {
      flex: none;
      font-weight: 600;
      color: var(--dpp-ui-accent);
    }
    .dpp-agent-step-dot {
      flex: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 14px 14px;
    }
    .dpp-agent-step[data-status="streaming"] .dpp-agent-step-dot {
      background-color: var(--dpp-ui-accent);
      animation: dpp-agent-step-pulse 1.1s ease-in-out infinite;
    }
    .dpp-agent-step[data-status="executing_tools"] .dpp-agent-step-dot {
      background-image: ${ICON_GEAR};
      color: var(--dpp-ui-warning);
    }
    .dpp-agent-step[data-status="complete"] .dpp-agent-step-dot {
      background-image: ${ICON_CHECK};
      color: var(--dpp-ui-success);
    }
    .dpp-agent-step[data-status="error"] .dpp-agent-step-dot {
      background-image: ${ICON_CROSS};
      color: var(--dpp-ui-error);
    }
    .dpp-agent-step[data-status="interrupted"] .dpp-agent-step-dot {
      background-color: var(--dpp-ui-text-subtle);
    }
    @keyframes dpp-agent-step-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dpp-agent-step[data-status="streaming"] .dpp-agent-step-dot {
        animation: none;
      }
    }
    .dpp-agent-step-status {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dpp-agent-step-chevron {
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
    .dpp-agent-step[data-collapsed="true"] .dpp-agent-step-chevron {
      transform: rotate(-90deg);
    }
    .dpp-agent-stop-btn {
      flex: none;
      margin-right: 8px;
      padding: 3px 10px;
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
    .dpp-agent-step-section-label {
      padding: 8px 10px 0;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--dpp-ui-text-muted);
    }
    .dpp-agent-step[data-collapsed="true"] .dpp-agent-step-section-label {
      display: none;
    }
    .dpp-agent-step-section-label[hidden] {
      display: none;
    }
    .dpp-agent-step-body {
      padding: 4px 10px 8px;
      font-size: 14px;
      line-height: 1.6;
      color: var(--dpp-ui-text);
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
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
    .dpp-agent-step[data-collapsed="true"] .dpp-agent-step-body,
    .dpp-agent-step[data-collapsed="true"] .dpp-agent-step-results {
      max-height: 0;
      padding: 0 10px;
      opacity: 0;
      overflow: hidden;
    }
    .dpp-agent-step-results {
      transition: max-height 0.3s ease, padding 0.3s ease, opacity 0.2s ease;
    }
    .dpp-agent-step-tools {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 4px 10px 8px;
      font-size: 13px;
      color: var(--dpp-ui-text-muted);
    }
    .dpp-agent-step-tools:empty {
      display: none;
    }
    .dpp-agent-step-tool-item {
      border: 1px solid var(--dpp-ui-border-muted);
      border-radius: 8px;
      background: var(--dpp-ui-surface-muted);
      overflow: hidden;
    }
    .dpp-agent-tool-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 5px 8px;
      border: none;
      background: transparent;
      font-size: 13px;
      color: var(--dpp-ui-text);
      cursor: pointer;
      user-select: none;
      text-align: left;
    }
    .dpp-agent-tool-toggle:focus-visible {
      outline: 2px solid var(--dpp-ui-accent);
      outline-offset: -2px;
    }
    .dpp-agent-tool-state-icon {
      flex: none;
      width: 13px;
      height: 13px;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 13px 13px;
    }
    .dpp-agent-step-tool-item.ok .dpp-agent-tool-state-icon {
      background-image: ${ICON_CHECK};
      color: var(--dpp-ui-success);
    }
    .dpp-agent-step-tool-item.err .dpp-agent-tool-state-icon {
      background-image: ${ICON_CROSS};
      color: var(--dpp-ui-error);
    }
    .dpp-agent-tool-name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dpp-agent-tool-state {
      flex: none;
      margin-left: auto;
      font-size: 12px;
      color: var(--dpp-ui-text-muted);
    }
    .dpp-agent-tool-chevron {
      flex: none;
      width: 12px;
      height: 12px;
      background-image: ${ICON_CHEVRON_RIGHT};
      background-repeat: no-repeat;
      background-position: center;
      background-size: 12px 12px;
      color: var(--dpp-ui-text-subtle);
      transition: transform 0.15s ease;
    }
    .dpp-agent-tool-toggle[aria-expanded="true"] .dpp-agent-tool-chevron {
      transform: rotate(90deg);
    }
    .dpp-agent-tool-summary {
      padding: 6px 8px 8px;
      border-top: 1px solid var(--dpp-ui-border-muted);
      font-size: 13px;
      line-height: 1.5;
      color: var(--dpp-ui-text-muted);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 160px;
      overflow-y: auto;
    }
    .dpp-agent-step-tool-result {
      margin: 4px 0;
      border: 1px solid var(--dpp-ui-border);
      border-radius: 8px;
      background: var(--dpp-ui-surface-muted);
      font-size: 13px;
    }
    .dpp-agent-step-tool-result summary {
      position: relative;
      padding: 4px 8px 4px 24px;
      cursor: pointer;
      color: var(--dpp-ui-text);
      word-break: break-word;
      list-style: none;
    }
    .dpp-agent-step-tool-result summary::-webkit-details-marker {
      display: none;
    }
    .dpp-agent-step-tool-result summary::before {
      content: '';
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      width: 12px;
      height: 12px;
      background-repeat: no-repeat;
      background-position: center;
      background-size: 12px 12px;
    }
    .dpp-agent-step-tool-result summary.ok::before {
      background-image: ${ICON_CHECK};
      color: var(--dpp-ui-success);
    }
    .dpp-agent-step-tool-result summary.err::before {
      background-image: ${ICON_CROSS};
      color: var(--dpp-ui-error);
    }
    .dpp-agent-step-tool-result-body {
      padding: 0 8px 6px;
      color: var(--dpp-ui-text-muted);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 180px;
      overflow-y: auto;
    }
    .dpp-agent-step-tool-result-body .dpp-tool-result-line {
      margin: 2px 0;
    }
    .dpp-agent-running-indicator {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      border: 1px solid var(--dpp-ui-accent);
      border-radius: 12px;
      background: var(--dpp-ui-surface);
      color: var(--dpp-ui-text);
      font-size: 13px;
      line-height: 1.4;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.28);
    }
    .dpp-agent-running-indicator-dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--dpp-ui-accent);
      animation: dpp-agent-running-pulse 1.2s ease-in-out infinite;
    }
    @keyframes dpp-agent-running-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dpp-agent-running-indicator-dot {
        animation: none;
      }
    }
    .dpp-agent-starting {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
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
      .dpp-agent-starting::before {
        animation: none;
      }
    }
    .dpp-agent-footer {
      margin-top: 8px;
      padding: 6px 0;
      font-size: 13px;
      color: var(--dpp-ui-text-muted);
    }
    .dpp-agent-footer::before {
      content: '';
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 6px;
      border-radius: 2px;
      vertical-align: -1px;
    }
    .dpp-agent-footer.complete::before {
      background: var(--dpp-ui-success);
    }
    .dpp-agent-footer.paused::before {
      background: var(--dpp-ui-text-subtle);
    }
    .dpp-agent-footer.error::before {
      background: var(--dpp-ui-error);
    }

    @media (prefers-reduced-motion: reduce) {
      .dpp-agent-step-body,
      .dpp-agent-step-results,
      .dpp-agent-step-chevron,
      .dpp-agent-tool-chevron {
        transition: none;
      }
    }
    [data-dpp-body-text] {
      font-size: inherit;
      line-height: 1.7;
      margin-top: 12px;
      color: var(--dpp-ui-text);
      word-break: break-word;
    }
    [data-dpp-body-text] * { color: inherit; }
    [data-dpp-body-text] h3 { font-size: 1.1em; font-weight: 600; margin: 10px 0 4px; }
    [data-dpp-body-text] p { margin: 3px 0; }
    [data-dpp-body-text] ul, [data-dpp-body-text] ol { margin: 3px 0 3px 16px; }
    [data-dpp-body-text] strong { font-weight: 600; }
    [data-dpp-body-text] a { color: var(--dpp-ui-accent); text-decoration: underline; }
    [data-dpp-body-text] table {
      width: 100%;
      margin: 10px 0;
      border-collapse: collapse;
      font-size: 0.95em;
    }
    [data-dpp-body-text] th,
    [data-dpp-body-text] td {
      padding: 7px 8px;
      border-bottom: 1px solid var(--dpp-ui-border);
      text-align: left;
      vertical-align: top;
    }
    [data-dpp-body-text] th { font-weight: 600; }
  `;
  document.head.appendChild(style);
}

export function removeInlineAgentStyles(): void {
  document.getElementById(AGENT_STEP_STYLE_ID)?.remove();
}

export function createAgentContainer(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'dpp-agent-container';
  container.setAttribute('data-dpp-agent', 'true');
  return container;
}

export function setAgentStepCollapsed(step: HTMLElement, collapsed: boolean): void {
  step.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
  const toggle = step.querySelector('.dpp-agent-step-toggle');
  toggle?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

export function createAgentStepElement(
  stepIndex: number,
  onStop?: () => void,
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const step = document.createElement('div');
  step.className = 'dpp-agent-step';
  step.setAttribute('data-step-index', String(stepIndex));
  step.setAttribute('data-status', 'streaming');
  step.setAttribute('data-collapsed', 'false');

  const bodyId = nextAgentDomId('dpp-agent-step-body');
  const toolsId = nextAgentDomId('dpp-agent-step-tools');
  const resultsId = nextAgentDomId('dpp-agent-step-results');

  const header = document.createElement('div');
  header.className = 'dpp-agent-step-header';
  header.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.dpp-agent-stop-btn')) return;
    // Manual toggle: later programmatic auto-collapse must not override the
    // user's explicit choice (Issue #544).
    step.setAttribute('data-user-toggled', 'true');
    setAgentStepCollapsed(step, step.getAttribute('data-collapsed') !== 'true');
  });

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'dpp-agent-step-toggle';
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-controls', `${bodyId} ${toolsId} ${resultsId}`);

  const indicator = document.createElement('span');
  indicator.className = 'dpp-agent-step-indicator';
  indicator.textContent = labels?.step?.(stepIndex + 1) ?? `Step ${stepIndex + 1}`;

  const dot = document.createElement('span');
  dot.className = 'dpp-agent-step-dot';
  dot.setAttribute('aria-hidden', 'true');

  const status = document.createElement('span');
  status.className = 'dpp-agent-step-status';
  status.textContent = labels?.streaming ?? 'streaming...';

  const chevron = document.createElement('span');
  chevron.className = 'dpp-agent-step-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  toggle.appendChild(indicator);
  toggle.appendChild(dot);
  toggle.appendChild(status);
  toggle.appendChild(chevron);
  header.appendChild(toggle);

  if (onStop) {
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'dpp-agent-stop-btn';
    stopBtn.textContent = labels?.stop ?? 'Stop';
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onStop();
    });
    header.appendChild(stopBtn);
  }

  const sectionLabel = document.createElement('div');
  sectionLabel.className = 'dpp-agent-step-section-label process';
  sectionLabel.textContent = labels?.process ?? 'Process';
  sectionLabel.hidden = true;

  const body = document.createElement('div');
  body.className = 'dpp-agent-step-body';
  body.id = bodyId;

  const tools = document.createElement('div');
  tools.className = 'dpp-agent-step-tools';
  tools.id = toolsId;

  const results = document.createElement('div');
  results.className = 'dpp-agent-step-results';
  results.id = resultsId;

  const resultsLabel = document.createElement('div');
  resultsLabel.className = 'dpp-agent-step-section-label results';
  resultsLabel.textContent = labels?.results ?? 'Results';
  resultsLabel.hidden = true;

  step.appendChild(header);
  step.appendChild(sectionLabel);
  step.appendChild(body);
  step.appendChild(tools);
  results.appendChild(resultsLabel);
  step.appendChild(results);

  return step;
}

export function updateStepStreamText(step: HTMLElement, visibleText: string): void {
  const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
  if (!body) return;

  const sectionLabel = step.querySelector<HTMLElement>('.dpp-agent-step-section-label.process');
  if (sectionLabel) sectionLabel.hidden = visibleText.length === 0;

  body.setAttribute('data-dpp-raw-text', visibleText);
  body.innerHTML = renderInlineMarkdown(visibleText);
  scrollStepBodyToBottom(body);
}

function scrollStepBodyToBottom(body: HTMLElement): void {
  const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
  // Only follow the stream while the reader is already at the bottom; never
  // yank the scroll position away from a reader who scrolled up (Issue #541).
  const stickToBottom = distanceFromBottom <= STREAM_SCROLL_FOLLOW_TOLERANCE_PX;
  if (!stickToBottom) return;
  body.scrollTop = body.scrollHeight;
  if (typeof requestAnimationFrame !== 'function') return;

  requestAnimationFrame(() => {
    const after = body.scrollHeight - body.scrollTop - body.clientHeight;
    if (after <= STREAM_SCROLL_FOLLOW_TOLERANCE_PX) {
      body.scrollTop = body.scrollHeight;
    }
  });
}

export function updateStepStatus(step: HTMLElement, status: string, label?: string): void {
  step.setAttribute('data-status', status);
  const statusEl = step.querySelector('.dpp-agent-step-status');
  if (statusEl && label) statusEl.textContent = label;
  if (status === 'complete' || status === 'error') {
    const stopBtn = step.querySelector('.dpp-agent-stop-btn');
    stopBtn?.remove();
  }
}

export function addToolResultToStep(
  step: HTMLElement,
  toolName: string,
  ok: boolean,
  summary: string,
  labels?: Partial<InlineAgentRendererLabels>,
): void {
  const tools = step.querySelector('.dpp-agent-step-tools');
  if (!tools) return;

  const item = document.createElement('div');
  item.className = `dpp-agent-step-tool-item ${ok ? 'ok' : 'err'}`;
  item.setAttribute('data-tool-status', ok ? 'ok' : 'err');

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

  const state = document.createElement('span');
  state.className = 'dpp-agent-tool-state';
  state.textContent = ok ? labels?.toolOk ?? 'OK' : labels?.toolError ?? 'Error';

  const chevron = document.createElement('span');
  chevron.className = 'dpp-agent-tool-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  toggle.appendChild(icon);
  toggle.appendChild(name);
  toggle.appendChild(state);
  toggle.appendChild(chevron);

  const detail = document.createElement('div');
  detail.className = 'dpp-agent-tool-summary';
  detail.id = summaryId;
  detail.hidden = true;
  // Clamp with an explicit truncation marker so the collapsed row and the
  // expanded result details use the same honest labeling (Issue #544).
  detail.textContent = summary.length > TOOL_SUMMARY_MAX_CHARS
    ? `${summary.slice(0, TOOL_SUMMARY_MAX_CHARS)}\n...[truncated]`
    : summary;

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    detail.hidden = expanded;
  });

  item.appendChild(toggle);
  item.appendChild(detail);
  tools.appendChild(item);
}

export type AgentFooterVariant = 'complete' | 'error' | 'paused';

/**
 * Footer for the finished agent panel. `'paused'` covers both the
 * user-stopped and budget-exhausted ends (Issue #541): neither is a success
 * nor an error, so it must not reuse the green "complete" styling.
 */
export function createAgentFooter(
  totalSteps: number,
  totalTools: number,
  variant: AgentFooterVariant,
  labelOverride?: string,
  labels?: Partial<InlineAgentRendererLabels>,
): HTMLElement {
  const footer = document.createElement('div');
  footer.className = `dpp-agent-footer ${variant}`;
  if (labelOverride) {
    footer.textContent = labelOverride;
  } else if (variant === 'error') {
    footer.textContent = labels?.footerError?.(totalSteps, totalTools) ??
      `Agent error (${totalSteps} steps, ${totalTools} tool calls)`;
  } else if (variant === 'paused') {
    footer.textContent = labels?.footerPaused?.(totalSteps, totalTools) ??
      `Agent paused (${totalSteps} steps, ${totalTools} tool calls)`;
  } else {
    footer.textContent = labels?.footerComplete?.(totalSteps, totalTools) ??
      `Agent complete (${totalSteps} steps, ${totalTools} tool calls)`;
  }
  return footer;
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

/**
 * Renders one collapsible block per executed tool with its result payload.
 * Display-only: values are clamped here and never written back to trace or
 * history records.
 */
export function addToolResultDetailsToStep(
  step: HTMLElement,
  executions: readonly ToolExecutionRecord[],
): void {
  const results = step.querySelector<HTMLElement>('.dpp-agent-step-results');
  if (!results || executions.length === 0) return;

  const resultsLabel = step.querySelector<HTMLElement>('.dpp-agent-step-section-label.results');
  if (resultsLabel) resultsLabel.hidden = false;

  for (const exec of executions) {
    const details = document.createElement('details');
    details.className = 'dpp-agent-step-tool-result';

    const summary = document.createElement('summary');
    summary.className = exec.result.ok ? 'ok' : 'err';
    const provider = exec.provider?.displayName;
    summary.textContent = exec.result.ok
      ? (provider ? `${exec.name} · ${provider}` : exec.name)
      : `${exec.name} · ${exec.result.error?.code ?? 'error'}`;

    const body = document.createElement('div');
    body.className = 'dpp-agent-step-tool-result-body';
    appendResultLine(body, 'summary', exec.result.summary);
    if (exec.result.detail) appendResultLine(body, 'detail', exec.result.detail);
    if (exec.result.output !== undefined) {
      appendResultLine(body, 'output', JSON.stringify(exec.result.output));
    }
    if (exec.result.error) {
      appendResultLine(body, 'error', JSON.stringify(exec.result.error));
    }

    details.appendChild(summary);
    details.appendChild(body);
    results.appendChild(details);
  }
}

function appendResultLine(body: HTMLElement, key: string, value: string | undefined): void {
  if (!value) return;
  const line = document.createElement('div');
  line.className = 'dpp-tool-result-line';
  line.textContent = `${key}: ${clampDisplayText(value, key === 'output' ? 4000 : 2000)}`;
  body.appendChild(line);
}

function clampDisplayText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[truncated]` : value;
}

/**
 * "Starting" placeholder shown between container mount and the first step
 * (the loop waits 2.5-6.5s for the first model turn; without this the panel
 * appears dead) (Issue #544).
 */
export function createAgentStartingElement(labels?: Partial<InlineAgentRendererLabels>): HTMLElement {
  const element = document.createElement('div');
  element.className = 'dpp-agent-starting';
  element.setAttribute('role', 'status');
  element.textContent = labels?.starting ?? 'Starting…';
  return element;
}

export function createAgentRunningIndicator(labels?: Partial<InlineAgentRendererLabels>): HTMLElement {
  const element = document.createElement('div');
  element.className = 'dpp-agent-running-indicator';
  element.setAttribute('data-dpp-agent-running', 'false');

  const dot = document.createElement('span');
  dot.className = 'dpp-agent-running-indicator-dot';
  dot.setAttribute('aria-hidden', 'true');

  // The live region lives on the text span only: a role="status" container
  // must not wrap the interactive Stop button (Issue #544).
  const text = document.createElement('span');
  text.className = 'dpp-agent-running-indicator-text';
  text.setAttribute('role', 'status');
  text.setAttribute('aria-live', 'polite');

  const stopBtn = document.createElement('button');
  stopBtn.className = 'dpp-agent-stop-btn';
  stopBtn.textContent = labels?.stop ?? 'Stop';

  element.appendChild(dot);
  element.appendChild(text);
  element.appendChild(stopBtn);
  return element;
}

export function updateAgentRunningIndicator(
  element: HTMLElement,
  state: { running: boolean; stepNumber: number; toolCount: number },
  labels?: Partial<InlineAgentRendererLabels>,
): void {
  element.setAttribute('data-dpp-agent-running', state.running ? 'true' : 'false');
  element.style.display = state.running ? '' : 'none';
  const text = element.querySelector<HTMLElement>('.dpp-agent-running-indicator-text');
  if (!text) return;
  text.textContent = state.running
    ? labels?.running?.(state.stepNumber, state.toolCount)
      ?? `Agent running (step ${state.stepNumber + 1}, ${state.toolCount} tool calls)`
    : '';
}
