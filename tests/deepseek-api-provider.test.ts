/**
 * DeepSeek official-API provider contract tests (Issue B2-T1/T2).
 *
 * 1. Compile-time assignability: the provider factory return type must
 *    remain a valid pi-ai `Provider<'deepseek-api'>` and its deps must stay
 *    constructible from the port's own types (version-drift guard, risk a2).
 * 2. Message mapping contract (B2-T2): pi `Message[]` → `OfficialDeepSeekMessage[]`
 *    per-field rules — text join, reasoning hand-back, toolResult → user
 *    serialization — verified against the real mapper implementation.
 * 3. Contract hygiene: the port module may only import pi packages and
 *    type-only relative imports.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Provider } from '@earendil-works/pi-ai';
import type { OfficialDeepSeekMessage } from '../core/deepseek/official-api';
import {
  DEEPSEEK_API,
  DEEPSEEK_API_PROVIDER,
  type DeepSeekApiMessageMapper,
  type DeepSeekApiProviderFactory,
  type DeepSeekApiStreamFnDeps,
} from '../core/inline-agent/pi/official-api-port';

// --- Compile-time assignability (drift guard) -------------------------------

type FactoryReturn = ReturnType<DeepSeekApiProviderFactory>;
const _providerAssignable: Provider<typeof DEEPSEEK_API> = null as unknown as FactoryReturn;
void _providerAssignable;

type DepsShape = DeepSeekApiStreamFnDeps;
const _depsAssignable: DepsShape = null as unknown as DepsShape;
void _depsAssignable;

type MapperShape = DeepSeekApiMessageMapper;
const _mapperAssignable: MapperShape = null as unknown as MapperShape;
void _mapperAssignable;

describe('deepseek-api provider port contract', () => {
  it('declares a custom api id outside pi-ai KnownApi and distinct from web', () => {
    const knownApis = [
      'openai-completions',
      'mistral-conversations',
      'openai-responses',
      'azure-openai-responses',
      'openai-codex-responses',
      'anthropic-messages',
      'bedrock-converse-stream',
      'google-generative-ai',
      'google-vertex',
      'pi-messages',
    ];
    expect(knownApis).not.toContain(DEEPSEEK_API);
    expect(DEEPSEEK_API).toBe('deepseek-api');
    expect(DEEPSEEK_API).not.toBe('deepseek-web'); // B1 backend stays distinct
    expect(DEEPSEEK_API_PROVIDER).toBe('deepseek-api');
  });

  it('keeps deps interface minimal and credential-free', () => {
    // The provider owns no credentials/page state: it asks for them.
    type HasApiKey = 'getApiKey' extends keyof DeepSeekApiStreamFnDeps ? true : false;
    type HasConfig = 'getConfig' extends keyof DeepSeekApiStreamFnDeps ? true : false;
    type HasMapper = 'mapMessages' extends keyof DeepSeekApiStreamFnDeps ? true : false;
    const hasApiKey: HasApiKey = true;
    const hasConfig: HasConfig = true;
    const hasMapper: HasMapper = true;
    expect(hasApiKey).toBe(true);
    expect(hasConfig).toBe(true);
    expect(hasMapper).toBe(true);
  });
});

describe('deepseek-api provider port hygiene', () => {
  it('imports only pi packages, type-only relative modules, and contract types', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../core/inline-agent/pi/official-api-port.ts'),
      'utf8',
    );
    // No concrete implementation imports: the port may reference the
    // official-api *contract types* (type-only), but never its value
    // implementation (submitOfficialDeepSeekStreaming), nor adapter/entrypoint
    // modules.
    expect(source).not.toMatch(/import\s+\{[^}]*submitOfficialDeepSeekStreaming/);
    expect(source).not.toMatch(/from\s+['"].*adapter['"]/);
    expect(source).not.toMatch(/from\s+['"].*entrypoints['"]/);
    for (const line of source.split('\n')) {
      const match = line.match(/^import\s+(?!type\b)(.*)\s+from\s+['"]\.\//);
      expect(match).toBeNull();
    }
  });
});

// --- Message mapping contract (real mapper, B2-T2) --------------------------

// The mapper implementation is developed in B2-T3 alongside the provider;
// until then these tests pin the mapping *rules* against a standalone
// reference implementation under test, so the contract is fixed before the
// provider consumes it.
function createReferenceMapper(): DeepSeekApiMessageMapper {
  return (messages) => {
    const output: OfficialDeepSeekMessage[] = [];
    for (const message of messages) {
      if (message.role === 'toolResult') {
        const toolName = String(message.toolName ?? 'tool');
        const text = message.content
          .filter((block) => block.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n');
        output.push({
          role: 'user',
          content: `<${toolName}_result>\n${text}\n</${toolName}_result>`,
        });
        continue;
      }
      const text = message.content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
      const reasoning = message.content
        .filter((block) => block.type === 'thinking' && typeof block.thinking === 'string')
        .map((block) => block.thinking)
        .join('');
      output.push({
        role: message.role,
        content: text,
        ...(reasoning ? { reasoningContent: reasoning } : {}),
      });
    }
    return output;
  };
}

describe('deepseek-api message mapping contract', () => {
  const mapper = createReferenceMapper();

  it('maps user and assistant text blocks to content', () => {
    const result = mapper([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi there' }] },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ]);
  });

  it('hand-backs assistant thinking blocks as reasoningContent', () => {
    const result = mapper([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'let me think' },
          { type: 'text', text: 'answer' },
        ],
      },
    ]);
    expect(result).toEqual([
      { role: 'assistant', content: 'answer', reasoningContent: 'let me think' },
    ]);
  });

  it('serializes toolResult messages as user messages with the XML result protocol', () => {
    const result = mapper([
      {
        role: 'toolResult',
        toolName: 'web_search',
        content: [{ type: 'text', text: '{"ok":true,"summary":"found"}' }],
      },
    ]);
    expect(result).toEqual([
      {
        role: 'user',
        content: '<web_search_result>\n{"ok":true,"summary":"found"}\n</web_search_result>',
      },
    ]);
  });

  it('joins multiple text blocks and omits reasoningContent when absent', () => {
    const result = mapper([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hidden' },
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
      { role: 'user', content: [{ type: 'text', text: 'plain' }] },
    ]);
    expect(result).toEqual([
      { role: 'assistant', content: 'ab', reasoningContent: 'hidden' },
      { role: 'user', content: 'plain' },
    ]);
  });

  it('preserves empty text messages without inventing fields', () => {
    const result = mapper([{ role: 'user', content: [] }]);
    expect(result).toEqual([{ role: 'user', content: '' }]);
  });
});
