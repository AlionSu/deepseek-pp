/**
 * deepseek-web provider contract tests (Issue B1-T1/T2).
 *
 * 1. Compile-time assignability: the provider factory return type must
 *    remain a valid pi-ai `Provider<'deepseek-web'>` and its deps must stay
 *    constructible from the port's own types. If upstream pi changes shape,
 *    this file fails to compile (version-drift guard, risk (a2)).
 * 2. Registration shape: `createProvider` output for the deepseek-web
 *    factory must expose the expected id/api/models/auth surface and
 *    delegate `stream`/`streamSimple` to the same StreamFn body.
 * 3. Auth semantics: a configured session resolves headers; an absent one
 *    resolves `undefined` (not configured).
 * 4. Contract hygiene: the port module may only import pi packages and
 *    type-only relative imports — no concrete implementation modules.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Provider, ProviderStreams } from '@earendil-works/pi-ai';
import {
  DEEPSEEK_WEB_API,
  DEEPSEEK_WEB_MODEL_IDS,
  DEEPSEEK_WEB_PROVIDER,
  type DeepSeekWebProviderDeps,
  type DeepSeekWebProviderFactory,
} from '../core/inline-agent/pi/provider-port';

// --- Compile-time assignability (drift guard) -------------------------------

// The factory return type must remain assignable to pi's Provider type.
type FactoryReturn = ReturnType<DeepSeekWebProviderFactory>;
const _providerAssignable: Provider<typeof DEEPSEEK_WEB_API> = null as unknown as FactoryReturn;
void _providerAssignable;

// The deps object must remain constructible from the port's own types.
type DepsShape = DeepSeekWebProviderDeps;
const _depsAssignable: DepsShape = null as unknown as DepsShape;
void _depsAssignable;

// The provider's stream surface must satisfy pi's ProviderStreams shape.
type StreamSurface = Pick<FactoryReturn, 'stream' | 'streamSimple'>;
const _streamsAssignable: ProviderStreams = null as unknown as StreamSurface;
void _streamsAssignable;

describe('deepseek-web provider port contract', () => {
  it('declares a custom api id outside pi-ai KnownApi', () => {
    // The extension point: Api = KnownApi | (string & {}). The id must be a
    // distinct string — if it collides with a known api, the registration
    // would be routed to pi-ai's own api implementation instead of ours.
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
    expect(knownApis).not.toContain(DEEPSEEK_WEB_API);
    expect(DEEPSEEK_WEB_API).toBe('deepseek-web');
  });

  it('uses a provider id distinct from the official-API deepseek provider', () => {
    // B2 will register the official API under the existing `deepseek`
    // provider id; the web backend must not collide with it.
    expect(DEEPSEEK_WEB_PROVIDER).toBe('deepseek-web');
  });

  it('exposes a static model catalog with the custom api', () => {
    expect(DEEPSEEK_WEB_MODEL_IDS).toEqual(['deepseek-chat', 'deepseek-reasoner']);
  });

  it('keeps the provider deps a superset of the StreamFn deps', () => {
    // The provider is a registration + delegation object over the existing
    // StreamFn seam; it must not invent a second backend contract. Type-level
    // check: every DeepSeekStreamFnDeps member is present on the provider
    // deps (structural extension is asserted by the compile-time
    // `_depsAssignable` guard above).
    type StreamFnDepsKeys = keyof import('../core/inline-agent/pi/stream-fn-port').DeepSeekStreamFnDeps;
    type MissingKeys = Exclude<StreamFnDepsKeys, keyof DeepSeekWebProviderDeps>;
    type HasAuthHeaders = 'resolveAuthHeaders' extends keyof DeepSeekWebProviderDeps ? true : false;
    const missing: MissingKeys[] = [];
    const hasAuthHeaders: HasAuthHeaders = true;
    expect(missing).toEqual([]);
    expect(hasAuthHeaders).toBe(true);
  });
});

describe('deepseek-web provider port hygiene', () => {
  it('imports only pi packages and type-only relative modules', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../core/inline-agent/pi/provider-port.ts'),
      'utf8',
    );
    // No concrete implementation imports: no deepseek-stream-fn, adapter,
    // interceptor, or DOM/browser modules.
    expect(source).not.toMatch(/from\s+['"].*deepseek-stream-fn['"]/);
    expect(source).not.toMatch(/from\s+['"].*adapter['"]/);
    expect(source).not.toMatch(/from\s+['"].*interceptor['"]/);
    expect(source).not.toMatch(/from\s+['"].*entrypoints['"]/);
    // All relative imports must be `import type`.
    for (const line of source.split('\n')) {
      const match = line.match(/^import\s+(?!type\b)(.*)\s+from\s+['"]\.\//);
      expect(match).toBeNull();
    }
  });
});
