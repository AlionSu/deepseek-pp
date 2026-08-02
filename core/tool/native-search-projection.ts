import type { ToolDescriptor } from './types';
import { WEB_SEARCH_TOOL_PROVIDER } from './web-search';

/**
 * Stable identity of the extension-owned local web_search descriptor. This is
 * the local provider contract (kind 'local', id 'web') plus the exact tool
 * name; an MCP tool that merely happens to be named web_search is not covered.
 */
export function isExtensionOwnedWebSearchDescriptor(
  descriptor: ToolDescriptor,
): boolean {
  return (
    descriptor.name === 'web_search' &&
    descriptor.provider?.kind === WEB_SEARCH_TOOL_PROVIDER.kind &&
    descriptor.provider?.id === WEB_SEARCH_TOOL_PROVIDER.id
  );
}

/**
 * Model-facing projection: when DeepSeek page-native search is enabled for a
 * turn, remove only the extension-owned local web_search descriptor so the
 * schema and mandatory web-search guidance disappear together. All other
 * descriptors (web_fetch, browser, MCP, memory, capability helpers) keep their
 * order. When native search is disabled the input array is returned by the
 * same reference, unchanged.
 */
export function projectToolDescriptorsForNativeSearch(
  descriptors: readonly ToolDescriptor[],
  nativeSearchEnabled: boolean,
): readonly ToolDescriptor[] {
  if (!nativeSearchEnabled) return descriptors;
  return descriptors.filter((descriptor) => !isExtensionOwnedWebSearchDescriptor(descriptor));
}
