import { describe, expect, it } from 'vitest';
import {
  findAssistantMessageByContentSnippet,
  getAssistantMessageOwnText,
} from '../core/inline-agent/message-anchor';

function buildMessage(ownText: string, injected?: string): HTMLElement {
  const message = document.createElement('div');
  message.className = 'ds-message';
  const host = document.createElement('div');
  host.className = 'ds-markdown';
  host.textContent = ownText;
  message.appendChild(host);
  if (injected) {
    const console_ = document.createElement('div');
    console_.className = 'dpp-agent-container';
    console_.textContent = injected;
    host.appendChild(console_);
  }
  return message;
}

describe('findAssistantMessageByContentSnippet (Issue #551 follow-up)', () => {
  const snippet = '用户要求重新绘制 Anthropic ARR 折线图，需要先获取最新数据。';

  it('anchors to the newest matching message, never an older one', () => {
    const older = buildMessage(`旧轮次：${snippet}`);
    const newer = buildMessage(`新一轮：${snippet}`);
    expect(findAssistantMessageByContentSnippet([older, newer], snippet, new Set())).toBe(newer);
  });

  it('ignores text inside injected agent consoles when matching', () => {
    // The old run's message contains the snippet only inside its injected
    // console timeline — it must not claim the new run's anchor.
    const oldWithConsole = buildMessage('旧轮次回答内容', `Step 1 ${snippet} Step 2`);
    const freshText = '我先调用工具获取最新的月度数据。';
    const fresh = buildMessage(freshText);
    const messages = [oldWithConsole, fresh];
    expect(
      findAssistantMessageByContentSnippet(messages, snippet, new Set([fresh])),
    ).toBeNull();
    expect(
      findAssistantMessageByContentSnippet(messages, freshText, new Set()),
    ).toBe(fresh);
  });

  it('skips messages already claimed via usedMessages', () => {
    const claimed = buildMessage(`旧轮次：${snippet}`);
    const fresh = buildMessage(`新一轮：${snippet}`);
    expect(
      findAssistantMessageByContentSnippet([claimed, fresh], snippet, new Set([claimed])),
    ).toBe(fresh);
  });

  it('returns null for snippets shorter than 12 normalized chars', () => {
    const message = buildMessage('短文本');
    expect(findAssistantMessageByContentSnippet([message], '短文本', new Set())).toBeNull();
  });
});

describe('getAssistantMessageOwnText', () => {
  it('excludes console, final-answer, tool-block, and autosave-note subtrees', () => {
    const message = buildMessage('消息正文');
    const host = message.querySelector('.ds-markdown')!;
    const answer = document.createElement('div');
    answer.setAttribute('data-dpp-body-text', 'true');
    answer.textContent = '最终答案区';
    const toolBlock = document.createElement('div');
    toolBlock.className = 'dpp-tool-block';
    toolBlock.textContent = '已执行工具 3 次';
    const note = document.createElement('div');
    note.className = 'dpp-agent-autosave-note';
    note.textContent = '已自动保存';
    host.append(answer, toolBlock, note);

    const ownText = getAssistantMessageOwnText(message);
    expect(ownText).toContain('消息正文');
    expect(ownText).not.toContain('最终答案区');
    expect(ownText).not.toContain('已执行工具');
    expect(ownText).not.toContain('已自动保存');
  });
});
