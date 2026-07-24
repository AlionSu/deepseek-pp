// 本地 Skill「自动激活」（隐式打分）开关设置。
//
// 两个联动布尔：
//   firstMessage —— 仅新对话首条消息自动匹配并激活本地索引 Skill；
//   everyMessage —— 当前对话每一条消息都自动匹配并激活（开启时联动开启 firstMessage）。
//
// 不变式（在 normalize 层强制，保证 UI / 存储 / 运行时任何写入都一致）：
//   everyMessage ⇒ firstMessage（每条消息开 ⇒ 首条必开）；
//   非 firstMessage ⇒ 非 everyMessage（首条关 ⇒ 每条必关）。
//
// 该设置镜像 core/prompt/settings.ts 的「提示注入设置」通路：
// 存于 chrome.storage.local，经 background 的 GET/SAVE 命令读取，
// 通过 STATE_UPDATED 广播下发到 content 脚本，最终进入请求增强状态。

const STORAGE_KEY = 'deepseek_pp_skill_auto_activation';

export interface SkillAutoActivationSettings {
  firstMessage: boolean;
  everyMessage: boolean;
}

export const DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS: SkillAutoActivationSettings = {
  // 默认开启「首条消息」：保留上一版隐式打分在首条消息上生效的行为；
  // 「每条消息」默认关闭，避免对每条对话都触发隐式打分。
  firstMessage: true,
  everyMessage: false,
};

export async function getSkillAutoActivationSettings(): Promise<SkillAutoActivationSettings> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  return normalizeSkillAutoActivationSettings(data[STORAGE_KEY]);
}

export async function saveSkillAutoActivationSettings(
  settings: Partial<SkillAutoActivationSettings>,
): Promise<SkillAutoActivationSettings> {
  const current = await getSkillAutoActivationSettings();
  const normalized = normalizeSkillAutoActivationSettings({ ...current, ...settings });
  await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
  return normalized;
}

export function normalizeSkillAutoActivationSettings(value: unknown): SkillAutoActivationSettings {
  const object = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<SkillAutoActivationSettings>
    : null;
  if (!object) return { ...DEFAULT_SKILL_AUTO_ACTIVATION_SETTINGS };
  let everyMessage = object.everyMessage === true;
  let firstMessage = object.firstMessage === true;
  // 强制不变式：每条消息开 ⇒ 首条开；首条关 ⇒ 每条关。
  if (everyMessage) firstMessage = true;
  if (!firstMessage) everyMessage = false;
  return { firstMessage, everyMessage };
}
