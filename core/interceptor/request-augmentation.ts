import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { buildPromptAugmentation } from '../prompt';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  normalizePromptInjectionSettings,
  shouldInjectPresetForTurn,
  type PromptInjectionSettings,
} from '../prompt/settings';
import { parseSkillCommand } from '../skill/parser';
import { projectToolDescriptorsForNativeSearch } from '../tool';
import type { Memory, ModelType, Skill, SystemPromptPreset, ToolDescriptor } from '../types';
import { filterMemoriesByProjectScope } from '../memory/scope';

export interface RequestAugmentationState {
  memories: Memory[];
  skills: Array<Pick<Skill, 'name' | 'instructions' | 'memoryEnabled'>>;
  activePreset: SystemPromptPreset | null;
  projectContext?: string | null;
  projectId?: string | null;
  modelType: ModelType;
  toolDescriptors: readonly ToolDescriptor[];
  messageCount: number;
  locale?: SupportedLocale;
  promptSettings?: Partial<PromptInjectionSettings>;
}

export interface RequestBodyAugmentationResult {
  body: string;
  agentTaskPrompt: string;
  usedMemoryIds: number[];
  messageCount: number;
}

export interface DeepSeekRequestBody extends Record<string, unknown> {
  prompt: string;
}

interface ResolvedSkills {
  combinedPrompt: string;
  memoryEnabled: boolean;
}

export function augmentRequestBody(
  bodyStr: string,
  state: RequestAugmentationState,
): RequestBodyAugmentationResult | null {
  const body = decodeAugmentableDeepSeekRequestBody(bodyStr);
  if (!body) return null;
  return augmentDecodedRequestBody(body, state);
}

export function decodeAugmentableDeepSeekRequestBody(
  bodyStr: string,
): DeepSeekRequestBody | null {
  try {
    return decodeDeepSeekRequestBody(bodyStr);
  } catch {
    return null;
  }
}

export function decodeDeepSeekRequestBody(bodyStr: string): DeepSeekRequestBody {
  let value: unknown;
  try {
    value = JSON.parse(bodyStr);
  } catch {
    throw new Error('DeepSeek request body must be valid JSON.');
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DeepSeek request body must be a plain object.');
  }
  const body = value as Record<string, unknown>;
  if (typeof body.prompt !== 'string' || body.prompt.length === 0) {
    throw new Error('DeepSeek request prompt must be a non-empty string.');
  }
  return body as DeepSeekRequestBody;
}

export function augmentDecodedRequestBody(
  decodedBody: Readonly<DeepSeekRequestBody>,
  state: RequestAugmentationState,
): RequestBodyAugmentationResult {
  const body: DeepSeekRequestBody = { ...decodedBody };

  const originalPrompt = body.prompt;
  const locale = state.locale ?? DEFAULT_LOCALE;

  const thinkingEnabled = body.thinking_enabled === true;
  const isFirstMessage = body.parent_message_id === null || body.parent_message_id === undefined;
  const messageCount = isFirstMessage ? 1 : state.messageCount + 1;
  const promptSettings = normalizePromptInjectionSettings(state.promptSettings ?? DEFAULT_PROMPT_INJECTION_SETTINGS);
  const shouldInjectPreset = shouldInjectPresetForTurn({
    hasActivePreset: Boolean(state.activePreset),
    isFirstMessage,
    messageCount,
    cadence: promptSettings.presetCadence,
  });
  const presetContent = shouldInjectPreset ? state.activePreset!.content : null;
  const forceResponseLanguage = promptSettings.forceResponseLanguage === 'auto'
    ? null
    : promptSettings.forceResponseLanguage;

  if (state.modelType) {
    body.model_type = state.modelType;
  }

  const modelFacingToolDescriptors = projectToolDescriptorsForNativeSearch(
    state.toolDescriptors,
    body.search_enabled === true,
  );

  const invocation = parseSkillCommand(originalPrompt);
  if (invocation) {
    const resolved = resolveSkills(state.skills, invocation.skillName, invocation.args, locale);
    if (resolved) {
      const scopedMemories = filterMemoriesByProjectScope(state.memories, state.projectId);
      const { augmented, usedMemoryIds } = buildPromptAugmentation(resolved.combinedPrompt, {
        memories: scopedMemories,
        thinkingEnabled,
        identityOnly: !resolved.memoryEnabled,
        visibleUserPrompt: originalPrompt,
        presetContent,
        projectContext: state.projectContext,
        toolDescriptors: modelFacingToolDescriptors,
        locale,
        memoryEnabled: promptSettings.memoryEnabled,
        systemPromptEnabled: promptSettings.systemPromptEnabled,
        forceResponseLanguage,
      });

      body.prompt = augmented;
      return {
        body: JSON.stringify(body),
        agentTaskPrompt: resolved.combinedPrompt,
        usedMemoryIds,
        messageCount,
      };
    }
  }

  const { augmented, usedMemoryIds } = buildPromptAugmentation(originalPrompt, {
    memories: filterMemoriesByProjectScope(state.memories, state.projectId),
    thinkingEnabled,
    presetContent,
    projectContext: state.projectContext,
    toolDescriptors: modelFacingToolDescriptors,
    locale,
    memoryEnabled: promptSettings.memoryEnabled,
    systemPromptEnabled: promptSettings.systemPromptEnabled,
    forceResponseLanguage,
  });
  body.prompt = augmented;

  return {
    body: JSON.stringify(body),
    agentTaskPrompt: originalPrompt,
    usedMemoryIds,
    messageCount,
  };
}

function resolveSkills(
  skills: RequestAugmentationState['skills'],
  skillName: string,
  args: string,
  locale: SupportedLocale,
): ResolvedSkills | null {
  const primarySkill = skills.find((s) => s.name === skillName);
  if (!primarySkill) return null;

  const secondInvocation = parseSkillCommand('/' + args);
  if (secondInvocation) {
    const secondSkill = skills.find((s) => s.name === secondInvocation.skillName);
    if (secondSkill) {
      const userArgs = secondInvocation.args;
      const combinedInstructions = primarySkill.instructions + '\n\n---\n\n' + secondSkill.instructions;
      return {
        combinedPrompt: userArgs
          ? wrapUserInput(combinedInstructions, userArgs, locale)
          : combinedInstructions,
        memoryEnabled: primarySkill.memoryEnabled || secondSkill.memoryEnabled,
      };
    }
  }

  return {
    combinedPrompt: args
      ? wrapUserInput(primarySkill.instructions, args, locale)
      : primarySkill.instructions,
    memoryEnabled: primarySkill.memoryEnabled,
  };
}

function wrapUserInput(
  instructions: string,
  userInput: string,
  locale: SupportedLocale,
): string {
  return translate(locale, 'prompt.skillUserInputWrapper', { instructions, userInput });
}
