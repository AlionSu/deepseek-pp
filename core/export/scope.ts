import type {
  ConversationExport,
  ConversationExportContentScope,
  ExportedMessage,
  ExportedSession,
} from './types';

/**
 * Content-range projection for exported artifacts (#499).
 *
 * `full` keeps every message and fragment (tool calls, continuations,
 * reasoning, injected context) — the troubleshooting format. `input-output`
 * keeps user inputs plus the final assistant answer, with reasoning and tool
 * fragments removed from the retained assistant message.
 */
export function applyConversationExportContentScope(
  exportData: ConversationExport,
  scope: ConversationExportContentScope,
): ConversationExport {
  if (scope === 'full') return exportData;

  const sessions: ExportedSession[] = exportData.sessions.map((session) => {
    const messages = projectInputOutputMessages(session.messages);
    return { ...session, messages };
  });
  const messageCount = sessions.reduce((total, session) => total + session.messages.length, 0);

  return {
    ...exportData,
    request: { ...exportData.request, contentScope: scope },
    stats: { ...exportData.stats, messageCount },
    sessions,
  };
}

function projectInputOutputMessages(messages: readonly ExportedMessage[]): ExportedMessage[] {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => projectTextFragments(message))
    .filter((message): message is ExportedMessage => message !== null);

  const assistantMessages = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => projectTextFragments(message))
    .filter((message): message is ExportedMessage => message !== null);

  const finalOutput = assistantMessages[assistantMessages.length - 1];
  return finalOutput ? [...userMessages, finalOutput] : userMessages;
}

function projectTextFragments(message: ExportedMessage): ExportedMessage | null {
  const fragments = message.contentFragments.filter((fragment) => fragment.kind === 'text');
  const content = fragments.map((fragment) => fragment.text).join('');
  if (!content.trim()) return null;
  return { ...message, content, contentFragments: fragments };
}
