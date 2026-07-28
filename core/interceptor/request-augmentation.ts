import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../i18n';
import { buildPromptAugmentation } from '../prompt';
import {
  DEFAULT_PROMPT_INJECTION_SETTINGS,
  normalizePromptInjectionSettings,
  shouldInjectPresetForTurn,
  type PromptInjectionSettings,
} from '../prompt/settings';
import { parseSkillCommand } from '../skill/parser';
import { isLocalIndexInstructions, buildLocalExecutionBoundary } from '../skill/local-importer';
import { selectImplicitSkill, type LocalSkillIndex } from '../skill/local-skill-scorer';
import { absolutizeSkillReferences, joinUnderRoot } from '../skill/local-path-rewriter';
import { DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS, type SkillAutoActivationSettings } from '../skill/auto-activation-settings';
import type { Memory, ModelType, Skill, SystemPromptPreset, ToolDescriptor } from '../types';
import { filterMemoriesByProjectScope } from '../memory/scope';

export interface RequestAugmentationState {
  memories: Memory[];
  // 扩展来源/描述/remote：运行时按来源分派，且本地索引 Skill 可经 remote.localDirectory 拿到 skillDir。
  // source/description/remote 设为可选，保持对仅含 name/instructions/memoryEnabled 的既有调用（含测试）向后兼容；
  // 真实调用方（content.ts）始终传入完整 Skill 对象。
  skills: Array<
    Pick<Skill, 'name' | 'instructions' | 'memoryEnabled'> &
    Partial<Pick<Skill, 'source' | 'description' | 'remote'>>
  >;
  activePreset: SystemPromptPreset | null;
  projectContext?: string | null;
  projectId?: string | null;
  modelType: ModelType;
  toolDescriptors: readonly ToolDescriptor[];
  messageCount: number;
  locale?: SupportedLocale;
  promptSettings?: Partial<PromptInjectionSettings>;
  // 自动激活（隐式打分）开关；缺省按 DEFAULT（首条消息开、每条消息关）。
  skillAutoActivation?: SkillAutoActivationSettings;
}

export interface RequestBodyAugmentationResult {
  body: string;
  agentTaskPrompt: string;
  usedMemoryIds: number[];
  messageCount: number;
  // 若本次请求激活了某个本地索引 Skill，则其 skillDir；否则 undefined。
  // 此为「会话初始 cwd 提示」：供调用方（content.ts）捕获后在响应解析期作为
  // shell_exec / shell_session_begin 的初始 cwd 建议；非硬性持久绑定（评审 #4 路线 A）。
  activeLocalSkillDir?: string;
}

export interface DeepSeekRequestBody extends Record<string, unknown> {
  prompt: string;
}

interface ResolvedSkills {
  combinedPrompt: string;
  memoryEnabled: boolean;
  // 已激活 Skill 的名称（用于系统上下文的反急躁 / 读盘指令文案）。
  skillName: string;
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

  const invocation = parseSkillCommand(originalPrompt);
  let resolved: ResolvedSkills | null = null;
  let activeLocalSkillDir: string | undefined;

  if (invocation) {
    const primarySkill = state.skills.find((s) => s.name === invocation.skillName);
    if (primarySkill && isLocalIndexSkill(primarySkill)) {
      activeLocalSkillDir = primarySkill.remote?.localDirectory || undefined;
    }
    resolved = resolveSkills(state.skills, invocation.skillName, invocation.args, locale);
  } else {
    // 隐式分支：无触发符时，对本地索引 Skill 按用户输入打分，取最高分且过阈值者激活。
    // 受「自动激活」开关门控：
    //   everyMessage ⇒ 每条消息都允许；否则 firstMessage ⇒ 仅首条消息允许；两者皆关 ⇒ 不激活。
    const auto = state.skillAutoActivation ?? DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS;
    const implicitAllowed = auto.everyMessage || (auto.firstMessage && isFirstMessage);
    if (implicitAllowed) {
      const picked = selectImplicitLocalSkill(state.skills, originalPrompt);
      if (picked) {
        activeLocalSkillDir = picked.remote?.localDirectory || undefined;
        resolved = {
          combinedPrompt: composeLocalSkillPrompt(picked),
          memoryEnabled: picked.memoryEnabled,
          skillName: picked.name,
        };
      }
    }
  }

  if (resolved) {
    const scopedMemories = filterMemoriesByProjectScope(state.memories, state.projectId);
    const isLocalIndexActivated = activeLocalSkillDir !== undefined;

    let augmented: string;
    let usedMemoryIds: number[];
    if (isLocalIndexActivated) {
      // 本地索引 Skill（显式 / 隐式命中）：将「激活指令 + 索引」镶入系统上下文（如同 systemChat 的 ## Tools 段），
      // 真实用户 query 保留为可见用户输入，避免被模型当作被动闲聊而不遵循读盘指令（修复 Bug ② framing 倒置）。
      const { augmented: a, usedMemoryIds: m } = buildPromptAugmentation(originalPrompt, {
        memories: scopedMemories,
        thinkingEnabled,
        identityOnly: !resolved.memoryEnabled,
        skillSystemContext: buildLocalSkillSystemContext(resolved, activeLocalSkillDir, locale),
        presetContent,
        projectContext: state.projectContext,
        toolDescriptors: state.toolDescriptors,
        locale,
        memoryEnabled: promptSettings.memoryEnabled,
        systemPromptEnabled: promptSettings.systemPromptEnabled,
        forceResponseLanguage,
      });
      augmented = a;
      usedMemoryIds = m;
    } else {
      // 非本地索引 Skill（builtin/github/bundled）：保持既有行为，索引作为可见用户输入注入。
      const { augmented: a, usedMemoryIds: m } = buildPromptAugmentation(resolved.combinedPrompt, {
        memories: scopedMemories,
        thinkingEnabled,
        identityOnly: !resolved.memoryEnabled,
        visibleUserPrompt: originalPrompt,
        presetContent,
        projectContext: state.projectContext,
        toolDescriptors: state.toolDescriptors,
        locale,
        memoryEnabled: promptSettings.memoryEnabled,
        systemPromptEnabled: promptSettings.systemPromptEnabled,
        forceResponseLanguage,
      });
      augmented = a;
      usedMemoryIds = m;
    }

    body.prompt = augmented;
    return {
      body: JSON.stringify(body),
      agentTaskPrompt: resolved.combinedPrompt,
      usedMemoryIds,
      messageCount,
      activeLocalSkillDir,
    };
  }

  const { augmented, usedMemoryIds } = buildPromptAugmentation(originalPrompt, {
    memories: filterMemoriesByProjectScope(state.memories, state.projectId),
    thinkingEnabled,
    presetContent,
    projectContext: state.projectContext,
    toolDescriptors: state.toolDescriptors,
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
    activeLocalSkillDir,
  };
}

type AugmentationSkill = RequestAugmentationState['skills'][number];

function isLocalIndexSkill(skill: AugmentationSkill): boolean {
  // 真实本地 Skill 落地为 source: 'remote' + remote.provider: 'local'（见 core/skill/local-importer.ts），
  // 故以 remote.provider 作为判别符（与 UI 端 SkillCard / SkillPage 一致）；
  // 不能用 source === 'local'——SkillSource 联合类型不含 'local'，既触发 TS 类型错误，又使真实本地 Skill 永远不匹配。
  return skill.remote?.provider === 'local' && isLocalIndexInstructions(skill.instructions);
}

// 构建本地索引 Skill 的激活提示：索引 instructions + D4 边界（按 skillDir 动态生成）+ D1 防御性改写。
// 真正读盘由 Agent 在激活时经 local_file_read 完成（扩展运行在浏览器沙箱，无本地同步读文件通道）。
//
// 声明收窄（评审 #3 路线 A）：此处的 D1 改写仅作用于「注入的索引指令文本」（见 local-path-rewriter.ts
// 文件头），不覆盖本地 Skill 真实 SKILL.md 正文及其 references 文件内容；真实正文相对引用
// 依赖 Agent 遵循 D4 软提示的「double-base rule」自行解析。故本函数不构成"真实文件相对引用全覆盖"，
// 而是声明自洽的"索引指令层防御性规范化 + Agent 层软提示兜底"。
function composeLocalSkillPrompt(skill: AugmentationSkill): string {
  const skillDir = skill.remote?.localDirectory ?? '';
  let prompt = skill.instructions;
  if (skillDir) {
    const knownAbs = new Set<string>();
    const files = [
      ...(skill.remote?.includedFiles ?? []),
      ...(skill.remote?.scriptFiles ?? []),
      ...(skill.remote?.omittedFiles ?? []),
    ];
    for (const file of files) {
      const abs = joinUnderRoot(skillDir, file.path);
      if (abs) knownAbs.add(abs);
    }
    prompt = absolutizeSkillReferences(prompt, {
      skillDir,
      thisFileDir: skillDir,
      fileExists: (abs) => knownAbs.has(abs),
    });
    if (!prompt.includes('## Local Execution Boundary')) {
      prompt = `${prompt}\n\n---\n\n${buildLocalExecutionBoundary(skillDir)}`;
    }
  }
  return prompt;
}

// 构建本地索引 Skill 的系统上下文：激活指令（含反急躁、强制先读 SKILL.md）+ 索引本体。
// 作为系统指令注入（非可见用户输入），模型会服从其中"先读盘再执行"的约束（修复 Bug ② framing 倒置）。
function buildLocalSkillSystemContext(
  resolved: ResolvedSkills,
  skillDir: string | undefined,
  locale: SupportedLocale,
): string {
  const skillMdPath = skillDir ? `${skillDir}/SKILL.md` : 'SKILL.md';
  const directive = translate(locale, 'prompt.localSkillActivationDirective', {
    skillName: resolved.skillName,
    skillMdPath,
  });
  return `${directive}\n\n${resolved.combinedPrompt}`;
}

// 隐式分支：从本地索引 Skill 中按用户输入打分，返回命中的 Skill 对象（或 null）。
function selectImplicitLocalSkill(skills: AugmentationSkill[], query: string): AugmentationSkill | null {
  const candidates: LocalSkillIndex[] = skills
    .filter(isLocalIndexSkill)
    .map((s) => ({
      name: s.name,
      description: s.description ?? '',
      category: undefined,
      skillDir: s.remote?.localDirectory ?? '',
    }));
  const picked = selectImplicitSkill(query, candidates);
  if (!picked) return null;
  return skills.find(
    (s) => s.name === picked.name && (s.remote?.localDirectory ?? '') === picked.skillDir,
  ) ?? null;
}

function resolveSkills(
  skills: RequestAugmentationState['skills'],
  skillName: string,
  args: string,
  locale: SupportedLocale,
): ResolvedSkills | null {
  const primarySkill = skills.find((s) => s.name === skillName);
  if (!primarySkill) return null;

  const primaryPrompt = composeResolvedInstructions(primarySkill);

  const secondInvocation = parseSkillCommand('/' + args);
  if (secondInvocation) {
    const secondSkill = skills.find((s) => s.name === secondInvocation.skillName);
    if (secondSkill) {
      const userArgs = secondInvocation.args;
      const combinedInstructions = primaryPrompt + '\n\n---\n\n' + composeResolvedInstructions(secondSkill);
      return {
        combinedPrompt: userArgs
          ? wrapUserInput(combinedInstructions, userArgs, locale)
          : combinedInstructions,
        memoryEnabled: primarySkill.memoryEnabled || secondSkill.memoryEnabled,
        skillName: primarySkill.name,
      };
    }
  }

  return {
    combinedPrompt: args
      ? wrapUserInput(primaryPrompt, args, locale)
      : primaryPrompt,
    memoryEnabled: primarySkill.memoryEnabled,
    skillName: primarySkill.name,
  };
}

// 本地索引 Skill 返回"索引指令 + D4 边界 + D1 防御性改写"；其余来源保持原固化 instructions（builtin/bundled/github 不变）。
function composeResolvedInstructions(skill: AugmentationSkill): string {
  if (isLocalIndexSkill(skill)) return composeLocalSkillPrompt(skill);
  return skill.instructions;
}

function wrapUserInput(
  instructions: string,
  userInput: string,
  locale: SupportedLocale,
): string {
  return translate(locale, 'prompt.skillUserInputWrapper', { instructions, userInput });
}
