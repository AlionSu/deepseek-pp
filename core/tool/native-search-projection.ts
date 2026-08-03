import type { ToolDescriptor } from './types';
import { WEB_SEARCH_TOOL_PROVIDER } from './web-search';

function isExtensionOwnedWebTool(
  descriptor: ToolDescriptor,
  name: 'web_search' | 'web_fetch',
): boolean {
  // Stable identity of the extension-owned local web tools: the local provider
  // contract (kind 'local', id 'web') plus the exact tool name. An MCP tool
  // that merely happens to share the name is not covered.
  return (
    descriptor.name === name &&
    descriptor.provider?.kind === WEB_SEARCH_TOOL_PROVIDER.kind &&
    descriptor.provider?.id === WEB_SEARCH_TOOL_PROVIDER.id
  );
}

/**
 * Stable identity of the extension-owned local web_search descriptor.
 */
export function isExtensionOwnedWebSearchDescriptor(
  descriptor: ToolDescriptor,
): boolean {
  return isExtensionOwnedWebTool(descriptor, 'web_search');
}

/**
 * Stable identity of the extension-owned local web_fetch descriptor.
 */
export function isExtensionOwnedWebFetchDescriptor(
  descriptor: ToolDescriptor,
): boolean {
  return isExtensionOwnedWebTool(descriptor, 'web_fetch');
}

/**
 * Model-facing projection: when DeepSeek page-native search is enabled for a
 * turn, remove BOTH extension-owned local web tools (web_search and web_fetch)
 * so the schema and mandatory web guidance disappear together and the model
 * relies on the native search path instead of competing extension networking
 * (observed in #480: the model switched to web_fetch once web_search was
 * removed). Browser, MCP, memory, and capability-helper descriptors keep their
 * order. When native search is disabled the input array is returned by the
 * same reference, unchanged.
 */
export function projectToolDescriptorsForNativeSearch(
  descriptors: readonly ToolDescriptor[],
  nativeSearchEnabled: boolean,
): readonly ToolDescriptor[] {
  if (!nativeSearchEnabled) return descriptors;
  return descriptors.filter(
    (descriptor) =>
      !isExtensionOwnedWebSearchDescriptor(descriptor) &&
      !isExtensionOwnedWebFetchDescriptor(descriptor),
  );
}
