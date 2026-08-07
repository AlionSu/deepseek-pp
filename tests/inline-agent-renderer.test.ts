import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addToolResultDetailsToStep,
  addToolResultToStep,
  adoptReasoningBlock,
  createAgentContainer,
  createAgentStartingElement,
  createAgentStepElement,
  getAgentConsoleBody,
  injectInlineAgentStyles,
  isInlineAgentBudgetFinalText,
  setAgentConsoleCollapsed,
  setAgentStepCollapsed,
  updateAgentConsoleHeader,
  updateStepStatus,
  updateStepStreamText,
  type AgentConsoleState,
  type InlineAgentRendererLabels,
} from '../core/inline-agent/renderer';
import type { ToolExecutionRecord } from '../core/types';

const timelineLabels: Partial<InlineAgentRendererLabels> = {
  step: (stepNumber: number) => `Step ${stepNumber}`,
  streaming: 'streaming...',
  stop: 'Stop',
  process: 'Process',
  toolOk: 'Executed',
  toolError: 'Execution failed',
};

describe('inline agent renderer', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('renders streaming markdown while preserving the raw step text', () => {
    const step = createAgentStepElement(0);

    updateStepStreamText(step, [
      '### Market summary',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      '| **Average price** | 47k |',
    ].join('\n'));

    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');

    expect(body?.getAttribute('data-dpp-raw-text')).toContain('| Metric | Value |');
    // `### ` is an ATX level-3 heading (native markdown semantics).
    expect(body?.innerHTML).toContain('<h3>Market summary</h3>');
    expect(body?.innerHTML).toContain('<table>');
    expect(body?.innerHTML).toContain('<td><strong>Average price</strong></td>');
  });

  it('renders agent-mode step text without blank rows between lines', () => {
    // DeepSeek agent mode separates every list item / sentence with \n\n.
    // The step body must collapse those blank lines instead of rendering a
    // second <br> per blank line (the "blank line between every row" bug).
    const step = createAgentStepElement(0);

    updateStepStreamText(step, [
      '现在我已经获取了足够的搜索结果。让我从这些结果中提炼出最重要的科技新闻。',
      '',
      '从搜索结果中，我可以看到当天有几个重大科技新闻：',
      '',
      '1. 远景科技集团的乌兰察布星河基地投产。',
      '',
      '2. 谷歌AI部门发生重大调整。',
      '',
      '3. 新华网报道了中国的一些科技进展。',
    ].join('\n'));

    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
    expect(body?.innerHTML).not.toContain('<br><br>');
    // Paragraphs render as <p> blocks with no <br> between them (block
    // spacing comes from CSS margins, like the page's native renderer).
    expect(body?.innerHTML).not.toContain('<br>');
    expect(body?.innerHTML).toContain('</p><p>从搜索结果中，我可以看到当天有几个重大科技新闻：</p>');
    // Ordered list rows wrap in one <ol> (native markdown semantics).
    expect(body?.innerHTML).toContain('<ol><li>远景科技集团的乌兰察布星河基地投产。</li><li>谷歌AI部门发生重大调整。</li><li>新华网报道了中国的一些科技进展。</li></ol>');
  });

  it('follows the streaming step body while the reader is at the bottom', () => {
    const step = createAgentStepElement(0);
    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
    expect(body).toBeTruthy();
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 480 });
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 456 });

    updateStepStreamText(step, 'line 1\nline 2\nline 3');

    expect(body?.scrollTop).toBe(480);
  });

  it('does not yank the streaming step body scroll away from a reader who scrolled up', () => {
    const step = createAgentStepElement(0);
    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
    expect(body).toBeTruthy();
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 480 });
    Object.defineProperty(body, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(body, 'scrollTop', { configurable: true, value: 100, writable: true });

    updateStepStreamText(step, 'line 1\nline 2\nline 3');

    expect(body?.scrollTop).toBe(100);
  });

  it('renders console header terminal states as distinct complete/paused/error', () => {
    const complete = createAgentContainer();
    updateAgentConsoleHeader(complete, {
      phase: 'complete',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 2,
      totalTools: 3,
      elapsedSeconds: 7,
    });
    expect(complete.getAttribute('data-console-phase')).toBe('complete');
    expect(complete.querySelector('.dpp-agent-console-status')?.textContent)
      .toBe('Agent complete (2 steps, 3 tool calls, 7s)');
    expect(complete.querySelector('.dpp-agent-console-dot')).not.toBeNull();

    const paused = createAgentContainer();
    updateAgentConsoleHeader(paused, {
      phase: 'paused',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 2,
      totalTools: 3,
      elapsedSeconds: 7,
    });
    expect(paused.getAttribute('data-console-phase')).toBe('paused');
    expect(paused.querySelector('.dpp-agent-console-status')?.textContent)
      .toBe('Agent paused (2 steps, 3 tool calls, 7s)');

    const stopped = createAgentContainer();
    updateAgentConsoleHeader(stopped, {
      phase: 'paused',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 0,
      totalTools: 0,
      elapsedSeconds: 7,
      labelOverride: 'Stopped',
    });
    expect(stopped.querySelector('.dpp-agent-console-status')?.textContent).toBe('Stopped');

    const error = createAgentContainer();
    updateAgentConsoleHeader(error, {
      phase: 'error',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 2,
      totalTools: 3,
      elapsedSeconds: 7,
      labelOverride: 'boom',
    });
    expect(error.getAttribute('data-console-phase')).toBe('error');
    expect(error.querySelector('.dpp-agent-console-status')?.textContent).toBe('boom');
  });

  it('hides the console stop control in terminal states', () => {
    const container = createAgentContainer(() => undefined, { stop: 'Stop' });
    const stopBtn = container.querySelector<HTMLButtonElement>('.dpp-agent-stop-btn');
    expect(stopBtn?.hidden).toBe(false);

    updateAgentConsoleHeader(container, {
      phase: 'running',
      stepNumber: 0,
      toolCount: 1,
      totalSteps: 0,
      totalTools: 0,
      elapsedSeconds: 2,
    });
    expect(stopBtn?.hidden).toBe(false);

    updateAgentConsoleHeader(container, {
      phase: 'complete',
      stepNumber: 0,
      toolCount: 0,
      totalSteps: 1,
      totalTools: 1,
      elapsedSeconds: 2,
    });
    expect(stopBtn?.hidden).toBe(true);
  });

  it('recognizes the exact budget-exhaustion notice as a paused final text', () => {
    const noticeFor = (count: number) => `paused after ${count} rounds`;
    expect(isInlineAgentBudgetFinalText('paused after 3 rounds', noticeFor)).toBe(true);
    expect(isInlineAgentBudgetFinalText('paused after 25 rounds', noticeFor)).toBe(true);
    expect(isInlineAgentBudgetFinalText('paused after 27 rounds', noticeFor)).toBe(true);
    expect(isInlineAgentBudgetFinalText('paused after 28 rounds', noticeFor)).toBe(false);
    expect(isInlineAgentBudgetFinalText('Here is the final answer.', noticeFor)).toBe(false);
    expect(isInlineAgentBudgetFinalText('', noticeFor)).toBe(false);
  });

  it('labels the streamed model output as process text separate from the answer', () => {
    const step = createAgentStepElement(0, timelineLabels);
    const sectionLabel = step.querySelector<HTMLElement>('.dpp-agent-step-section-label');

    expect(sectionLabel?.textContent).toBe('Process');
    expect(sectionLabel?.hidden).toBe(true);

    updateStepStreamText(step, 'working through the problem');

    expect(sectionLabel?.hidden).toBe(false);
    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
    expect(body?.textContent).toContain('working through the problem');
    expect(body?.textContent).not.toContain('Process');
  });

  it('renders each tool execution as an independently collapsible row', () => {
    const step = createAgentStepElement(0, timelineLabels);

    addToolResultToStep(step, 'web_search', { ok: true, summary: 'found 5 results' }, timelineLabels);
    addToolResultToStep(step, 'web_fetch', { ok: false, summary: 'request failed: 403' }, timelineLabels);

    const items = step.querySelectorAll<HTMLElement>('.dpp-agent-step-tool-item');
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('data-tool-status')).toBe('ok');
    expect(items[1].getAttribute('data-tool-status')).toBe('err');
    expect(items[0].querySelector('.dpp-agent-tool-name')?.textContent).toBe('web_search');
    expect(items[1].querySelector('.dpp-agent-tool-name')?.textContent).toBe('web_fetch');
    expect(items[0].querySelector('.dpp-agent-tool-state')?.textContent).toBe('Executed');
    expect(items[1].querySelector('.dpp-agent-tool-state')?.textContent).toBe('Execution failed');

    const summaries = step.querySelectorAll<HTMLElement>('.dpp-agent-tool-summary');
    expect(summaries).toHaveLength(2);
    expect(summaries[0].hidden).toBe(true);
    expect(summaries[1].hidden).toBe(true);

    const firstToggle = items[0].querySelector<HTMLButtonElement>('.dpp-agent-tool-toggle');
    expect(firstToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(firstToggle?.getAttribute('aria-controls')).toBe(summaries[0].id);

    firstToggle?.click();
    expect(summaries[0].hidden).toBe(false);
    expect(summaries[0].textContent).toBe('found 5 results');
    expect(firstToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(summaries[1].hidden).toBe(true);

    firstToggle?.click();
    expect(summaries[0].hidden).toBe(true);
    expect(summaries[1].hidden).toBe(true);
  });

  it('bounds long tool summaries with an explicit truncation marker', () => {
    const step = createAgentStepElement(0, timelineLabels);
    const longSummary = 'x'.repeat(2000);

    addToolResultToStep(step, 'shell_exec', { ok: true, summary: longSummary }, timelineLabels);

    const summary = step.querySelector<HTMLElement>('.dpp-agent-tool-summary');
    expect(summary?.textContent?.startsWith('x'.repeat(600))).toBe(true);
    expect(summary?.textContent).toContain('[truncated]');
  });

  it('shows the concrete rejection reason in the matching failed tool row', () => {
    const step = createAgentStepElement(0, timelineLabels);

    addToolResultToStep(step, 'shell_exec', {
      ok: false,
      summary: '工具授权被拒绝',
      detail: 'Tool call turn:2:xml:0 has already been reserved or consumed.',
      error: {
        code: 'tool_call_replayed',
        message: 'Tool call turn:2:xml:0 has already been reserved or consumed.',
        retryable: false,
      },
    }, timelineLabels);

    const toggle = step.querySelector<HTMLButtonElement>('.dpp-agent-tool-toggle');
    toggle?.click();
    expect(step.querySelector('.dpp-agent-tool-summary')?.textContent).toBe(
      '工具授权被拒绝\nTool call turn:2:xml:0 has already been reserved or consumed.',
    );
  });

  it('renders collapsible tool result details per execution', () => {
    const step = createAgentStepElement(0);
    const executions: ToolExecutionRecord[] = [
      {
        name: 'web_search',
        provider: { kind: 'local', id: 'web', displayName: 'DeepSeek++ Web Search', transport: 'in_process' },
        result: {
          ok: true,
          summary: 'Found 3 results',
          detail: 'Top hit: example.com',
          output: [{ title: 'A', url: 'https://example.com' }],
        },
      },
      {
        name: 'mcp_tool',
        provider: { kind: 'mcp', id: 'server', displayName: 'Server', transport: 'stdio_bridge' },
        result: {
          ok: false,
          summary: 'Failed',
          error: { code: 'bad_input', message: 'Bad input', retryable: true },
        },
      },
    ];

    addToolResultDetailsToStep(step, executions);

    const details = step.querySelectorAll<HTMLDetailsElement>('.dpp-agent-step-tool-result');
    expect(details).toHaveLength(2);
    expect(details[0]?.querySelector('summary')?.textContent).toContain('web_search');
    expect(details[0]?.querySelector('summary')?.className).toContain('ok');
    const firstBodyLines = Array.from(
      details[0]?.querySelectorAll<HTMLElement>('.dpp-tool-result-line') ?? [],
    ).map((line) => line.textContent ?? '');
    expect(firstBodyLines.some((line) => line.includes('Found 3 results'))).toBe(true);
    expect(firstBodyLines.some((line) => line.includes('example.com'))).toBe(true);
    expect(details[1]?.querySelector('summary')?.className).toContain('err');
    const secondBodyLines = Array.from(
      details[1]?.querySelectorAll<HTMLElement>('.dpp-tool-result-line') ?? [],
    ).map((line) => line.textContent ?? '');
    expect(secondBodyLines.some((line) => line.includes('bad_input'))).toBe(true);

    const resultsLabel = step.querySelector<HTMLElement>('.dpp-agent-step-section-label.results');
    expect(resultsLabel?.hidden).toBe(false);
  });

  it('keeps section labels hidden until their section has content', () => {
    const step = createAgentStepElement(0);
    const processLabel = step.querySelector<HTMLElement>('.dpp-agent-step-section-label.process');
    const toolsLabel = step.querySelector<HTMLElement>('.dpp-agent-step-section-label.tools');
    const resultsLabel = step.querySelector<HTMLElement>('.dpp-agent-step-section-label.results');

    expect(processLabel?.hidden).toBe(true);
    expect(toolsLabel?.hidden).toBe(true);
    expect(resultsLabel?.hidden).toBe(true);

    updateStepStreamText(step, 'Working on it...');
    expect(processLabel?.hidden).toBe(false);
    expect(resultsLabel?.hidden).toBe(true);

    addToolResultToStep(step, 'web_search', { ok: true, summary: 'found 5 results' });
    expect(toolsLabel?.hidden).toBe(false);
    expect(toolsLabel?.textContent).toBe('Tool calls');
  });

  it('keeps the console stop control clickable without collapsing the console', () => {
    const onStop = vi.fn();
    const container = createAgentContainer(onStop, timelineLabels);

    const stopBtn = container.querySelector<HTMLButtonElement>('.dpp-agent-stop-btn');
    stopBtn?.click();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(container.getAttribute('data-console-collapsed')).toBe('false');

    const toggle = container.querySelector<HTMLButtonElement>('.dpp-agent-console-toggle');
    toggle?.click();

    expect(container.getAttribute('data-console-collapsed')).toBe('true');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('collapses and expands the whole console through the header toggle', () => {
    const container = createAgentContainer();
    const toggle = container.querySelector<HTMLButtonElement>('.dpp-agent-console-toggle');
    const body = getAgentConsoleBody(container);

    expect(body).not.toBeNull();
    expect(container.getAttribute('data-console-collapsed')).toBe('false');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');

    setAgentConsoleCollapsed(container, true);
    expect(container.getAttribute('data-console-collapsed')).toBe('true');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    setAgentConsoleCollapsed(container, false);
    expect(container.getAttribute('data-console-collapsed')).toBe('false');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders steps inside the console body with an initial starting header', () => {
    const container = createAgentContainer(undefined, { starting: 'Starting…' });
    expect(container.getAttribute('data-console-phase')).toBe('starting');
    expect(container.querySelector('.dpp-agent-console-status')?.textContent).toBe('Starting…');

    const step = createAgentStepElement(0, timelineLabels);
    getAgentConsoleBody(container)?.appendChild(step);

    expect(container.querySelector('.dpp-agent-console-body .dpp-agent-step')).toBe(step);
    // The header collapse never hides the interactive stop control.
    setAgentConsoleCollapsed(container, true);
    expect(container.querySelector('.dpp-agent-console-body')).not.toBeNull();
  });

  it('adopts native reasoning hosts idempotently without moving them', () => {
    const host = document.createElement('div');
    expect(host.parentElement).toBeNull();

    expect(adoptReasoningBlock(host)).toBe(true);
    expect(host.classList.contains('dpp-agent-reasoning-adopted')).toBe(true);
    expect(host.parentElement).toBeNull();

    expect(adoptReasoningBlock(host)).toBe(false);
  });

  it('restores the same collapsed timeline structure from persisted trace data', () => {
    const step = createAgentStepElement(1, timelineLabels);
    updateStepStreamText(step, 'process text');
    addToolResultToStep(step, 'web_search', { ok: true, summary: 'summary' }, timelineLabels);
    updateStepStatus(step, 'complete', 'Complete (1 tools)');
    setAgentStepCollapsed(step, true);

    expect(step.getAttribute('data-step-index')).toBe('1');
    expect(step.getAttribute('data-status')).toBe('complete');
    expect(step.getAttribute('data-collapsed')).toBe('true');
    expect(step.querySelector('.dpp-agent-step-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(step.querySelector('.dpp-agent-step-dot')).not.toBeNull();
    expect(step.querySelector('.dpp-agent-step-status')?.textContent).toBe('Complete (1 tools)');
    expect(step.querySelector<HTMLElement>('.dpp-agent-step-section-label')?.hidden).toBe(false);
    expect(step.querySelector('.dpp-agent-stop-btn')).toBeNull();

    setAgentStepCollapsed(step, false);
    expect(step.querySelector('.dpp-agent-step-toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps tool rows visible and independently expandable in a collapsed step', () => {
    injectInlineAgentStyles();

    const step = createAgentStepElement(0, timelineLabels);
    updateStepStreamText(step, 'process text');
    addToolResultToStep(step, 'web_search', { ok: true, summary: 'found 5 results' }, timelineLabels);
    addToolResultToStep(step, 'web_fetch', { ok: false, summary: 'request failed: 403' }, timelineLabels);
    updateStepStatus(step, 'complete', 'Complete (2 tools)');

    setAgentStepCollapsed(step, true);
    expect(step.getAttribute('data-collapsed')).toBe('true');

    const css = document.getElementById('dpp-inline-agent-css')?.textContent ?? '';
    expect(css).toContain('.dpp-agent-step[data-collapsed="true"] .dpp-agent-step-body');
    expect(css).toContain('.dpp-agent-step[data-collapsed="true"] .dpp-agent-step-results');
    expect(css).not.toContain('.dpp-agent-step[data-collapsed="true"] .dpp-agent-step-tools');

    const items = step.querySelectorAll<HTMLElement>('.dpp-agent-step-tool-item');
    const toggles = step.querySelectorAll<HTMLButtonElement>('.dpp-agent-tool-toggle');
    const summaries = step.querySelectorAll<HTMLElement>('.dpp-agent-tool-summary');
    expect(items).toHaveLength(2);
    expect(toggles[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(toggles[1]?.getAttribute('aria-expanded')).toBe('false');

    toggles[0]?.click();
    expect(toggles[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(summaries[0]?.hidden).toBe(false);
    expect(summaries[0]?.textContent).toBe('found 5 results');
    expect(toggles[1]?.getAttribute('aria-expanded')).toBe('false');
    expect(summaries[1]?.hidden).toBe(true);
    expect(step.getAttribute('data-collapsed')).toBe('true');

    setAgentStepCollapsed(step, false);
    expect(toggles[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(summaries[0]?.hidden).toBe(false);
  });

  it('renders the console header running state with live counts and elapsed time', () => {
    const labels = {
      running: (stepNumber: number, toolCount: number, elapsedSeconds: number) =>
        `RUN ${stepNumber + 1}/${toolCount}/${elapsedSeconds}`,
      stop: 'Stop',
    };
    const container = createAgentContainer(() => undefined, labels);

    updateAgentConsoleHeader(container, {
      phase: 'running',
      stepNumber: 1,
      toolCount: 3,
      totalSteps: 0,
      totalTools: 0,
      elapsedSeconds: 5,
    }, labels);

    expect(container.getAttribute('data-console-phase')).toBe('running');
    expect(container.querySelector('.dpp-agent-console-status')?.textContent).toBe('RUN 2/3/5');
    expect(container.querySelector('.dpp-agent-stop-btn')?.textContent).toBe('Stop');
  });

  it('uses the shared injected theme for dark-mode readable text', () => {
    injectInlineAgentStyles();

    const agentStyle = document.getElementById('dpp-inline-agent-css');
    expect(document.getElementById('dpp-injected-theme-css')).not.toBeNull();
    expect(agentStyle?.textContent).toContain('color: var(--dpp-ui-text);');
    expect(agentStyle?.textContent).toContain('[data-dpp-body-text]');
    expect(agentStyle?.textContent).toContain('color: var(--dpp-ui-accent);');
    expect(agentStyle?.textContent).not.toContain('var(--ds-text');
  });

  it('keeps timeline and console hooks in the injected styles', () => {
    injectInlineAgentStyles();

    const css = document.getElementById('dpp-inline-agent-css')?.textContent ?? '';
    expect(css).toContain('.dpp-agent-step-toggle');
    expect(css).toContain('.dpp-agent-step-dot');
    expect(css).toContain('.dpp-agent-step-section-label');
    expect(css).toContain('.dpp-agent-tool-summary');
    expect(css).toContain('.dpp-agent-console-header');
    expect(css).toContain('.dpp-agent-console-status');
    expect(css).toContain('.dpp-agent-console-chevron');
    expect(css).toContain('.dpp-agent-reasoning-adopted');
    // The old fixed top-right indicator is gone; status lives in the console.
    expect(css).not.toContain('.dpp-agent-running-indicator');
    expect(css).not.toContain('z-index: 2147483647');
    expect(css).toContain('[data-status="streaming"]');
    expect(css).toContain('@keyframes dpp-agent-console-pulse');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('replaces unicode status glyphs with inline SVG icons', () => {
    injectInlineAgentStyles();

    const css = document.getElementById('dpp-inline-agent-css')?.textContent ?? '';
    expect(css).toContain('data:image/svg+xml');
    expect(css).not.toContain('\\25CF'); // ●
    expect(css).not.toContain('\\2699'); // ⚙
    expect(css).not.toContain('\\2713'); // ✓
    expect(css).not.toContain('\\2717'); // ✗
    expect(css).not.toContain('\\25A0'); // ■
  });

  it('declares the collapse control for the body, tools, and results regions', () => {
    const step = createAgentStepElement(0);
    const toggle = step.querySelector<HTMLButtonElement>('.dpp-agent-step-toggle');
    const controls = toggle?.getAttribute('aria-controls')?.split(/\s+/) ?? [];
    expect(controls).toHaveLength(3);
    for (const id of controls) {
      expect(step.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it('remembers a manual step toggle so later auto-collapse can defer to it', () => {
    const step = createAgentStepElement(0);
    expect(step.getAttribute('data-user-toggled')).toBeNull();

    const toggle = step.querySelector<HTMLButtonElement>('.dpp-agent-step-toggle');
    toggle?.click();
    expect(step.getAttribute('data-user-toggled')).toBe('true');
    expect(step.getAttribute('data-collapsed')).toBe('true');
  });

  it('renders the starting placeholder with a live status region', () => {
    const el = createAgentStartingElement({ starting: 'Starting…' });
    expect(el.className).toContain('dpp-agent-starting');
    expect(el.getAttribute('role')).toBe('status');
    expect(el.textContent).toBe('Starting…');
  });

  it('marks interrupted steps as neutral instead of frozen streaming', () => {
    const step = createAgentStepElement(0);
    updateStepStatus(step, 'interrupted', 'Interrupted');

    expect(step.getAttribute('data-status')).toBe('interrupted');
    expect(step.querySelector('.dpp-agent-step-status')?.textContent).toBe('Interrupted');

    injectInlineAgentStyles();
    const css = document.getElementById('dpp-inline-agent-css')?.textContent ?? '';
    expect(css).toContain('[data-status="interrupted"]');
  });

  it('exposes the console header status as a polite live region with a dot', () => {
    const el = createAgentContainer(() => undefined, { stop: 'Stop' });
    const text = el.querySelector<HTMLElement>('.dpp-agent-console-status');
    expect(text?.getAttribute('role')).toBe('status');
    expect(text?.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('.dpp-agent-console-dot')).not.toBeNull();
  });
});
