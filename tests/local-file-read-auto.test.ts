// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error 宿主 file-provider.mjs 为纯 JS 实现，无类型声明文件
import { readTextFileWindow } from '../packages/shell-host/native/file-provider.mjs';
import { callLocalFileReadAuto } from '../core/mcp/client';
import type { McpServerConfig, McpProtocolTransport, McpCallToolResult } from '../core/mcp/types';

function makeTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lfr-'));
  const p = join(dir, 'sample.txt');
  writeFileSync(p, content, 'utf8');
  return p;
}

function makeServer(): McpServerConfig {
  return {
    id: 's', displayName: 's', enabled: true, transport: { kind: 'stdio_bridge' },
    timeouts: { connectMs: 0, requestMs: 30000, discoveryMs: 0 },
    limits: { maxResultBytes: 64000, maxToolCount: 100 },
    version: 1, status: 'ready', lastConnectedAt: null, lastError: null,
    createdAt: 0, updatedAt: 0, headers: [], secrets: [],
    allowlist: { mode: 'all', toolNames: [] },
    execution: { mode: 'local', enabled: true },
  } as unknown as McpServerConfig;
}

function makeTransport(windows: McpCallToolResult[]): McpProtocolTransport {
  let i = 0;
  const request = async () => {
    const result = windows[i] ?? windows[windows.length - 1];
    i++;
    return { jsonrpc: '2.0', id: 1, result } as unknown as Awaited<ReturnType<McpProtocolTransport['request']>>;
  };
  return { request } as unknown as McpProtocolTransport;
}

function windowResult(content: string, nextStart: number, totalChars: number, truncated: boolean): McpCallToolResult {
  return {
    content: [{ type: 'text', text: `Read ${content.length} characters` }],
    structuredContent: { data: { path: '/x', content, start: 0, nextStart, maxChars: content.length, totalChars, truncated } },
  };
}

describe('readTextFileWindow (宿主防 OOM)', () => {
  it('中文混排无乱码且窗口连续拼接等于原文', () => {
    const mixed = 'Hello 世界 🌍 中文测试 abc 混合内容 12345 emoji😀 结尾';
    const totalChars = Array.from(mixed).length;
    const path = makeTempFile(mixed);
    const window = 5;
    let acc = '';
    let start = 0;
    let guard = 0;
    while (guard < 1000) {
      guard++;
      const { content, totalChars: tc, charsRead } = readTextFileWindow(path, start, window);
      expect(tc).toBe(totalChars);
      // 回归保护：charsRead 必须与返回内容的 Unicode 码点数一致（emoji 代理对场景下 UTF-16 length 会偏高）
      expect(charsRead).toBe(Array.from(content).length);
      acc += content;
      // 按 Unicode 码点单位推进（与宿主 nextStart = start + charsRead 同单位）
      start += charsRead;
      if (charsRead < window) break;
    }
    expect(acc).toBe(mixed);
  });

  it('首窗从 0 读取返回正确字符数', () => {
    const s = 'abcdefghij';
    const path = makeTempFile(s);
    const { content, totalChars } = readTextFileWindow(path, 0, 3);
    expect(content).toBe('abc');
    expect(totalChars).toBe(10);
  });

  it('start 超出文件字符数返回空且 totalChars 正确', () => {
    const s = 'abc';
    const path = makeTempFile(s);
    const { content, totalChars } = readTextFileWindow(path, 100, 10);
    expect(content).toBe('');
    expect(totalChars).toBe(3);
  });

  it('中等大文件（约 5MB）按需读取不整文件入内存，窗口正确', () => {
    const unit = '中a🌍'; // 4 字符 ≈ 9 字节
    const repeat = 580_000; // ≈ 5MB
    const big = unit.repeat(repeat);
    const path = makeTempFile(big);
    const totalChars = Array.from(big).length;
    const mid = Math.floor(totalChars / 2);
    const { content, totalChars: tc } = readTextFileWindow(path, mid, 100);
    expect(tc).toBe(totalChars);
    expect(content).toBe(Array.from(big).slice(mid, mid + 100).join(''));
  });
});

describe('callLocalFileReadAuto (扩展侧 auto 续读)', () => {
  const server = makeServer();
  const call = { name: 'local_file_read', payload: { path: '/x' } } as never;

  it('循环读取直到 truncated=false，contents 长度正确', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 12, true),
      windowResult('BBBB', 8, 12, true),
      windowResult('CCCC', 12, 12, false),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(true);
    const data = (result.output as { data: { contents: string[]; windows: number; totalChars: number; truncated: boolean } }).data;
    expect(data.contents).toEqual(['AAAA', 'BBBB', 'CCCC']);
    expect(data.windows).toBe(3);
    expect(data.totalChars).toBe(12);
    expect(data.truncated).toBe(false);
  });

  it('nextStart 不前进时 fail-closed', async () => {
    const transport = makeTransport([
      windowResult('AAAA', 4, 12, true),
      windowResult('BBBB', 4, 12, true),
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
    const data = (result.output as { data: { contents: string[] } }).data;
    expect(data.contents.length).toBe(2);
  });

  it('窗口内容非字符串时 fail-closed', async () => {
    const transport = makeTransport([
      { structuredContent: { data: { truncated: true, nextStart: 4 } } } as McpCallToolResult,
    ]);
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
  });

  it('单窗调用失败时 fail-closed', async () => {
    const transport = {
      request: async () => {
        throw new Error('boom');
      },
    } as unknown as McpProtocolTransport;
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
  });

  it('窗口数达上限时 fail-closed（不静默谎报成功）', async () => {
    // 模拟超大文件：每窗均 truncated=true 且 nextStart 持续前进，直到 AUTO_READ_MAX_WINDOWS(1000) 耗尽。
    // 验证 M1 修复：此时必须 ok:false 且 truncated:true，而非谎报成功（fail-open）。
    const WINDOW = 'A'.repeat(12000);
    let i = 0;
    const transport = {
      request: async () => {
        i++;
        return {
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [{ type: 'text', text: `Read ${WINDOW.length} characters` }],
            structuredContent: {
              data: {
                path: '/x',
                content: WINDOW,
                start: (i - 1) * 12000,
                nextStart: i * 12000,
                maxChars: 12000,
                totalChars: 12_000_000,
                truncated: true,
              },
            },
          },
        } as unknown as Awaited<ReturnType<McpProtocolTransport['request']>>;
      },
    } as unknown as McpProtocolTransport;
    const result = await callLocalFileReadAuto(server, transport, { call } as never);
    expect(result.ok).toBe(false);
    const data = (result.output as { data: { contents: string[]; truncated: boolean } }).data;
    expect(data.truncated).toBe(true);
    expect(data.contents.length).toBe(1000);
  });
});
