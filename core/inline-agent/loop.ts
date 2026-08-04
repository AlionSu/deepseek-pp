import {
  createClientHeaders,
  createPowHeaders,
  submitPromptStreaming,
  type ModelTurn,
  type SubmitPromptInput,
} from '../deepseek/adapter';
import { extractToolCalls } from '../interceptor/tool-parser';
import { createStreamingToolTextAccumulator } from '../interceptor/streaming-tool-text';
import { createStreamingToolCallParser } from '../interceptor/streaming-tool-call-parser';
import type { ResponseTokenSpeedPayload } from '../deepseek/stream-metrics';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { executeToolCallsSequentially } from '../tool-loop/engine';
import type { ToolCall, ToolDescriptor, ToolExecutionRecord } from '../types';
import type { ToolParsingInput } from '../tool/invocation';
import {
  buildContinuationPrompt,
  buildNudgePrompt,
  extractTaskCompleteSignal,
  shouldNudge,
} from './prompt';
import {
  INLINE_AGENT_MAX_NUDGES,
  INLINE_AGENT_MAX_STEPS,
  INLINE_AGENT_REQUEST_DELAY_MAX_MS,
  INLINE_AGENT_REQUEST_DELAY_MIN_MS,
  INLINE_AGENT_STEP_TIMEOUT_MS,
  type InlineAgentLoopCompleteMsg,
  type InlineAgentLoopErrorMsg,
  type InlineAgentStartPayload,
  type InlineAgentStepCompleteMsg,
  type InlineAgentStreamChunkMsg,
  type InlineAgentToolDetectedMsg,
} from './types';

type PostFn = (type: string, data: unknown) => void;
type ExecuteToolFn = (call: ToolCall) => Promise<ToolExecutionRecord>;

const INLINE_AGENT_STREAM_EVENT_MAX_CHARS = 12000;
const INLINE_AGENT_MAX_STEP_ATTEMPTS = 2;
const INLINE_AGENT_FALLBACK_PARSE_MAX_CHARS = 120_000;
const TRUNCATION_SUFFIX = '\n...[truncated]';

export interface InlineAgentLoopDeps {
  post: PostFn;
  executeTool: ExecuteToolFn;
  signal: AbortSignal;
}

export async function runInlineAgentLoop(
  payload: InlineAgentStartPayload,
  deps: InlineAgentLoopDeps,
): Promise<void> {
  const { post, executeTool, signal } = deps;
  const { loopId, chatSessionId, toolDescriptors, promptOptions } = payload;
  const { powWasmUrl } = payload;
  const locale = payload.locale ?? DEFAULT_LOCALE;
  const parsingInput: ToolParsingInput = { descriptors: toolDescriptors };

  let parentMessageId: number | null = payload.parentMessageId;
  let allExecutions: ToolExecutionRecord[] = [...payload.toolExecutions];
  let nudgeCount = 0;
  let totalSteps = 0;
  let totalTools = allExecutions.length;
  let resolvedFinalText: string | null = null;
  let stopNotice: string | null = null;

  try {
    const clientHeaders = createClientHeaders();

    for (let step = 0; step < INLINE_AGENT_MAX_STEPS; step++) {
      if (signal.aborted) break;
      if (step > 0) {
        await waitBetweenDeepSeekRequests(signal);
        if (signal.aborted) break;
      }

      const prompt = buildContinuationPrompt(payload.originalPrompt, allExecutions, locale);
      const powHeaders = await createPowHeaders(clientHeaders, powWasmUrl);
      const streamState = createInlineAgentStreamState({
        loopId,
        stepIndex: step,
        toolDescriptors,
        parsingInput,
        post,
      });

      post('AGENT_STEP_STARTED', { loopId, stepIndex: step });

      const input: SubmitPromptInput = {
        chatSessionId,
        parentMessageId,
        modelType: promptOptions.modelType,
        prompt,
        refFileIds: promptOptions.refFileIds,
        thinkingEnabled: promptOptions.thinkingEnabled,
        searchEnabled: promptOptions.searchEnabled,
        clientHeaders,
        powHeaders,
      };

      let receivedAnyChunk = false;
      const turn: ModelTurn = await submitAgentTurn(
        input,
        {
          onTextChunk(text) {
            receivedAnyChunk = true;
            streamState.onTextChunk(text);
          },
          onTokenSpeed(progress) {
            postAgentTokenSpeed(post, payload, `step:${step}`, progress);
          },
        },
        signal,
        () => receivedAnyChunk,
      );
      const streamSnapshot = streamState.flush();

      if (signal.aborted) break;

      parentMessageId = turn.responseMessageId;
      const toolCalls = streamSnapshot.toolCalls;
      const visibleText = streamSnapshot.visibleText;

      if (parentMessageId == null) {
        if (toolCalls.length > 0) {
          throw new Error(
            'DeepSeek returned agent tool calls without a continuable response message; refusing to execute tools outside the conversation chain.',
          );
        }
        if (!visibleText.trim()) {
          throw new Error('DeepSeek returned an empty agent continuation without a continuable response message.');
        }
        resolvedFinalText = visibleText;
        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: step,
          responseMessageId: null,
          toolExecutions: [],
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps = step + 1;
        break;
      }

      if (extractTaskCompleteSignal(visibleText)) {
        resolvedFinalText = visibleText;
        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: step,
          responseMessageId: turn.responseMessageId,
          toolExecutions: [],
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps = step + 1;
        break;
      }

      if (toolCalls.length === 0) {
        if (!shouldNudge(payload.originalPrompt, allExecutions, visibleText)) {
          resolvedFinalText = visibleText;
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: turn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        nudgeCount++;
        if (nudgeCount > INLINE_AGENT_MAX_NUDGES) {
          stopNotice = buildInlineAgentBudgetNotice(locale, step + 1);
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: turn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        const nudgePrompt = buildNudgePrompt(payload.originalPrompt, visibleText, allExecutions, nudgeCount, locale);
        const nudgeInput: SubmitPromptInput = {
          ...input,
          prompt: nudgePrompt,
          parentMessageId: turn.responseMessageId,
        };

        await waitBetweenDeepSeekRequests(signal);
        if (signal.aborted) break;

        const nudgePowHeaders = await createPowHeaders(clientHeaders, powWasmUrl);
        nudgeInput.powHeaders = nudgePowHeaders;

        const nudgeStreamState = createInlineAgentStreamState({
          loopId,
          stepIndex: step,
          toolDescriptors,
          parsingInput,
          post,
          fallbackText: visibleText,
        });
        let nudgeReceivedAnyChunk = false;
        const nudgeTurn = await submitAgentTurn(
          nudgeInput,
          {
            onTextChunk(text) {
              nudgeReceivedAnyChunk = true;
              nudgeStreamState.onTextChunk(text);
            },
            onTokenSpeed(progress) {
              postAgentTokenSpeed(post, payload, `step:${step}:nudge:${nudgeCount}`, progress);
            },
          },
          signal,
          () => nudgeReceivedAnyChunk,
        );
        const nudgeStreamSnapshot = nudgeStreamState.flush();

        if (signal.aborted) break;

        parentMessageId = nudgeTurn.responseMessageId;
        const nudgeToolCalls = nudgeStreamSnapshot.toolCalls;
        const nudgeVisibleText = nudgeStreamSnapshot.visibleText;

        if (parentMessageId == null && nudgeToolCalls.length > 0) {
          throw new Error(
            'DeepSeek returned nudge tool calls without a continuable response message; refusing to execute tools outside the conversation chain.',
          );
        }

        if (extractTaskCompleteSignal(nudgeVisibleText)) {
          resolvedFinalText = nudgeVisibleText;
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: nudgeTurn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        if (nudgeToolCalls.length === 0) {
          if (!visibleText.trim() && !nudgeVisibleText.trim()) {
            throw new Error('DeepSeek returned an empty agent continuation after a delayed retry.');
          }

          const finalCandidate = nudgeVisibleText.trim() ? nudgeVisibleText : visibleText;
          if (shouldNudge(payload.originalPrompt, allExecutions, finalCandidate)) {
            stopNotice = buildInlineAgentBudgetNotice(locale, step + 1);
          } else {
            resolvedFinalText = finalCandidate;
          }
          post('AGENT_STEP_COMPLETE', {
            loopId,
            stepIndex: step,
            responseMessageId: nudgeTurn.responseMessageId,
            toolExecutions: [],
          } satisfies InlineAgentStepCompleteMsg);
          totalSteps = step + 1;
          break;
        }

        const nudgeExecs = await executeToolCallsSequentially(nudgeToolCalls, executeTool, { signal });
        allExecutions = [...allExecutions, ...nudgeExecs];
        totalTools += nudgeExecs.length;

        post('AGENT_STEP_COMPLETE', {
          loopId,
          stepIndex: step,
          responseMessageId: nudgeTurn.responseMessageId,
          toolExecutions: nudgeExecs,
        } satisfies InlineAgentStepCompleteMsg);
        totalSteps = step + 1;
        nudgeCount = 0;

        continue;
      }

      nudgeCount = 0;
      const stepExecs = await executeToolCallsSequentially(toolCalls, executeTool, { signal });
      allExecutions = [...allExecutions, ...stepExecs];
      totalTools += stepExecs.length;

      post('AGENT_STEP_COMPLETE', {
        loopId,
        stepIndex: step,
        responseMessageId: turn.responseMessageId,
        toolExecutions: stepExecs,
      } satisfies InlineAgentStepCompleteMsg);
      totalSteps = step + 1;

      if (signal.aborted) break;
    }

    if (!signal.aborted && resolvedFinalText === null && stopNotice === null && totalTools > 0 && totalSteps >= INLINE_AGENT_MAX_STEPS) {
      stopNotice = buildInlineAgentBudgetNotice(locale, totalSteps);
    }

    let finalText = '';
    if (resolvedFinalText !== null) {
      finalText = resolvedFinalText;
    } else if (!signal.aborted && stopNotice !== null) {
      finalText = stopNotice;
    }

    post('AGENT_LOOP_COMPLETE', {
      loopId,
      totalSteps,
      totalTools,
      finalText,
    } satisfies InlineAgentLoopCompleteMsg);
  } catch (err) {
    if (signal.aborted) {
      post('AGENT_LOOP_COMPLETE', {
        loopId,
        totalSteps,
        totalTools,
        finalText: '',
      } satisfies InlineAgentLoopCompleteMsg);
      return;
    }

    post('AGENT_LOOP_ERROR', {
      loopId,
      stepIndex: totalSteps,
      totalTools,
      error: err instanceof Error ? err.message : String(err),
    } satisfies InlineAgentLoopErrorMsg);
  }
}

function postAgentTokenSpeed(
  post: PostFn,
  payload: InlineAgentStartPayload,
  requestKey: string,
  progress: ResponseTokenSpeedPayload,
): void {
  post('AGENT_TOKEN_SPEED', {
    ...progress,
    requestId: `agent:${payload.loopId}:${requestKey}`,
    chatSessionId: payload.chatSessionId,
    modelType: progress.modelType ?? payload.promptOptions.modelType,
  } satisfies ResponseTokenSpeedPayload);
}

function createInlineAgentStreamState(input: {
  loopId: string;
  stepIndex: number;
  toolDescriptors: readonly ToolDescriptor[];
  parsingInput: ToolParsingInput;
  post: PostFn;
  fallbackText?: string;
}) {
  const visibleText = createStreamingToolTextAccumulator(input.toolDescriptors);
  const toolCallParser = createStreamingToolCallParser(input.toolDescriptors);
  const completedToolCalls: ToolCall[] = [];
  const completedToolCallSignatures = new Set<string>();
  let fallbackText = '';
  let fallbackTextTruncated = false;
  let lastPostedText = clampStreamEventText(input.fallbackText ?? '');

  const postVisibleText = (nextText: string) => {
    const fullText = clampStreamEventText(nextText || input.fallbackText || '');
    if (fullText === lastPostedText) return;
    lastPostedText = fullText;
    input.post('AGENT_STREAM_CHUNK', {
      loopId: input.loopId,
      stepIndex: input.stepIndex,
      text: '',
      fullText,
    } satisfies InlineAgentStreamChunkMsg);
  };

  const addCompletedToolCall = (call: ToolCall) => {
    const signature = createInlineAgentToolCallSignature(call);
    if (completedToolCallSignatures.has(signature)) return;
    completedToolCallSignatures.add(signature);
    completedToolCalls.push(call);
    input.post('AGENT_TOOL_DETECTED', {
      loopId: input.loopId,
      stepIndex: input.stepIndex,
      call,
    } satisfies InlineAgentToolDetectedMsg);
  };

  return {
    onTextChunk(text: string) {
      postVisibleText(visibleText.append(text));
      appendFallbackText(text);

      const event = toolCallParser.append(text);
      event.completed.forEach(addCompletedToolCall);
      event.failed.forEach(addCompletedToolCall);
    },
    flush() {
      const finalVisibleText = visibleText.flush();
      postVisibleText(finalVisibleText);
      const event = toolCallParser.flush();
      event.completed.forEach(addCompletedToolCall);
      event.failed.forEach(addCompletedToolCall);
      addFallbackToolCalls();
      return {
        visibleText: finalVisibleText,
        toolCalls: [...completedToolCalls],
      };
    },
  };

  function appendFallbackText(text: string) {
    if (fallbackTextTruncated) return;
    if (fallbackText.length + text.length > INLINE_AGENT_FALLBACK_PARSE_MAX_CHARS) {
      fallbackTextTruncated = true;
      fallbackText = '';
      return;
    }
    fallbackText += text;
  }

  function addFallbackToolCalls() {
    if (fallbackTextTruncated || !shouldFallbackParseToolCalls(fallbackText, completedToolCalls)) return;
    for (const call of extractToolCalls(fallbackText, input.parsingInput)) {
      addCompletedToolCall(call);
    }
  }
}

function shouldFallbackParseToolCalls(text: string, completedToolCalls: readonly ToolCall[]): boolean {
  if (!text) return false;
  if (text.includes('｜DSML｜')) return true;
  return completedToolCalls.length === 0 && text.includes('<');
}

function createInlineAgentToolCallSignature(call: ToolCall): string {
  if (call.id) return `id:${call.id}`;
  return `${call.provider?.id ?? ''}:${call.name}:${call.invocationName ?? ''}:${JSON.stringify(call.payload)}`;
}

function clampStreamEventText(value: string): string {
  return value.length > INLINE_AGENT_STREAM_EVENT_MAX_CHARS
    ? `${value.slice(0, INLINE_AGENT_STREAM_EVENT_MAX_CHARS)}${TRUNCATION_SUFFIX}`
    : value;
}

function waitBetweenDeepSeekRequests(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  const delay = randomInt(INLINE_AGENT_REQUEST_DELAY_MIN_MS, INLINE_AGENT_REQUEST_DELAY_MAX_MS);
  return new Promise((resolve) => {
    const timeout = setTimeout(cleanup, delay);
    const onAbort = () => cleanup();

    function cleanup() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      resolve();
    }

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createStepSignal(parentSignal: AbortSignal): {
  signal: AbortSignal;
  clear: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException('Agent step timed out.', 'TimeoutError'));
  }, INLINE_AGENT_STEP_TIMEOUT_MS);
  const onParentAbort = () => controller.abort();
  if (parentSignal.aborted) {
    onParentAbort();
  } else {
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }
  const clear = () => {
    clearTimeout(timeout);
    parentSignal.removeEventListener('abort', onParentAbort);
  };
  return { signal: controller.signal, clear, timedOut: () => timedOut };
}

/**
 * Submits one model turn with a bounded single retry. A retry is only allowed
 * when the request failed before any text chunk was received: once the server
 * has streamed content the turn is likely committed server-side, and replaying
 * it with the same parent message could fork the conversation chain. User
 * abort is never retried and propagates untouched so the caller can finish
 * silently.
 */
async function submitAgentTurn(
  input: SubmitPromptInput,
  callbacks: {
    onTextChunk: (text: string) => void;
    onTokenSpeed: (progress: ResponseTokenSpeedPayload) => void;
  },
  parentSignal: AbortSignal,
  receivedAnyChunk: () => boolean,
): Promise<ModelTurn> {
  for (let attempt = 1; attempt <= INLINE_AGENT_MAX_STEP_ATTEMPTS; attempt++) {
    const stepTimeout = createStepSignal(parentSignal);
    try {
      return await submitPromptStreaming(input, {
        retainAssistantText: false,
        onTextChunk: callbacks.onTextChunk,
        onTokenSpeed: callbacks.onTokenSpeed,
      }, stepTimeout.signal);
    } catch (err) {
      if (parentSignal.aborted) throw err;
      const timeoutFired = stepTimeout.timedOut();
      if (timeoutFired && receivedAnyChunk()) {
        throw new Error('DeepSeek agent step timed out while streaming; the response was interrupted.');
      }
      if (attempt >= INLINE_AGENT_MAX_STEP_ATTEMPTS) {
        if (timeoutFired) throw new Error('DeepSeek agent step timed out after retry.');
        throw err;
      }
      await waitBetweenDeepSeekRequests(parentSignal);
      if (parentSignal.aborted) throw err;
    } finally {
      stepTimeout.clear();
    }
  }
  throw new Error('DeepSeek agent step failed without a completed attempt.');
}

function buildInlineAgentBudgetNotice(locale: SupportedLocale, completedSteps: number): string {
  return translate(locale, 'content.agent.budgetReached', { count: completedSteps });
}
