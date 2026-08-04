import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createArtifactToolDescriptors } from '../core/artifact';
import type { InlineAgentStartPayload } from '../core/inline-agent/types';
import type { ToolExecutionRecord } from '../core/types';

const adapterMocks = vi.hoisted(() => ({
  createPowHeaders: vi.fn(),
  submitPromptStreaming: vi.fn(),
}));

vi.mock('../core/deepseek/adapter', () => ({
  createClientHeaders: () => ({ Authorization: 'Bearer test-token' }),
  createPowHeaders: adapterMocks.createPowHeaders,
  submitPromptStreaming: adapterMocks.submitPromptStreaming,
}));

const { runInlineAgentLoop } = await import('../core/inline-agent/loop');

function abortAwarePendingTurn(signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  }
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

describe('runInlineAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adapterMocks.createPowHeaders.mockResolvedValue({ 'X-DS-PoW-Response': 'pow-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reuses a natural no-tool answer instead of injecting a final-answer round', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Done after tool result.');
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: 'Done after tool result.',
      totalTools: 1,
    }));
  });

  it('keeps sending searchEnabled: true on continuation requests', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Done after tool result.');
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop({
      ...createPayload(),
      promptOptions: {
        ...createPayload().promptOptions,
        searchEnabled: true,
      },
    }, {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(adapterMocks.submitPromptStreaming.mock.calls[0]?.[0]).toMatchObject({
      searchEnabled: true,
    });
  });

  it('does not replay the same step when planning text is followed by a complete answer', async () => {
    const answer = [
      '要求查看贵金属走势，之前的搜索已经提供了一些结果。我需要基于这些结果给出一个全面的回答。',
      '为了更全面地获取信息，我将同时打开这些相关的链接。',
      '',
      '根据截至2026年6月下旬的多份市场分析，贵金属市场在经历前期暴涨后，已进入高位震荡与分化的新阶段。',
      '',
      '### 黄金',
      '黄金短期震荡，但长期逻辑仍受央行购金和避险需求支撑。',
      '',
      '总的来看，黄金偏震荡，白银和铂金更受产业需求影响。',
    ].join('\n');

    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk(answer);
      return {
        assistantText: '',
        responseMessageId: 102,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: answer,
      totalSteps: 1,
      totalTools: 1,
    }));
  });

  it('pauses instead of presenting pending nudge text as the final answer', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I will call search next.');
        return {
          assistantText: '',
          responseMessageId: 102,
          requestMessageId: 101,
          finished: true,
        };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I still need to call search next.');
        return {
          assistantText: '',
          responseMessageId: 104,
          requestMessageId: 103,
          finished: true,
        };
      });

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(7000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(adapterMocks.submitPromptStreaming.mock.calls[1]?.[0].prompt)
      .toContain('This is no-tool-call correction attempt 1.');
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: expect.stringContaining('paused after 25 automated tool-continuation rounds'),
      totalTools: 1,
    }));
    expect(post).not.toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: 'I still need to call search next.',
    }));
  });

  it('completes with the streamed text when the response omits a continuable message id', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('Here is the final answer.');
      return {
        assistantText: '',
        responseMessageId: null,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: 'Here is the final answer.',
      totalSteps: 1,
    }));
  });

  it('fails visibly when the response is empty and omits a continuable message id', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async () => ({
      assistantText: '',
      responseMessageId: null,
      requestMessageId: 101,
      finished: true,
    }));

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: expect.stringContaining('empty agent continuation'),
    }));
  });

  it('refuses to execute tool calls returned without a continuable message id', async () => {
    adapterMocks.submitPromptStreaming.mockImplementationOnce(async (_input, handlers) => {
      handlers.onTextChunk('<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>');
      return {
        assistantText: '',
        responseMessageId: null,
        requestMessageId: 101,
        finished: true,
      };
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    await runInlineAgentLoop({
      ...createPayload(),
      toolDescriptors: createArtifactToolDescriptors('en'),
    }, {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: expect.stringContaining('without a continuable response message'),
    }));
  });

  it('refuses to execute nudge tool calls returned without a continuable message id', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('I will call artifact_create next.');
        return {
          assistantText: '',
          responseMessageId: 102,
          requestMessageId: 101,
          finished: true,
        };
      })
      .mockImplementationOnce(async (_input, handlers) => {
        handlers.onTextChunk('<artifact_create>{"filename":"a.txt","content":"ok"}</artifact_create>');
        return {
          assistantText: '',
          responseMessageId: null,
          requestMessageId: 103,
          finished: true,
        };
      });

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop({
      ...createPayload(),
      toolDescriptors: createArtifactToolDescriptors('en'),
    }, {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(7000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(executeTool).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: expect.stringContaining('nudge tool calls without a continuable response message'),
    }));
  });

  it('retries a timed-out step once when no text was received, then reports the timeout', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, _handlers, signal) =>
      abortAwarePendingTurn(signal));

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(7_000);
    await vi.advanceTimersByTimeAsync(120_000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: 'DeepSeek agent step timed out after retry.',
    }));
  });

  it('does not retry a timed-out step after text was already received', async () => {
    vi.useFakeTimers();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, handlers, signal) => {
      handlers.onTextChunk('partial answer...');
      return abortAwarePendingTurn(signal);
    });

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(120_000);
    await run;

    expect(adapterMocks.submitPromptStreaming).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.objectContaining({
      error: 'DeepSeek agent step timed out while streaming; the response was interrupted.',
    }));
  });

  it('keeps a user abort mid-step silent with an empty final text', async () => {
    const controller = new AbortController();
    adapterMocks.submitPromptStreaming.mockImplementation((_input, _handlers, signal) =>
      abortAwarePendingTurn(signal));

    const post = vi.fn();
    const executeTool = vi.fn();

    const run = runInlineAgentLoop(createPayload(), {
      post,
      executeTool,
      signal: controller.signal,
    });
    controller.abort();
    await run;

    expect(post).toHaveBeenCalledWith('AGENT_LOOP_COMPLETE', expect.objectContaining({
      finalText: '',
      totalSteps: 0,
    }));
    expect(post).not.toHaveBeenCalledWith('AGENT_LOOP_ERROR', expect.anything());
  });
});

function createPayload(): InlineAgentStartPayload {
  return {
    loopId: 'loop-1',
    chatSessionId: 'chat-1',
    parentMessageId: 100,
    originalPrompt: 'Use the tool and summarize the result.',
    agentTaskPrompt: 'Use the tool and summarize the result.',
    toolExecutions: [SUCCESS_EXECUTION],
    promptOptions: {
      modelType: null,
      searchEnabled: false,
      thinkingEnabled: false,
      refFileIds: [],
    },
    toolDescriptors: [],
    locale: 'en',
  };
}

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
    summary: 'Search completed',
    output: [{ title: 'Result', url: 'https://example.com' }],
  },
};
