// D1 路径改写器：对本地 Skill 文本中的相对路径引用做"双基探测绝对化"。
//
// 设计来源：.workbuddy/memory/local-skill-import-design.md §2.5。
// 覆盖对象：进入 Agent 上下文的 Skill 文本里的相对路径引用（Markdown 链接/图片 `](...)` 等）。
// 算法（双基探测）：
//   1) 先 join(thisFileDir, rel)，fileExists 存在 → 用；
//   2) 否则 join(skillDir, rel)，fileExists 存在 → 用；
//   3) 都不存在 → 保留原样（不误伤 URL / 绝对路径 / 占位 / `..` 越界）。
// 越界校验：rel 经 joinUnderRoot 解析会逃出 skillDir 根 → 不改写（防逃逸）。
//
// 浏览器约束：本模块只用纯字符串路径助手，不依赖 node:path（扩展打包到浏览器环境）。
// 说明：本模块为 D1 的"规范算法实现"。在"Agent 驱动、按需 local_file_read 读取"的加载模式下，
// 真正读盘与递归加载由 Agent 完成；本函数作为防御性/规范化手段，对注入文本中的相对引用做绝对化，
// 并由 Agent 指令（见 buildLocalExecutionBoundary）镜像同一规则。代码块（fenced ``` / ~~~ 与 inline `）内的引用视为示例，跳过改写。

const SEP_RE = /[\\/]+/;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function isAbsolutePath(p: string): boolean {
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true; // Windows 盘符
  return p.startsWith('/') || p.startsWith('\\');
}

function splitParts(p: string): string[] {
  return p.split(SEP_RE).filter(Boolean);
}

// 在 root 之下解析 rel；若 rel 经 `..` 会逃出文件系统根（out 为空），返回 null（越界）。
export function joinUnderRoot(root: string, rel: string): string | null {
  const rootParts = splitParts(root);
  const relParts = splitParts(rel);
  const out: string[] = [...rootParts];
  for (const part of relParts) {
    if (part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  const sep = /[\\/]/.test(root) && root.includes('\\') ? '\\' : '/';
  let result = out.join(sep);
  // 保留根的前导分隔符，使绝对路径根（如 /skills/demo）解析后仍是绝对路径（/skills/...）。
  if ((root.startsWith('/') || root.startsWith('\\')) && !result.startsWith(sep)) {
    result = sep + result;
  }
  return result;
}

// 判定 absPath 是否仍位于 root 之内（含等于 root）。absPath 须先经 joinUnderRoot 解析为以 root 为基的绝对路径。
// 用途：absolutizeSkillReferences 的"防逃逸"守卫——相对引用经 `..` 逃出 skillDir 根（如 /skills/demo → /skills/etc）
// 即视为越界，不改写。注意：单凭 joinUnderRoot===null 只能拦住逃出"文件系统根"的情形，拦不住逃到 root 的兄弟目录，故需此 containment 校验。
function isUnderRoot(root: string, absPath: string): boolean {
  const rootParts = splitParts(root);
  const pathParts = splitParts(absPath);
  if (pathParts.length < rootParts.length) return false;
  for (let i = 0; i < rootParts.length; i++) {
    if (pathParts[i] !== rootParts[i]) return false;
  }
  return true;
}

const MARKDOWN_REF_RE = /(\]\()([^)\s]+)(\))/g;

// 代码区（fenced ``` / ~~~ 与 inline `）：其中的 [link](path) 多为示例，不应被绝对化。
// 处理前先抽出代码区用私有区占位符保护，改写非代码区后再还原，避免污染展示文本。
const CODE_SEGMENT_RE = /(?:```|~~~)[\s\S]*?(?:```|~~~)|`[^`\n]*`/g;
const CODE_OPEN = '';
const CODE_CLOSE = '';

export interface LocalPathRewriteOptions {
  skillDir: string;
  thisFileDir: string;
  fileExists: (absolutePath: string) => boolean;
}

export function absolutizeSkillReferences(text: string, options: LocalPathRewriteOptions): string {
  const { skillDir, thisFileDir, fileExists } = options;
  // 抽出代码区，保护其不被改写。
  const codeSegments: string[] = [];
  const protectedText = text.replace(CODE_SEGMENT_RE, (segment) => {
    const index = codeSegments.push(segment) - 1;
    return `${CODE_OPEN}${index}${CODE_CLOSE}`;
  });
  const rewritten = protectedText.replace(MARKDOWN_REF_RE, (match, open: string, rawPath: string, close: string) => {
    const trimmed = rawPath.trim();
    if (!trimmed) return match;
    if (URL_RE.test(trimmed)) return match; // URL
    if (trimmed.startsWith('#')) return match; // 锚点
    if (isAbsolutePath(trimmed)) return match; // 已是绝对路径
    if (trimmed.startsWith('~')) return match; // 家目录占位
    // 越界校验：rel 经 `..` 会逃出 skillDir 根（不在 root 之内）→ 不改写（防逃逸）。
    const candidateUnderSkill = joinUnderRoot(skillDir, trimmed);
    if (candidateUnderSkill === null) return match;
    if (!isUnderRoot(skillDir, candidateUnderSkill)) return match;

    const base1 = joinUnderRoot(thisFileDir, trimmed);
    if (base1 && fileExists(base1)) return `${open}${base1}${close}`;
    const base2 = joinUnderRoot(skillDir, trimmed);
    if (base2 && fileExists(base2)) return `${open}${base2}${close}`;
    return match; // 都不存在：保留原样（不误伤）
  });
  // 还原代码区（占位符格式固定，无嵌套风险）。
  return rewritten.replace(new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g'), (_m, index: string) => codeSegments[Number(index)]);
}
