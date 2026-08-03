import { afterEach, describe, expect, it } from 'vitest';
import {
  addToolResultDetailsToStep,
  createAgentRunningIndicator,
  createAgentStepElement,
  injectInlineAgentStyles,
  updateAgentRunningIndicator,
  updateStepStreamText,
} from '../core/inline-agent/renderer';
import type { ToolExecutionRecord } from '../core/types';

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
    expect(body?.innerHTML).toContain('<h4>Market summary</h4>');
    expect(body?.innerHTML).toContain('<table>');
    expect(body?.innerHTML).toContain('<td><strong>Average price</strong></td>');
  });

  it('keeps the streaming step body scrolled to the newest output', () => {
    const step = createAgentStepElement(0);
    const body = step.querySelector<HTMLElement>('.dpp-agent-step-body');
    expect(body).toBeTruthy();
    Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 480 });

    updateStepStreamText(step, 'line 1\nline 2\nline 3');

    expect(body?.scrollTop).toBe(480);
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

    expect(processLabel?.hidden).toBe(true);
    expect(toolsLabel?.hidden).toBe(true);

    updateStepStreamText(step, 'Working on it...');
    expect(processLabel?.hidden).toBe(false);
    expect(toolsLabel?.hidden).toBe(true);
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
    expect(agentStyle?.textContent).toContain('.dpp-agent-step[data-collapsed="true"] .dpp-agent-step-results');
    expect(agentStyle?.textContent).not.toContain('var(--ds-text');
  });
});
