import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addToolResultDetailsToStep,
  addToolResultToStep,
  createAgentFooter,
  createAgentRunningIndicator,
  createAgentStartingElement,
  createAgentStepElement,
  injectInlineAgentStyles,
  isInlineAgentBudgetFinalText,
  setAgentStepCollapsed,
  updateAgentRunningIndicator,
  updateStepStatus,
  updateStepStreamText,
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

  it('renders paused footers as neutral, distinct from complete and error', () => {
    const complete = createAgentFooter(2, 3, 'complete');
    expect(complete.className).toContain('complete');
    expect(complete.className).not.toContain('paused');
    expect(complete.textContent).toBe('Agent complete (2 steps, 3 tool calls)');

    const paused = createAgentFooter(2, 3, 'paused');
    expect(paused.className).toContain('paused');
    expect(paused.className).not.toContain('complete');
    expect(paused.className).not.toContain('error');
    expect(paused.textContent).toBe('Agent paused (2 steps, 3 tool calls)');

    const stopped = createAgentFooter(0, 0, 'paused', 'Stopped');
    expect(stopped.textContent).toBe('Stopped');

    const error = createAgentFooter(2, 3, 'error');
    expect(error.className).toContain('error');
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
    const step = createAgentStepElement(0, undefined, timelineLabels);
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
    const step = createAgentStepElement(0, undefined, timelineLabels);

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
    const step = createAgentStepElement(0, undefined, timelineLabels);
    const longSummary = 'x'.repeat(2000);

    addToolResultToStep(step, 'shell_exec', { ok: true, summary: longSummary }, timelineLabels);

    const summary = step.querySelector<HTMLElement>('.dpp-agent-tool-summary');
    expect(summary?.textContent?.startsWith('x'.repeat(600))).toBe(true);
    expect(summary?.textContent).toContain('[truncated]');
  });

  it('shows the concrete rejection reason in the matching failed tool row', () => {
    const step = createAgentStepElement(0, undefined, timelineLabels);

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

  it('keeps the stop control clickable without collapsing the step', () => {
    const onStop = vi.fn();
    const step = createAgentStepElement(0, onStop, timelineLabels);

    const stopBtn = step.querySelector<HTMLButtonElement>('.dpp-agent-stop-btn');
    stopBtn?.click();

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(step.getAttribute('data-collapsed')).toBe('false');

    const toggle = step.querySelector<HTMLButtonElement>('.dpp-agent-step-toggle');
    toggle?.click();

    expect(step.getAttribute('data-collapsed')).toBe('true');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('restores the same collapsed timeline structure from persisted trace data', () => {
    const step = createAgentStepElement(1, undefined, timelineLabels);
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

    const step = createAgentStepElement(0, undefined, timelineLabels);
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

  it('shows and hides the global running indicator with live counts', () => {
    const labels = {
      running: (stepNumber: number, toolCount: number) => `RUN ${stepNumber}/${toolCount}`,
      stop: 'Stop',
    };
    const el = createAgentRunningIndicator(labels);

    updateAgentRunningIndicator(el, { running: true, stepNumber: 1, toolCount: 3 }, labels);
    expect(el.getAttribute('data-dpp-agent-running')).toBe('true');
    expect(el.style.display).not.toBe('none');
    expect(el.querySelector('.dpp-agent-running-indicator-text')?.textContent).toBe('RUN 1/3');
    expect(el.querySelector('.dpp-agent-stop-btn')?.textContent).toBe('Stop');

    updateAgentRunningIndicator(el, { running: false, stepNumber: 0, toolCount: 0 }, labels);
    expect(el.getAttribute('data-dpp-agent-running')).toBe('false');
    expect(el.style.display).toBe('none');
    expect(el.querySelector('.dpp-agent-running-indicator-text')?.textContent).toBe('');
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

  it('keeps timeline and tool hooks in the injected styles', () => {
    injectInlineAgentStyles();

    const css = document.getElementById('dpp-inline-agent-css')?.textContent ?? '';
    expect(css).toContain('.dpp-agent-step-toggle');
    expect(css).toContain('.dpp-agent-step-dot');
    expect(css).toContain('.dpp-agent-step-section-label');
    expect(css).toContain('.dpp-agent-tool-summary');
    expect(css).toContain('.dpp-agent-running-indicator');
    expect(css).toContain('.dpp-agent-running-indicator {\n      position: fixed;\n      top: 12px;\n      right: 12px;');
    expect(css).not.toContain('bottom: 16px;');
    expect(css).toContain('[data-status="streaming"]');
    expect(css).toContain('@keyframes dpp-agent-step-pulse');
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

  it('exposes the running indicator as a polite live region with a dot', () => {
    const el = createAgentRunningIndicator({ stop: 'Stop' });
    const text = el.querySelector<HTMLElement>('.dpp-agent-running-indicator-text');
    expect(text?.getAttribute('role')).toBe('status');
    expect(text?.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('.dpp-agent-running-indicator-dot')).not.toBeNull();
  });
});
