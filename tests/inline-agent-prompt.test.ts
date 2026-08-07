import { describe, expect, it } from 'vitest';
import {
  buildContinuationPrompt,
  buildNudgePrompt,
  isInlineAgentContinuationPrompt,
  isInlineAgentContinuationStructure,
  normalizeInlineAgentFinalAnswerText,
  replaceTaskCompleteBlocks,
  INLINE_AGENT_FULL_TOOL_RESULT_WINDOW,
  shouldNudge,
} from '../core/inline-agent/prompt';
import {
  convertInlineAgentArtifactBlocks,
  getInlineAgentAnswerText,
  getInlineAgentProcessText,
  resolveInlineAgentAnswerText,
  stripInlineAgentTruncationSuffix,
  summarizeInlineAgentToolParams,
  INLINE_AGENT_TRUNCATION_MARKER,
} from '../core/inline-agent/display-text';
import { buildAutomationToolContinuationPrompt } from '../core/automation/runner';
import type { ToolExecutionRecord } from '../core/types';

const SUCCESS_EXECUTION: ToolExecutionRecord = {
  name: 'web_search',
  provider: {
    kind: 'local',
    id: 'web',
    displayName: 'DeepSeek++ Web Search',
    transport: 'in_process',
  },
  result: {
    ok: true,
    summary: 'Search completed with 1 results',
    detail: 'One result',
    output: [{ title: 'Result', url: 'https://example.com' }],
  },
};

const FAILED_EXECUTION: ToolExecutionRecord = {
  name: 'mcp_tool',
  provider: {
    kind: 'mcp',
    id: 'server',
    displayName: 'Server',
    transport: 'stdio_bridge',
  },
  result: {
    ok: false,
    summary: 'Failed',
    detail: 'Bad input',
    error: {
      code: 'bad_input',
      message: 'Bad input',
      retryable: true,
    },
  },
};

describe('inline-agent model prompts', () => {
  it('builds English continuation prompts while preserving control tags', () => {
    const prompt = buildContinuationPrompt('Find current docs', [SUCCESS_EXECUTION, FAILED_EXECUTION], 'en');

    expect(prompt).toContain('Continue like a real agent');
    expect(prompt).toContain('At least one tool failed');
    expect(prompt).toContain('<original_task>');
    expect(prompt).toContain('</original_task>');
    expect(prompt).toContain('<tool_results>');
    expect(prompt).toContain('</tool_results>');
    expect(prompt).not.toContain('以下是工具续跑任务');
  });

  it('keeps Chinese continuation prompts available', () => {
    const prompt = buildContinuationPrompt('查文档', [SUCCESS_EXECUTION], 'zh-CN');

    expect(prompt).toContain('以下是工具续跑任务');
    expect(prompt).toContain('<tool_results>');
    expect(prompt).not.toContain('Continue like a real agent');
  });

  it('localizes nudge prompts without changing task_complete', () => {
    const nudge = buildNudgePrompt('Ship it', 'I will continue.', [SUCCESS_EXECUTION], 1, 'en');

    expect(nudge).toContain('did not include executable tool XML');
    expect(nudge).toContain('<task_complete>{"summary":"..."}</task_complete>');
    expect(nudge).toContain('<tool_results_so_far>');
  });

  it('keeps the completion-signal format without a final-answer split contract', () => {
    // Issue #551 follow-up: the summary-split contract was reverted — models
    // write real deliverables into the reply body, and the display layer
    // renders the full body as the answer. The <task_complete> signal remains
    // the termination marker only.
    const continuation = buildContinuationPrompt('查行情', [SUCCESS_EXECUTION], 'zh-CN');
    expect(continuation).not.toContain('完整最终答案');

    const nudge = buildNudgePrompt('查行情', '我会继续。', [SUCCESS_EXECUTION], 1, 'zh-CN');
    expect(nudge).toContain('<task_complete>{"summary":"..."}</task_complete>');
    expect(nudge).not.toContain('完整最终答案');

    const enContinuation = buildContinuationPrompt('Research docs', [SUCCESS_EXECUTION], 'en');
    expect(enContinuation).not.toContain('complete final answer for the user');
  });

  it('renders the full pre-signal reply body as the user-facing answer', () => {
    // Issue #551 follow-up: deliverables live in the reply body; the answer
    // area shows the complete body, not just the signal summary.
    const text = [
      '我先整理一下刚才获取的信息。',
      '',
      '<task_complete>{"summary":"最终答案：任务已经完成。","artifacts":["demo.html"]}</task_complete>',
    ].join('\n');

    expect(getInlineAgentAnswerText(text)).toBe('我先整理一下刚才获取的信息。');
  });

  it('falls back to the task_complete summary when the reply body is empty', () => {
    const text = '<task_complete>{"summary":"最终答案：任务已经完成。"}</task_complete>';
    expect(getInlineAgentAnswerText(text)).toBe('最终答案：任务已经完成。');
  });

  it('renders the reply body when the task_complete summary is empty', () => {
    const text = [
      '我先整理一下刚才获取的信息。',
      '<task_complete>{"summary":""}</task_complete>',
    ].join('\n');

    expect(getInlineAgentAnswerText(text)).toBe('我先整理一下刚才获取的信息。');
  });

  it('falls back to the full text when no task_complete signal exists', () => {
    expect(getInlineAgentAnswerText('正常回答内容。')).toBe('正常回答内容。');
    expect(getInlineAgentAnswerText('，用户想了解港股的走势。')).toBe('用户想了解港股的走势。');
  });

  it('resolves the longer reply when finalText is a prefix of the last step text', () => {
    // Issue #551 follow-up: traces persisted by older builds stored only a
    // summary/prefix as finalText while the complete reply (e.g. a generated
    // HTML document) survived solely in the last step. The longer same-origin
    // candidate is the answer, and the step body may be cleared.
    const prefix = '搜索结果中，我已经收集了足够的数据。';
    const full = prefix + '```html<html>完整交付物</html>```';
    expect(resolveInlineAgentAnswerText(prefix, full)).toEqual({ answer: full, fromStep: true });
    expect(resolveInlineAgentAnswerText(full, prefix)).toEqual({ answer: full, fromStep: false });
    expect(resolveInlineAgentAnswerText(full, full)).toEqual({ answer: full, fromStep: false });
  });

  it('keeps finalText when the candidates are unrelated (budget notice, summary split)', () => {
    expect(resolveInlineAgentAnswerText('已达到步骤预算，代理已暂停。', '最后一步的工作笔记。'))
      .toEqual({ answer: '已达到步骤预算，代理已暂停。', fromStep: false });
    expect(resolveInlineAgentAnswerText('最终答案。', ''))
      .toEqual({ answer: '最终答案。', fromStep: false });
    expect(resolveInlineAgentAnswerText('', '最后一步的完整回复。'))
      .toEqual({ answer: '最后一步的完整回复。', fromStep: true });
  });

  it('keeps working notes in process text without the control block', () => {
    const text = [
      '我先整理一下刚才获取的信息。',
      '',
      '<task_complete>{"summary":"最终答案"}</task_complete>',
    ].join('\n');

    expect(getInlineAgentProcessText(text)).toBe('我先整理一下刚才获取的信息。');
    expect(getInlineAgentProcessText('普通过程文本。')).toBe('普通过程文本。');
  });

  it('converts artifact_create blocks into filename + fenced code blocks', () => {
    // Issue #551 stream redesign: the model delivers files as raw
    // `<artifact_create>` XML text; the display layer must never show the raw
    // JSON — the deliverable renders as its own code block.
    const raw = [
      '我已经生成了文件。',
      '',
      '<artifact_create>{"filename":"demo.html","content":"<h1>Hi</h1>\\n<p>你好</p>"}</artifact_create>',
    ].join('\n');

    const converted = convertInlineAgentArtifactBlocks(raw);

    expect(converted).not.toContain('<artifact_create>');
    expect(converted).not.toContain('{"filename"');
    expect(converted).toContain('**demo.html**');
    // Fixed 4-backtick fence + inferred language, content unescaped.
    expect(converted).toContain('````html\n<h1>Hi</h1>\n<p>你好</p>\n````');
  });

  it('lengthens the artifact fence when the content contains backticks', () => {
    const withFence = '<artifact_create>{"filename":"a.md","content":"```js\\ncode\\n```"}</artifact_create>';
    const converted = convertInlineAgentArtifactBlocks(withFence);
    expect(converted).toContain('````markdown\n```js\ncode\n```\n````');

    const withQuad = '<artifact_create>{"filename":"b.md","content":"````\\nquad\\n````"}</artifact_create>';
    const convertedQuad = convertInlineAgentArtifactBlocks(withQuad);
    expect(convertedQuad).toContain('`````markdown\n````\nquad\n````\n`````');
  });

  it('converts artifact_bundle_create into one code block per file', () => {
    const raw = '<artifact_bundle_create>{"filename":"site.zip","files":[{"filename":"index.html","content":"<h1>首页</h1>"},{"filename":"app.js","content":"console.log(1)"}]}</artifact_bundle_create>';

    const converted = convertInlineAgentArtifactBlocks(raw);

    expect(converted).not.toContain('<artifact_bundle_create>');
    expect(converted).toContain('**index.html**');
    expect(converted).toContain('**app.js**');
    expect(converted).toContain('````html\n<h1>首页</h1>\n````');
    expect(converted).toContain('````javascript\nconsole.log(1)\n````');
  });

  it('salvages truncated artifact fragments with an explicit truncation marker', () => {
    // Historical traces clamped the step text at 8000 chars mid-artifact and
    // lost the closing tag: the fragment is best-effort decoded into a code
    // block with the same honest marker clampText uses.
    const truncated = '<artifact_create>{"filename":"demo.html","content":"<h1>Hi</h1>\\n<p>part';

    const converted = convertInlineAgentArtifactBlocks(truncated);

    expect(converted).toContain('**demo.html**');
    expect(converted).toContain('````html\n<h1>Hi</h1>\n<p>part');
    expect(converted).toContain(`\n${INLINE_AGENT_TRUNCATION_MARKER}\n` + '````');
    // The closing fence makes the salvaged block well-formed markdown.
    expect(converted.trimEnd().endsWith('````')).toBe(true);
  });

  it('keeps incomplete artifact fragments hidden while streaming', () => {
    const truncated = '<artifact_create>{"filename":"demo.html","content":"<h1>Hi</h1>\\n<p>part';

    expect(convertInlineAgentArtifactBlocks(truncated, { partial: 'hide' })).toBe('');
    // A complete block renders even in streaming mode.
    const complete = '<artifact_create>{"filename":"demo.html","content":"done"}</artifact_create>';
    expect(convertInlineAgentArtifactBlocks(complete, { partial: 'hide' })).toContain('**demo.html**');
  });

  it('renders an open code block while streaming so the deliverable grows', () => {
    // Issue #551 follow-up: during live streaming an incomplete artifact must
    // show the partial content (as an open fence the markdown renderer closes
    // at the end of the text) instead of hiding the whole block.
    const partial = '<artifact_create>{"filename":"demo.html","content":"<h1>Hi</h1>\\n<p>part';

    const converted = convertInlineAgentArtifactBlocks(partial, { partial: 'stream' });

    expect(converted).toContain('**demo.html**');
    expect(converted).toContain('````html\n<h1>Hi</h1>\n<p>part');
    // No truncation marker and no closing fence while streaming.
    expect(converted).not.toContain(INLINE_AGENT_TRUNCATION_MARKER);
    expect(converted.trimEnd().endsWith('````')).toBe(false);

    // Once the block is complete the closed form appears.
    const complete = '<artifact_create>{"filename":"demo.html","content":"done"}</artifact_create>';
    const completeConverted = convertInlineAgentArtifactBlocks(complete, { partial: 'stream' });
    expect(completeConverted.trimEnd().endsWith('````')).toBe(true);
    expect(completeConverted).not.toContain(INLINE_AGENT_TRUNCATION_MARKER);
  });

  it('keeps stream-mode partials prefix-compatible with the complete block', () => {
    // The same-origin resolution must survive streaming open blocks: the open
    // partial "**f**\n\n````html\n<p>fu" is a prefix of the closed complete
    // block, so a clamped step still dedups against the final answer.
    const rawFull = '<artifact_create>{"filename":"a.html","content":"<p>full</p>"}</artifact_create>';
    const rawPartial = '<artifact_create>{"filename":"a.html","content":"<p>fu';
    const full = convertInlineAgentArtifactBlocks(rawFull);
    const partial = convertInlineAgentArtifactBlocks(rawPartial, { partial: 'stream' });

    expect(full.startsWith(partial)).toBe(true);
    expect(resolveInlineAgentAnswerText(full, partial)).toEqual({ answer: full, fromStep: false });
  });

  it('leaves non-artifact text untouched', () => {
    expect(convertInlineAgentArtifactBlocks('普通文本。\n\n```js\nx\n```')).toBe('普通文本。\n\n```js\nx\n```');
  });

  it('strips truncation suffixes for same-origin comparison', () => {
    expect(stripInlineAgentTruncationSuffix('abc\n...[truncated]')).toBe('abc');
    // Salvaged block: marker inside, closing fence after.
    expect(stripInlineAgentTruncationSuffix('abc\n...[truncated]\n' + '````')).toBe('abc');
    expect(stripInlineAgentTruncationSuffix('abc')).toBe('abc');
    expect(stripInlineAgentTruncationSuffix('')).toBe('');
  });

  it('resolves marker-truncated step prefixes as the same answer', () => {
    // The stream redesign dedup: the last step streamed the final turn clamped
    // at 8000 chars (carrying `...[truncated]`), the finalText is the full
    // turn. The resolver must still recognize the same origin so the partial
    // narration is replaced instead of duplicated.
    expect(resolveInlineAgentAnswerText('完整回答正文。', '完整回答正\n...[truncated]'))
      .toEqual({ answer: '完整回答正文。', fromStep: false });

    // Code-blockified forms: a salvaged truncated artifact block ends with the
    // marker + closing fence; the complete answer has the full content.
    const answer = '**demo.html**\n\n````html\n<h1>Hi</h1>\n<p>完整</p>\n````';
    const step = '**demo.html**\n\n````html\n<h1>Hi</h1>\n<p>完\n...[truncated]\n````';
    expect(resolveInlineAgentAnswerText(answer, step))
      .toEqual({ answer, fromStep: false });
  });

  it('summarizes tool-call parameters for single-line entries', () => {
    expect(summarizeInlineAgentToolParams({ query: '天气' })).toBe('天气');
    expect(summarizeInlineAgentToolParams({ filename: 'demo.html', content: '<h1>x</h1>' })).toBe('demo.html');
    expect(summarizeInlineAgentToolParams({ url: 'https://example.com' })).toBe('https://example.com');
    expect(summarizeInlineAgentToolParams({})).toBeNull();
    expect(summarizeInlineAgentToolParams(null)).toBeNull();
    expect(summarizeInlineAgentToolParams(['x'])).toBeNull();
    const long = summarizeInlineAgentToolParams({ query: 'q'.repeat(500) });
    expect(long?.length).toBeLessThan(150);
    expect(long?.endsWith('…')).toBe(true);
  });

  it('bounds error payloads in windowed and full tool results', () => {
    const bigError = {
      code: 'shell_exit_nonzero',
      message: 'E'.repeat(2_000),
      retryable: true,
      details: { huge: 'x'.repeat(50_000) },
    };
    const executions = [
      { ...FAILED_EXECUTION, result: { ...FAILED_EXECUTION.result, error: bigError } },
      ...Array.from({ length: 5 }, (_, index) => ({
        ...SUCCESS_EXECUTION,
        result: { ...SUCCESS_EXECUTION.result, summary: `Execution ${index + 2}` },
      })),
    ];

    const prompt = buildContinuationPrompt('Run all six steps.', executions, 'en');
    const resultJson = prompt.match(/<tool_results>\n([\s\S]*?)\n<\/tool_results>/)?.[1] ?? '[]';
    const results = JSON.parse(resultJson) as Array<Record<string, unknown>>;

    const windowed = results[0];
    expect(windowed.windowed).toBe(true);
    expect(windowed.error).toEqual({
      code: 'shell_exit_nonzero',
      message: 'E'.repeat(400) + '\n...[truncated]',
      retryable: true,
    });
    expect((windowed.error as Record<string, unknown>).details).toBeUndefined();

    const full = results[results.length - 1];
    expect(full.windowed).toBeUndefined();
    expect(full.error).toBeUndefined();
    expect((full as Record<string, unknown>).detail).toContain('One result');
  });

  it('counts the first real nudge correction as attempt 1', () => {
    const english = buildNudgePrompt('Ship it', 'I will continue.', [SUCCESS_EXECUTION], 1, 'en');
    const chinese = buildNudgePrompt('发货', '我会继续。', [SUCCESS_EXECUTION], 1, 'zh-CN');

    expect(english).toContain('This is no-tool-call correction attempt 1.');
    expect(chinese).toContain('这是第 1 次无工具调用纠偏。');
  });

  it('keeps recent tool results full and compresses older executions', () => {
    const executions = Array.from({ length: 6 }, (_, index) => ({
      ...SUCCESS_EXECUTION,
      name: index % 2 === 0 ? 'web_search' : 'mcp_tool',
      provider: index % 2 === 0 ? SUCCESS_EXECUTION.provider : FAILED_EXECUTION.provider,
      result: {
        ...SUCCESS_EXECUTION.result,
        ok: index !== 3,
        summary: `Execution ${index + 1}`,
        detail: `Detail ${index + 1}`,
      },
    }));

    const prompt = buildContinuationPrompt('Run all six steps.', executions, 'en');
    const resultJson = prompt.match(/<tool_results>\n([\s\S]*?)\n<\/tool_results>/)?.[1] ?? '[]';
    const results = JSON.parse(resultJson) as Array<Record<string, unknown>>;

    expect(results).toHaveLength(6);
    const firstTwo = results.slice(0, INLINE_AGENT_FULL_TOOL_RESULT_WINDOW - 2);
    const lastFour = results.slice(-INLINE_AGENT_FULL_TOOL_RESULT_WINDOW);

    for (const entry of firstTwo) {
      expect(entry.windowed).toBe(true);
      expect(entry.detail).toBeUndefined();
      expect(entry.output).toBeUndefined();
      expect(entry.summary).toContain('Execution');
    }
    for (const entry of lastFour) {
      expect(entry.windowed).toBeUndefined();
      expect(entry.detail).toBe('Detail ' + (results.indexOf(entry) + 1));
      expect(entry.error).toBeUndefined();
    }
    expect(results[3].ok).toBe(false);
  });

  it('detects inline-agent continuation prompts as internal requests', () => {
    const continuation = buildContinuationPrompt('查港股行情', [SUCCESS_EXECUTION], 'zh-CN');
    const nudge = buildNudgePrompt('查港股行情', 'I will continue.', [SUCCESS_EXECUTION], 0, 'en');

    expect(isInlineAgentContinuationPrompt(continuation)).toBe(true);
    expect(isInlineAgentContinuationPrompt(nudge)).toBe(true);
    expect(isInlineAgentContinuationPrompt('<original_task>user text</original_task>')).toBe(false);
    expect(isInlineAgentContinuationPrompt('普通用户提问：帮我搜索港股行情')).toBe(false);
  });

  it('detects continuation bubbles structurally even when DeepSeek chrome dilutes the keywords', () => {
    // Live DOM text may interleave DeepSeek's own chrome (timestamps, action
    // rows) with the continuation prompt, so the strict keyword check misses.
    // The paired tags alone are a strong enough signal for DOM-layer hiding.
    const diluted = [
      '刚刚',
      '<original_task>查港股行情</original_task>',
      '<tool_results>[{"tool":"web_search","ok":true}]</tool_results>',
    ].join('\n');
    const dilutedNudge = [
      '<original_task>查港股行情</original_task>',
      '<tool_results_so_far>[{"tool":"web_search","ok":true}]</tool_results_so_far>',
    ].join('\n');

    expect(isInlineAgentContinuationStructure(diluted)).toBe(true);
    expect(isInlineAgentContinuationStructure(dilutedNudge)).toBe(true);
    // Strict detector misses the diluted text (no continuation keywords)...
    expect(isInlineAgentContinuationPrompt(diluted)).toBe(false);
    // ...but still guards the API-layer cleanup for intact prompt text.
    expect(isInlineAgentContinuationPrompt(buildContinuationPrompt('查港股行情', [SUCCESS_EXECUTION], 'zh-CN'))).toBe(true);

    // A real user message carrying only one half of the pair is not hidden.
    expect(isInlineAgentContinuationStructure('<original_task>我的任务</original_task>')).toBe(false);
    expect(isInlineAgentContinuationStructure('<tool_results>结果</tool_results>')).toBe(false);
    expect(isInlineAgentContinuationStructure('帮我把这段代码重构一下')).toBe(false);
  });

  it('renders task_complete control blocks as their user-visible summary', () => {
    const text = [
      'before',
      '<task_complete>{"summary":"任务已经完成。","artifacts":["demo.html"]}</task_complete>',
      'after',
    ].join('\n');

    expect(replaceTaskCompleteBlocks(text)).toBe('before\n任务已经完成。\nafter');
  });

  it('removes dangling leading punctuation from stripped tool-prefixed final answers', () => {
    expect(normalizeInlineAgentFinalAnswerText('，用户想了解港股的走势。')).toBe('用户想了解港股的走势。');
    expect(normalizeInlineAgentFinalAnswerText(', final answer is ready.')).toBe('final answer is ready.');
    expect(normalizeInlineAgentFinalAnswerText('。；：结论如下。')).toBe('结论如下。');
  });

  it('nudges only when the visible tail is still asking to continue tool work', () => {
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我会调用 web_search 获取最新行情。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], 'I still need to call search next.')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我想下载这份报告。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '我打算先核对一下刚才的结果。')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], "I'm going to look up the latest price.")).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], 'I need to check the file now.')).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], "Let's fetch the second page.")).toBe(true);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], 'I will summarize the findings now.')).toBe(false);

    const answerAfterPlanning = [
      '要求查看贵金属走势，之前的搜索已经提供了一些结果。我需要基于这些结果给出一个全面的回答。',
      '为了更全面地获取信息，我将同时打开这些相关的链接。',
      '',
      '根据截至2026年6月下旬的多份市场分析，贵金属市场已经进入高位震荡与分化阶段。',
      '',
      '### 黄金',
      '黄金短期震荡，但长期逻辑仍受央行购金和避险需求支撑。',
      '',
      '### 白银',
      '白银受工业需求驱动，波动弹性高于黄金。',
      '',
      '总的来看，黄金偏震荡，白银和铂金更受产业需求影响。',
    ].join('\n');

    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], answerAfterPlanning)).toBe(false);
    expect(shouldNudge('查行情', [SUCCESS_EXECUTION], '根据搜索结果，恒生指数今日下跌，市场风险偏好偏弱。')).toBe(false);
  });
});

describe('automation model prompts', () => {
  it('localizes automation continuation prompts and preserves tool_results tags', () => {
    const english = buildAutomationToolContinuationPrompt([SUCCESS_EXECUTION], 'en');
    const chinese = buildAutomationToolContinuationPrompt([SUCCESS_EXECUTION], 'zh-CN');

    expect(english).toContain('MCP tool results just executed for the automation');
    expect(english).toContain('<tool_results>');
    expect(english).toContain('</tool_results>');
    expect(chinese).toContain('以下是自动化任务刚刚执行的 MCP 工具结果');
    expect(chinese).toContain('<tool_results>');
  });
});
