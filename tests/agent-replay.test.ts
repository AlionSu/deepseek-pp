import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_REPLAY_REGISTRATION_TTL_MS,
  buildAgentReplaySse,
  isAgentReplayRegistration,
  matchAgentReplayRegistration,
  type AgentReplayRegistration,
} from '../core/interceptor/agent-replay';
import {
  hookFetch,
  hookXHR,
  registerPendingAgentReplay,
  type RequestBodyModification,
  updateHookState,
} from '../core/interceptor/fetch-hook';
import type { DeepSeekAugmentableWebRoute } from '../core/deepseek/request-codec';

const registration: AgentReplayRegistration = {
  chatSessionId: 'session-1',
  prompt: '<original_task>task</original_task>\n<tool_results>[]</tool_results>',
  content: '```mermaid\nxychart-beta\n    line [1, 2, 3]\n```\n\n```html\n<h1>Hi</h1>\n```',
  reasoning: '我先分析再回答。',
  responseMessageId: 42,
  createdAt: 1786000000000,
};

describe('agent replay registration', () => {
  it('matches only the exact session + prompt pair', () => {
    expect(matchAgentReplayRegistration(
      JSON.stringify({ chat_session_id: 'session-1', prompt: registration.prompt }),
      registration,
    )).toBe(true);
    expect(matchAgentReplayRegistration(
      JSON.stringify({ chat_session_id: 'session-2', prompt: registration.prompt }),
      registration,
    )).toBe(false);
    expect(matchAgentReplayRegistration(
      JSON.stringify({ chat_session_id: 'session-1', prompt: `${registration.prompt} extra` }),
      registration,
    )).toBe(false);
    expect(matchAgentReplayRegistration('not-json', registration)).toBe(false);
    expect(matchAgentReplayRegistration(JSON.stringify({ chat_session_id: 'session-1', prompt: registration.prompt }), null)).toBe(false);
  });

  it('validates the trust-boundary shape fail-closed', () => {
    expect(isAgentReplayRegistration(registration)).toBe(true);
    expect(isAgentReplayRegistration({ ...registration, content: 7 })).toBe(false);
    expect(isAgentReplayRegistration({ ...registration, prompt: '' })).toBe(false);
    expect(isAgentReplayRegistration({ ...registration, responseMessageId: 1.5 })).toBe(false);
    expect(isAgentReplayRegistration(null)).toBe(false);
  });
});

describe('agent replay synthetic SSE', () => {
  it('emits the released wire shape with a THINK fragment then the answer', () => {
    const sse = buildAgentReplaySse(registration, 7);

    expect(sse).toContain('event: ready');
    expect(sse).toContain('"response_message_id":42');
    expect(sse).not.toContain('request_message_id');
    expect(sse).toContain('"thinking_enabled":true');
    expect(sse).toContain('"type":"THINK"');
    expect(sse).toContain('"parent_id":7');
    expect(sse).toContain('"status":"WIP"');
    expect(sse).toContain('"p":"response/fragments/-1/elapsed_secs","o":"SET"');
    expect(sse).toContain('"type":"RESPONSE"');
    expect(sse).toContain('"quasi_status","v":"FINISHED"');
    expect(sse).toContain('"p":"response/status","o":"SET","v":"FINISHED"');
    expect(sse).toContain('event: close');
    expect(sse).toContain('"click_behavior":"none","auto_resume":false');

    // Reasoning and answer content are both present, chunked.
    expect(sse).toContain('我先分析再回答。');
    expect(sse).toContain('<h1>Hi</h1>');
  });

  it('emits a thinking-free response when the turn had no reasoning', () => {
    const sse = buildAgentReplaySse({ ...registration, reasoning: '' }, null);
    expect(sse).toContain('"thinking_enabled":false');
    expect(sse).not.toContain('"type":"THINK"');
    expect(sse).not.toContain('"p":"response/fragments/-1/elapsed_secs","o":"SET"');
    expect(sse).toContain('"type":"RESPONSE"');
  });
});

describe('fetch hook agent replay short-circuit', () => {
  const onRequestTerminal = vi.fn();
  const onResponseComplete = vi.fn();
  const onRequestBody = vi.fn<(
    body: string,
    requestId: string,
    route: DeepSeekAugmentableWebRoute,
  ) => Promise<RequestBodyModification | null>>(async () => null);

  beforeEach(() => {
    for (const mock of [onRequestTerminal, onResponseComplete, onRequestBody]) mock.mockReset();
    updateHookState({
      toolDescriptors: [],
      onRequestTerminal,
      onResponseComplete,
      onRequestBody,
      onResponseTokenSpeed: () => {},
      onToolCall: () => {},
      onToolCallChunk: () => {},
      onToolCallStarted: () => {},
      onToolCallsRestored: () => {},
      onHeadersCaptured: () => {},
      onMemoriesUsed: () => {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves the synthetic response instead of hitting the network', async () => {
    const nativeFetch = window.fetch;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }));
    window.fetch = fetchImpl;
    try {
      const uninstall = hookFetch();
      try {
        registerPendingAgentReplay(registration);
        const body = JSON.stringify({ chat_session_id: 'session-1', prompt: registration.prompt });
        const response = await window.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
          method: 'POST',
          body,
        });

        expect(fetchImpl).not.toHaveBeenCalled();
        expect(onRequestBody).not.toHaveBeenCalled();
        expect(onResponseComplete).not.toHaveBeenCalled();
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/event-stream');
        const text = await response.text();
        expect(text).toContain('"response_message_id":42');
        expect(text).toContain('"type":"RESPONSE"');
      } finally {
        uninstall();
      }
    } finally {
      window.fetch = nativeFetch;
    }
  });

  it('passes non-matching requests through untouched', async () => {
    const nativeFetch = window.fetch;
    const fetchImpl = vi.fn(async () => new Response('data: {"v":"real"}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));
    window.fetch = fetchImpl;
    try {
      const uninstall = hookFetch();
      try {
        registerPendingAgentReplay(registration);
        const response = await window.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
          method: 'POST',
          body: JSON.stringify({ chat_session_id: 'session-1', prompt: 'user typed something else' }),
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(await response.text()).toBe('data: {"v":"real"}\n\n');
      } finally {
        uninstall();
      }
    } finally {
      window.fetch = nativeFetch;
    }
  });

  it('expires the registration after the TTL', async () => {
    vi.useFakeTimers();
    registerPendingAgentReplay(registration);
    vi.advanceTimersByTime(AGENT_REPLAY_REGISTRATION_TTL_MS + 1);
    const body = JSON.stringify({ chat_session_id: 'session-1', prompt: registration.prompt });
    expect(matchAgentReplayRegistration(body, registration)).toBe(true);
    // The hook state cleared it: a matching request must go through.
    // (Registering again with the same shape and advancing once more.)
    const nativeFetch = window.fetch;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    window.fetch = fetchImpl;
    try {
      const uninstall = hookFetch();
      try {
        const response = await window.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
          method: 'POST',
          body,
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(response.status).toBe(200);
      } finally {
        uninstall();
      }
    } finally {
      window.fetch = nativeFetch;
    }
  });
});

describe('fetch hook agent replay XHR short-circuit', () => {
  it('serves the synthetic stream through the XHR lifecycle without network send', async () => {
    const nativeXMLHttpRequest = globalThis.XMLHttpRequest;
    class FakeXMLHttpRequest extends EventTarget {
      readyState = 0;
      status = 0;
      responseType: XMLHttpRequestResponseType = '';
      sentBody: unknown = undefined;
      get responseText() { return ''; }
      get response() { return ''; }
      open() { this.readyState = 1; this.dispatchEvent(new Event('readystatechange')); }
      setRequestHeader() {}
      send(body?: unknown) { this.sentBody = body; }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest as unknown as typeof XMLHttpRequest);

    try {
      const uninstall = hookXHR();
      try {
        registerPendingAgentReplay(registration);
        const xhr = new XMLHttpRequest();
        let received = '';
        xhr.addEventListener('readystatechange', () => {
          if (xhr.readyState >= 3) received = xhr.responseText;
        });
        xhr.open('POST', 'https://chat.deepseek.com/api/v0/chat/completion');
        xhr.send(JSON.stringify({ chat_session_id: 'session-1', prompt: registration.prompt }));

        // The replay path never touches the network send.
        expect((xhr as unknown as { sentBody: unknown }).sentBody).toBeUndefined();
        expect(received).toContain('event: ready');
        expect(received).toContain('"response_message_id":42');
        expect(received).toContain('"type":"RESPONSE"');
        expect(received).toContain('event: close');
      } finally {
        uninstall();
      }
    } finally {
      vi.stubGlobal('XMLHttpRequest', nativeXMLHttpRequest);
    }
  });
});
