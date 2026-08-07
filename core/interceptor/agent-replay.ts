/**
 * Agent final-answer replay (native-deliverable rendering).
 *
 * The inline agent's loop turns run through extension-owned fetches, so the
 * DeepSeek page never renders them natively. After the loop completes, the
 * content script registers the final answer here and drives the page's own
 * chat composer with the continuation prompt; the fetch hook matches that
 * page request and short-circuits it with a SYNTHETIC SSE response built from
 * the agent's final answer (+ reasoning), so the page's native markdown
 * renderer takes over: mermaid/xychart charts become chart cards, html/svg/xml
 * blocks get the native copy/download/run actions and the native preview
 * panel, and the final turn's thinking renders as a native "thought" block.
 *
 * The synthetic stream mirrors the released DeepSeek web wire format
 * byte-for-byte in shape (`event: ready`, `update_session`, `{p,o,v}` patches,
 * fragment creation, `FINISHED` status, `event: close`) — the same format the
 * page consumes for real responses, verified against live captures.
 *
 * Fail-closed: matching is exact (chat session + full prompt equality), the
 * registration expires after a bounded window, and a mismatch passes the
 * request through untouched (the page then talks to the real server, which is
 * the pre-replay behavior).
 */

/** One pending replay registration (serializable, validated at the bridge). */
export interface AgentReplayRegistration {
  chatSessionId: string;
  /** Exact prompt text of the replayed user message (the input we drive). */
  prompt: string;
  /** Final answer markdown: plain fences, tool XML stripped, charts normalized. */
  content: string;
  /** Reasoning text of the final turn (replayed as a native THINK fragment). */
  reasoning: string;
  /** The final turn's real server response message id (chain continuity). */
  responseMessageId: number | null;
  createdAt: number;
}

export const AGENT_REPLAY_REGISTRATION_TTL_MS = 120_000;

/**
 * Trust-boundary validator: the bridge message payload is untrusted until it
 * decodes to this exact legal shape (the bridge schema validator enforces the
 * same fields; this guard runs at the hook boundary again, fail-closed).
 */
export function isAgentReplayRegistration(value: unknown): value is AgentReplayRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.chatSessionId === 'string' && record.chatSessionId.length > 0 &&
    typeof record.prompt === 'string' && record.prompt.length > 0 &&
    typeof record.content === 'string' &&
    typeof record.reasoning === 'string' &&
    (record.responseMessageId === null || record.responseMessageId === undefined ||
      (typeof record.responseMessageId === 'number' && Number.isInteger(record.responseMessageId))) &&
    typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
  );
}

/**
 * True when the request body matches the pending replay: same chat session
 * AND byte-equal prompt. Byte equality keeps the hook from ever hijacking a
 * user-typed request that merely resembles the continuation prompt.
 */
export function matchAgentReplayRegistration(
  body: string,
  pending: AgentReplayRegistration | null,
): boolean {
  if (!pending) return false;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return parsed.chat_session_id === pending.chatSessionId && parsed.prompt === pending.prompt;
  } catch {
    return false;
  }
}

const SSE_CHUNK_MAX_CHARS = 512;

function sseFrames(frames: string[]): string {
  return frames.join('\n\n');
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

/**
 * Builds the synthetic SSE response for a replay. The stream delivers the
 * reasoning as a `THINK` fragment first (native "thought" block), then the
 * answer as a `RESPONSE` fragment, then the terminal `FINISHED` patches.
 */
export function buildAgentReplaySse(
  registration: AgentReplayRegistration,
  parentMessageId: number | null,
): string {
  const { content, reasoning, responseMessageId } = registration;
  const insertedAt = nowSeconds();
  const messageId = responseMessageId ?? 0;
  const parentId = parentMessageId;
  const thinkingEnabled = reasoning.trim().length > 0;
  const frames: string[] = [];

  // `event: ready` — the page fixes its request/response bookkeeping from
  // this. `request_message_id` is omitted: the extension does not know the
  // loop's request id, and the response id alone keeps the chain consistent.
  frames.push([
    'event: ready',
    `data: {"response_message_id":${messageId},"model_type":"default"}`,
  ].join('\n'));

  frames.push([
    'event: update_session',
    `data: {"updated_at":${insertedAt}}`,
  ].join('\n'));

  // Fragment 1: THINK (reasoning) or RESPONSE (answer) with its initial chunk.
  const firstFragmentType = thinkingEnabled ? 'THINK' : 'RESPONSE';
  const firstContent = thinkingEnabled ? reasoning : content;
  const firstChunk = firstContent.slice(0, SSE_CHUNK_MAX_CHARS);
  const firstFragment = {
    id: 1,
    type: firstFragmentType,
    content: firstChunk,
    elapsed_secs: null,
    references: [],
    stage_id: 1,
  };
  frames.push(JSON.stringify({
    v: {
      response: {
        message_id: messageId,
        parent_id: parentId,
        model: '',
        role: 'ASSISTANT',
        thinking_enabled: thinkingEnabled,
        ban_edit: false,
        ban_regenerate: false,
        status: 'WIP',
        incomplete_message: null,
        accumulated_token_usage: 0,
        feedback: null,
        inserted_at: insertedAt,
        search_enabled: false,
        fragments: [firstFragment],
        conversation_mode: 'DEFAULT',
        has_pending_fragment: false,
        auto_continue: false,
        search_triggered: false,
      },
    },
  }));

  // Remaining reasoning chunks (same patch path the server uses).
  for (const chunk of chunkText(firstContent.slice(SSE_CHUNK_MAX_CHARS))) {
    frames.push(JSON.stringify({ p: 'response/fragments/-1/content', o: 'APPEND', v: chunk }));
  }

  if (thinkingEnabled) {
    // Close the THINK fragment (elapsed seconds), then open the RESPONSE
    // fragment with its initial chunk.
    frames.push(JSON.stringify({ p: 'response/fragments/-1/elapsed_secs', o: 'SET', v: 1 }));
    const answerChunk = content.slice(0, SSE_CHUNK_MAX_CHARS);
    frames.push(JSON.stringify({
      p: 'response/fragments',
      o: 'APPEND',
      v: [{
        id: 2,
        type: 'RESPONSE',
        content: answerChunk,
        elapsed_secs: null,
        references: [],
        stage_id: 1,
      }],
    }));
    for (const chunk of chunkText(content.slice(SSE_CHUNK_MAX_CHARS))) {
      frames.push(JSON.stringify({ p: 'response/fragments/-1/content', o: 'APPEND', v: chunk }));
    }
  }

  const totalTokens = Math.max(1, Math.round((content.length + reasoning.length) / 4));
  frames.push(JSON.stringify({
    p: 'response',
    o: 'BATCH',
    v: [{ p: 'accumulated_token_usage', v: totalTokens }, { p: 'quasi_status', v: 'FINISHED' }],
  }));
  frames.push(JSON.stringify({ p: 'response/status', o: 'SET', v: 'FINISHED' }));

  frames.push([
    'event: update_session',
    `data: {"updated_at":${nowSeconds()}}`,
  ].join('\n'));

  frames.push([
    'event: close',
    'data: {"click_behavior":"none","auto_resume":false}',
  ].join('\n'));

  return sseFrames(frames);
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += SSE_CHUNK_MAX_CHARS) {
    chunks.push(text.slice(index, index + SSE_CHUNK_MAX_CHARS));
  }
  return chunks;
}
