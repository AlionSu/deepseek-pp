import { describe, expect, it } from 'vitest';
import {
  createDefaultToolDescriptors,
  isExtensionOwnedWebSearchDescriptor,
  projectToolDescriptorsForNativeSearch,
} from '../core/tool';
import type { ToolDescriptor } from '../core/types';

describe('projectToolDescriptorsForNativeSearch', () => {
  it('returns the descriptors unchanged when native search is disabled', () => {
    const descriptors = createDefaultToolDescriptors('en');

    const projected = projectToolDescriptorsForNativeSearch(descriptors, false);

    expect(projected).toBe(descriptors);
    expect(projected).toEqual([...descriptors]);
    expect(projected.map((descriptor) => descriptor.id)).toEqual(
      descriptors.map((descriptor) => descriptor.id),
    );
  });

  it('removes only the extension-owned local web_search descriptor when native search is enabled', () => {
    const descriptors = createDefaultToolDescriptors('en');
    expect(descriptors.map((descriptor) => descriptor.name))
      .toEqual(['memory_save', 'memory_update', 'memory_delete', 'web_search', 'web_fetch']);

    const projected = projectToolDescriptorsForNativeSearch(descriptors, true);

    expect(projected.map((descriptor) => descriptor.name))
      .toEqual(['memory_save', 'memory_update', 'memory_delete', 'web_fetch']);
  });

  it('preserves descriptor order for the remaining descriptors', () => {
    const descriptors = createDefaultToolDescriptors('en');
    const projected = projectToolDescriptorsForNativeSearch(descriptors, true);

    expect(projected.map((descriptor) => descriptor.id)).toEqual([
      'local:memory:memory_save',
      'local:memory:memory_update',
      'local:memory:memory_delete',
      'local:web:web_fetch',
    ]);
  });

  it('does not mutate the input descriptor array', () => {
    const descriptors = [...createDefaultToolDescriptors('en')];
    const snapshot = [...descriptors];

    projectToolDescriptorsForNativeSearch(descriptors, true);

    expect(descriptors).toEqual(snapshot);
  });

  it('does not remove an MCP descriptor that merely shares the web_search name', () => {
    const descriptors = [
      createDefaultToolDescriptors('en')[0],
      mcpWebSearchDescriptor(),
      createDefaultToolDescriptors('en').find((descriptor) => descriptor.name === 'web_fetch')!,
    ];

    const projected = projectToolDescriptorsForNativeSearch(descriptors, true);

    expect(projected.map((descriptor) => descriptor.id)).toEqual([
      'local:memory:memory_save',
      'mcp:browser-tools:web_search',
      'local:web:web_fetch',
    ]);
  });

  it('identifies the local extension web_search by provider contract rather than name alone', () => {
    expect(isExtensionOwnedWebSearchDescriptor(createDefaultToolDescriptors('en')
      .find((descriptor) => descriptor.name === 'web_search')!)).toBe(true);
    expect(isExtensionOwnedWebSearchDescriptor(mcpWebSearchDescriptor())).toBe(false);
    expect(isExtensionOwnedWebSearchDescriptor(createDefaultToolDescriptors('en')
      .find((descriptor) => descriptor.name === 'web_fetch')!)).toBe(false);
  });
});

function mcpWebSearchDescriptor(): ToolDescriptor {
  return {
    id: 'mcp:browser-tools:web_search',
    provider: {
      kind: 'mcp',
      id: 'browser-tools',
      displayName: 'Browser Tools',
      transport: 'streamable_http',
    },
    name: 'web_search',
    invocationName: 'browser_tools_web_search',
    title: 'Search (MCP)',
    description: 'A hypothetical MCP tool named web_search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execution: { mode: 'auto', enabled: true, risk: 'low' },
  };
}
