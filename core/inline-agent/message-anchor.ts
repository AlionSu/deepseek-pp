/**
 * Assistant-message anchoring for inline-agent UI (Issue #551 follow-up).
 *
 * A fresh agent run must mount its console into the NEWEST matching assistant
 * message, and matching must look only at the message's own visible text.
 * Two failure modes are guarded here:
 *
 * 1. Extension-injected UI (agent console timeline, final-answer area, tool
 *    blocks) lives inside the host message, so naive `textContent` matching
 *    let a message that already hosts a console match nearly every follow-up
 *    run — the new console then mounted under the PREVIOUS run's message.
 * 2. First-match-wins scanning preferred the oldest message; a new run's
 *    anchor is always the most recent one.
 */

/**
 * Selector for extension-owned UI injected into assistant messages. Text
 * under these nodes is renderer output, never message content.
 */
export const EXTENSION_INJECTED_MESSAGE_UI_SELECTOR =
  '.dpp-agent-container, [data-dpp-body-text], .dpp-tool-block, .dpp-agent-autosave-note';

/**
 * The message's own visible text with every extension-injected UI subtree
 * excluded, so content-snippet anchoring can never be poisoned by our own
 * rendered console/answer/tool text.
 */
export function getAssistantMessageOwnText(message: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? '');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.matches(EXTENSION_INJECTED_MESSAGE_UI_SELECTOR)) return;
    for (const child of Array.from(element.childNodes)) walk(child);
  };
  walk(message);
  return parts.join(' ');
}

function normalizeAnchorText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, '').trim();
}

/**
 * Find the newest assistant message whose own text contains the content
 * snippet. `usedMessages` are skipped entirely (e.g. messages already claimed
 * by a previous run's console or an earlier restored trace).
 */
export function findAssistantMessageByContentSnippet(
  messages: Element[],
  content: string,
  usedMessages: Set<Element>,
): Element | null {
  const snippet = normalizeAnchorText(content).slice(0, 100);
  if (snippet.length < 12) return null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (usedMessages.has(message)) continue;
    if (normalizeAnchorText(getAssistantMessageOwnText(message)).includes(snippet)) return message;
  }
  return null;
}
