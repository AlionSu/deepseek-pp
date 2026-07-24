# 本地 Skill 导入 / 激活 / 重定位 功能 — 代码审查清单

> **适用对象**：未接触过本项目的第三方审查者。读完本清单即可独立开展代码审查。
> **审查范围**：当前未提交工作树中的"本地 Skill"整批改动（共 **29 文件**：20 改 + 9 增）。
> **代码基线**：`v1.11.6`（Release 提交 `c824c6d`）。
> **重要约束**：本机环境**禁止本地编译**，类型检查 / 构建 / 单测全部交给远程 CI（见 §8）。审查者无需、也不应在本机跑 `npm test` / `npm run compile`。

---

## 0. 5 分钟上手

- **项目一句话**：DeepSeek++（仓库名 `deepseek-plus-plus`）是一个浏览器扩展（WXT 框架 + React 19 + Manifest V3），为 DeepSeek 对话提供"记忆 / Skill / 执行 / 自动化 / MCP 工具"能力。
- **本次审查对象**：本地文件夹 Skill 的"**索引化导入 + 按需激活 + 路径绝对化 + 隐式打分 + 自动激活 + 文件夹挪动重定位**"整批能力。
- **必读前置文档（设计事源，按重要度排序）**：
  1. `.workbuddy/memory/local-skill-import-design.md` — 主设计事源（背景 / 8 阶段演进结论 / 最终架构 / 代码事实依据表 / 开放风险）。
  2. `.workbuddy/memory/local-skill-scoring-spec.md` — 激活打分权重表 / 阈值双闸 / "适用/不适用场景"调整规范。
  3. `.workbuddy/memory/local-skill-implementation-tasks.md` — T1–T11 任务清单（每任务含 文件:行 / 具体改动 / 复用点 / 验收标准）。
  4. `docs/t8-relocate-implementation-plan.md` — T8 重定位方案 + 第 7 节"实施记录与偏差 / 关键 bug 修复 / 验证指引"。
- **阅读顺序建议**：先读本文 §1–§3 建立全局认知 → 再读上述设计事源深挖细节 → 最后对照 §4 变更清单 + §7 审查重点逐文件看码。

---

## 1. 项目目录与代码存放位置

| 路径 | 作用 |
|---|---|
| 仓库根 `D:\Documents\AI_Work_Temp\Deepseek-pp` | 项目根（Linux/macOS 写作 `…/Deepseek-pp`） |
| `package.json` | 脚本：`dev`/`build`/`test`(=vitest run)、`compile`(=tsc --noEmit)、`ci:quality`（类型检查+测试+i18n+build:all 等全量门禁） |
| `core/skill/` | **本次重心**：本地 Skill 导入/更新/重定位/打分/路径改写/自动激活设置 |
| `core/messaging/` | 运行时命令契约（types ↔ background 编解码 / 响应声明） |
| `core/interceptor/request-augmentation.ts` | 请求增强（把激活的 Skill 指令注入对话请求） |
| `core/mcp/capability-projection.ts` | MCP 能力投影评分范式（被打分器复用 `normalizeSearchText`/`tokenize`） |
| `core/i18n/resources/` | 中英文案（`zh-CN.ts` / `en.ts`） |
| `entrypoints/background.ts` + `entrypoints/background/*.ts` | 后台：命令注册 / 依赖绑定 / handler（`skill-handlers`/`library-handlers`/`persistence-mutation-bindings`） |
| `entrypoints/sidepanel/` | 侧边栏 UI（`pages/SkillPage.tsx` / `components/SkillCard.tsx`） |
| `entrypoints/content.ts` | 内容脚本（接收自动激活状态广播 `STATE_UPDATED`） |
| `tests/` | 单测（vitest） |
| `.workbuddy/memory/*.md` | 设计事源文档（见 §0） |
| `docs/t8-relocate-implementation-plan.md` | T8 专项方案 |

---

## 2. 原始诉求（要解决的问题）

- **背景**：用户希望把"本地文件夹里的 Skill"（例如仓库内自带的 `core/skill/spec-driven-develop-official/`）接入对话，并支持**更新**与**文件夹挪动后重指定路径**。
- **已放弃项**：GitHub 私有仓库导入 Skill（原问题①，经决策放弃，仅保留本地文件夹途径）。
- **三大核心痛点**：
  1. **快照过期**：原方案"导入即内联固化快照"——用户修改原目录文件后，已导入 Skill 不生效，缺"更新"机制。
  2. **路径断裂**：相对路径引用在"文件物理落点（原 Skill 目录）"与"Agent 执行基（home / 会话目录）"之间断裂；原仅靠 prompt 软提示弥合，不可靠。
  3. **激活单一**：仅支持 `/skillname` 显式精确匹配，缺"按对话意图隐式激活"能力。
- **最终收敛**：放弃"固化快照"模式，改为"**索引化导入 + 按需懒加载激活 + 路径硬约束 + 隐式打分激活 + 自动激活 + T8 重定位**"的重构方案（详见 §3）。

---

## 3. 最终方案（决策结论）

- **导入（索引化）**：导入只登记 `name`/`description` + `skillDir` 指针 + 绝对路径，**不再内联全文**；真正内容在激活时读盘。
- **激活（方案2 按需懒加载）**：`resolveSkills` 改为 `async`，仅当 `/skillname` 命中本地 Skill 时才经 Shell MCP 的 `local_file_read` 读 SKILL.md 全文；对齐 bundled Skill 的"按需加载"范式，IO 最省。
- **激活判定两路**：
  - ① 显式 `/skillname` → 精确匹配 name，**越过打分**；
  - ② 隐式（用户输入无触发符）→ 对**本地索引 Skill** 的 `name`/`description` 跑打分，取最高分且过"**阈值双闸**"激活（最低激活分 + 显著领先差，防"两弱争激活"误激活）。
- **路径硬约束（D1）**：激活加载时，对进入 Agent 上下文的 Skill 文本中的相对路径引用做"**双基探测绝对化**"——先 `join(本文件目录, rel)`，存在即用；否则 `join(skillDir, rel)`，存在即用；都不存在则**保留原样**（不误伤 URL / 绝对路径 / `..` 越界）。
  - 辅助：`shell_exec` 的 `cwd` 硬设为 `skillDir`，解决**脚本运行时内部**相对路径（D1 覆盖不到的程序行为）。
  - 兜底：`D4` 动态软提示（按 `skillDir` 生成"本地执行边界"说明随指令注入）。
- **更新（轻量）**：校验 `skillDir` 有效则重读 frontmatter 覆盖索引；失效则引导用户重指定路径（即 T8）。
- **自动激活**：`firstMessage` / `everyMessage` 联动开关（不变式：`everyMessage ⇒ firstMessage`；首条关 ⇒ 每条必关）；存 `chrome.storage.local`，经 background `GET`/`SAVE` + `STATE_UPDATED` 广播下发到 content 脚本。
- **T8 重定位**：原文件夹挪动后，用户重选新路径 → `relocateLocalSkillSource` **原地更新 `source` 记录、保留 `source.id`**（不生成新 id，避免激活引用 / 禁用状态 / 用户设置断裂）。
- **红线（锁死）**：加载模式恒为"**Agent 驱动、按需 `local_file_read`/`shell_exec` 读取**"；**系统递归灌入被引用文件 的模式当前与将来均不存在**（无注册表 / 防循环逻辑，归 Skill 编写者责任）。

---

## 4. 代码修改范围（变更清单，29 文件）

### 4.1 核心导入 / 更新 / 重定位（`core/skill/`）

| 文件 | 状态 | 一句话改动 |
|---|---|---|
| `core/skill/local-importer.ts` | 改 | 新增 `relocateLocalSkillSource`（保留 id 原地更新）；**修复 `updateLocalSkillSource`** 把文件夹失效抛错转为 `{ok:false}`（T8 端到端关键修复）；`importLocalSkillSource`/`previewLocalSkillSource` 既有逻辑 |
| `core/skill/auto-activation-settings.ts` | 增 | 自动激活 `firstMessage`/`everyMessage` 设置 + `normalize` 不变式 + `get`/`save`（存 `chrome.storage.local`） |
| `core/skill/local-skill-scorer.ts` | 增 | 隐式激活打分（蓝本=capability-projection，去 pinned，加"适用/不适用场景"调整，阈值双闸 `100`/`50`），仅对本地索引 Skill |
| `core/skill/local-path-rewriter.ts` | 增 | D1 路径改写器（双基探测绝对化 + 越界校验 `joinUnderRoot`，纯字符串助手不依赖 `node:path`，适配浏览器） |
| `core/skill/registry.ts` | 改 | 源注册表微调（约 +5 行，关联 `importedSkillNames` / 源查询） |

### 4.2 命令契约（`core/messaging/`）

| 文件 | 状态 | 一句话改动 |
|---|---|---|
| `core/types.ts` | 改 | `MessageAction` 联合类型新增 `RELOCATE_LOCAL_SKILL_SOURCE` |
| `core/messaging/runtime-command-contracts.ts` | 改 | `typedCommand` 登记 `RELOCATE_LOCAL_SKILL_SOURCE` |
| `core/messaging/persistence-runtime-request-codec.ts` | 改 | `RELOCATE_LOCAL_SKILL_SOURCE(value)` 编解码 + `nonEmptyString` 校验 `sourceId`/`newRootPath` |
| `core/messaging/persistence-runtime-contracts.ts` | 改 | request/response 声明（response = `LocalSkillImportResponse`） |
| `core/messaging/runtime-boundary.ts` | 改 | 运行时边界登记（+1 行，命令放行） |

### 4.3 后台入口（`entrypoints/background/`）

| 文件 | 状态 | 一句话改动 |
|---|---|---|
| `entrypoints/background.ts` | 改 | 导入 / 解构进 bindings / `skill` 对象三处注入 `relocateLocalSkillSource` |
| `entrypoints/background/skill-handlers.ts` | 改 | 新增 `relocateLocalSkillSource` 接口 + handler（成功 `broadcastStateUpdate`） |
| `entrypoints/background/persistence-mutation-bindings.ts` | 改 | 依赖接口 / 绑定接口 / 实现三处加入 `relocateLocalSkillSource` |
| `entrypoints/background/library-handlers.ts` | 改 | 库 handler 接入自动激活 `GET`/`SAVE`（约 +11 行） |

### 4.4 UI 与内容脚本（`entrypoints/`）

| 文件 | 状态 | 一句话改动 |
|---|---|---|
| `entrypoints/sidepanel/pages/SkillPage.tsx` | 改 | 新增 `pickNewLocalFolder`；重写 `handleUpdateLocalSkill`（UPDATE 失败 → 重选 → RELOCATE）；自动激活开关 UI |
| `entrypoints/sidepanel/components/SkillCard.tsx` | 改 | Skill 卡片接入自动激活状态（约 +17 行） |
| `entrypoints/content.ts` | 改 | 接收 `STATE_UPDATED` 自动激活设置广播（约 +10 行） |

### 4.5 i18n

| 文件 | 状态 | 一句话改动 |
|---|---|---|
| `core/i18n/resources/zh-CN.ts` | 改 | 新增 `sidepanel.skillPage.relocatePrompt`（+ 自动激活相关文案） |
| `core/i18n/resources/en.ts` | 改 | 同上英文 |

### 4.6 请求增强与能力投影

| 文件 | 状态 | 一句话改动 |
|---|---|---|
| `core/interceptor/request-augmentation.ts` | 改 | 本地 Skill 激活分支（按需读盘 + D1 注入 + 索引形态标记 `isLocalIndexSkill`） |
| `core/mcp/capability-projection.ts` | 改 | 导出 `normalizeSearchText`/`tokenize` 供打分器复用（约 +4 行） |

### 4.7 测试（`tests/`）

| 文件 | 状态 | 一句话改动 |
|---|---|---|
| `tests/local-skill-importer.test.ts` | 改 | 新增 `relocateLocalSkillSource` 4 用例 + `updateLocalSkillSource` 2 用例（含 T8 bug 回归） |
| `tests/auto-activation.test.ts` | 增 | 自动激活设置归一化 / 不变式 |
| `tests/local-skill-scorer.test.ts` | 增 | 打分 + 阈值双闸 + 场景调整 |
| `tests/local-path-rewriter.test.ts` | 增 | D1 双基探测 / 越界 / 不误伤 |
| `tests/request-augmentation-local.test.ts` | 增 | 请求增强本地激活分支 |

### 4.8 文档与垃圾

| 文件 | 状态 | 一句话改动 |
|---|---|---|
| `docs/t8-relocate-implementation-plan.md` | 增 | T8 方案 + 第 7 节实施记录 / bug 修复 / 验证 |
| `docs/compatibility/runtime-command-inventory.md` | 改 | 命令清单补 `RELOCATE_LOCAL_SKILL_SOURCE` |
| `nul` | 增（**垃圾**） | Windows 保留名文件，疑似某次重定向误产，**待删除**，与功能无关 |

---

## 5. 为何修改（动机对照表）

| 改动 | 对应 §2 痛点 / §3 决策 |
|---|---|
| `local-importer.ts` 索引化导入 + `request-augmentation.ts` 按需读盘 | 痛点① 快照过期 → 方案2 按需懒加载 |
| `local-path-rewriter.ts` + `request-augmentation.ts` D1 注入 + `shell_exec` cwd 硬设 | 痛点② 路径断裂 → D1 主 + cwd 辅 + D4 兜底的硬约束 |
| `local-skill-scorer.ts` + `auto-activation-settings.ts` | 痛点③ 激活单一 → 隐式打分 + 自动激活 |
| `auto-activation-settings.ts` + `library-handlers.ts` + `content.ts` + `SkillCard.tsx` | §3 自动激活开关与广播下发 |
| `relocateLocalSkillSource` + 命令契约 + UI 重选 | §3 T8 文件夹挪动重指定路径 |
| **`updateLocalSkillSource` 修复** | 关键：原抛错会令 T8 重定位流程永不触发，改为返回 `{ok:false}` 让 UI 进入重选分支 |
| 命令契约 4 文件 | 新增 `RELOCATE_LOCAL_SKILL_SOURCE` 命令的端到端登记（语义隔离，不污染 `UPDATE`） |
| i18n 双语文案 | 重定位提示 + 自动激活 UI 文案 |

---

## 6. 实现思路与技术路线

### 6.1 数据流（端到端）

```
本地文件夹
  → local_skill_preview（Shell MCP Native Host 读盘）
  → importLocalSkillSource：只登记索引（name/description/skillDir/绝对路径）存入 chrome.storage（skillSources + skills）
  → 装配：对话开始时 state.skills 仅含索引指针
  → 激活：用户 /skillname 或隐式打分命中
      → resolveSkills(async) 经 local_file_read 读 SKILL.md 全文
      → D1 local-path-rewriter 对正文相对路径绝对化（双基探测）
      → 注入指令 + D4 动态软提示（skillDir 边界）
  → 更新：UPDATE_LOCAL_SKILL_SOURCE 重读 frontmatter；失败 → RELOCATE_LOCAL_SKILL_SOURCE 重指定路径
  → 自动激活：auto-activation-settings 经 GET/SAVE + STATE_UPDATED 下发 content
```

### 6.2 各新增模块职责

- **`local-importer.ts`**：导入 / 预览 / 更新 / 重定位的底层。关键函数：`importLocalSkillSource`（索引登记）、`updateLocalSkillSource`（**已修**：失效返回 `{ok:false}`）、`relocateLocalSkillSource`（保留 id 原地更新）、`loadLocalSkillSource`（读盘 + 构造索引/指令）。
- **`local-skill-scorer.ts`**：隐式激活打分。复用 `capability-projection` 的 `normalizeSearchText`/`tokenize`；去 pinned；新增 `scenarioAdjustment`（命中"不适用场景" −1000，命中"适用场景" +300）；`scoreLocalSkill` + 阈值双闸（`ACTIVATION_THRESHOLD=100`、`MIN_LEAD_GAP=50`）。仅对本地索引 Skill，不波及 builtin/bundled/github。
- **`local-path-rewriter.ts`**：D1 算法。纯字符串路径助手（**不依赖 `node:path`**，浏览器约束）；`joinUnderRoot` 做越界校验（`..` 逃出根返回 null 不改写）；`rewriteRelativePaths` 对 Markdown 链接/图片 `](...)` 做双基探测绝对化。
- **`auto-activation-settings.ts`**：开关状态机。`normalizeSkillAutoActivationSettings` 强制不变式（`everyMessage⇒firstMessage`；非首条⇒非每条）；存 `chrome.storage.local` 键 `deepseek_pp_skill_auto_activation`。

### 6.3 命令契约三层（务必一致）

新增 `RELOCATE_LOCAL_SKILL_SOURCE` 命令在四处登记，审查时逐处比对：
1. `core/types.ts` — `MessageAction` 联合类型；
2. `core/messaging/runtime-command-contracts.ts` — `typedCommand`；
3. `core/messaging/persistence-runtime-request-codec.ts` — `typedPayload` + `nonEmptyString` 校验；
4. `core/messaging/persistence-runtime-contracts.ts` — request/response 声明（response=`LocalSkillImportResponse`）。

后台注入三处（`background.ts` 导入/解构/`skill` 对象）+ handler（`skill-handlers.ts`）+ 绑定（`persistence-mutation-bindings.ts`）。

### 6.4 复用点（非从零造轮子）

- **Shell MCP**：`local_skill_preview` / `local_folder_pick` / `local_file_read` / `shell_exec`（Native Host 跨平台对话框 + 读盘 + 执行）。
- **MCP 能力投影打分范式**（`capability-projection.ts`）：`normalizeSearchText` + `tokenize` 跨语言中立，被 `local-skill-scorer` 直接复用。
- **bundled Skill 懒加载范式**（`bundled-loader.ts` `createBundledSkillResourceLoader`）：本地 Skill 对齐其"按需加载"模型。

---

## 7. 审查重点与风险清单（Reviewer Checklist）

> 逐项核对，发现可疑点请记录文件:行号。

- [ ] **命令契约一致性**：`RELOCATE_LOCAL_SKILL_SOURCE` 在 §6.3 所列 4 处 + background 3 处 + handler 的签名 / payload / response 类型是否完全对齐（尤其 `sourceId`/`newRootPath` 均为非空字符串）。
- [ ] **id 稳定性不变量**：`relocateLocalSkillSource` 是否确实**保留 `source.id`**（不调 `importLocalSkillSource` 生成新 id）；`stageUpsertLocalSkillSourceAlreadyLocked` 的 `nextSource` 是否沿用 `existingSource.id`。
- [ ] **T8 阻断修复**：`updateLocalSkillSource` 是否把文件夹失效的抛错转为 `{ok:false, error}`；`skill-handlers.ts` 的 RELOCATE handler 对 `!result.ok` 的处理；`SkillPage.tsx` 的 `handleUpdateLocalSkill` 是否进入 `!response.ok` 分支触发 `pickNewLocalFolder` → `RELOCATE`。
- [ ] **D1 误伤风险**：`local-path-rewriter.ts` 是否对 URL（`http(s)://`）、`mailto:`、绝对路径、`..` 越界、**代码块 / 数据文件内容**不做改写（仅改进入 Agent 上下文的 Skill 文本相对引用）；`joinUnderRoot` 越界返回 null 的路径是否保留原样。
- [ ] **打分误激活**：阈值双闸（`100`/`50`）是否生效；"不适用场景" −1000 排除是否覆盖；隐式打分是否**仅对本地索引 Skill**，不波及 builtin/bundled/github。
- [ ] **cwd 硬设安全**：`shell_exec` 的 `cwd` 是否硬设为 `skillDir`（而非软提示）；是否防止脚本越界写盘。
- [ ] **异步时序**：`resolveSkills` 改 `async` 后，所有调用点是否 `await`；`request-augmentation.ts` 注入路径在异步读盘失败时的错误是否可恢复告知（而非静默丢 Skill）。
- [ ] **自动激活不变式**：`normalizeSkillAutoActivationSettings` 是否在 UI/存储/运行时任何写入都强制 `everyMessage⇒firstMessage`；`STATE_UPDATED` 广播是否把最新设置送达 content。
- [ ] **i18n 覆盖**：`relocatePrompt` 及自动激活文案在 `zh-CN.ts` 与 `en.ts` 是否成对存在；`verify:i18n` 是否会报缺失。
- [ ] **测试覆盖**：`tests/` 新增用例是否覆盖——relocate 正常/id 不变、空参数、source 不存在、新路径缺原 skill；updateLocalSkillSource 空 skills→ok:false、不存在 sourceId→抛；scorer 阈值/场景；rewriter 双基/越界；auto-activation 不变式。
- [ ] **垃圾文件**：`nul` 是否应删除（与功能无关，疑似误产）。
- [ ] **已知开放风险**（来自设计事源）：①隐式打分误激活；②大文件夹重导耗时（已有 `relocating` 防重入 + 超时）；③旧版固化快照 Skill 的迁移兼容（T10）；④失效可恢复错误 UI（T11）。请确认本次改动是否引入新问题。

---

## 8. 如何验证（给审查者 / CI）

- **本机禁编译**：审查者**不要**在本机执行 `npm test` / `npm run compile`（环境硬约束，且会触发本地编译）。
- **远程 CI（推荐，也是唯一验证路径）**：将改动推到**功能分支**（勿直接推 `main`），远程 CI 自动跑：
  - 类型检查：`npm run compile`（= `tsc --noEmit`）；
  - 单测：`npm test`（= `vitest run`）；
  - 全量质量门：`npm run ci:quality`（含 compile + test + `verify:i18n` + `build:all` + 多项 smoke）。
- **提交建议**：29 文件为整批功能，建议按逻辑拆成若干 commit（如：①索引化导入+按需激活 ②D1 路径改写 ③隐式打分+自动激活 ④T8 重定位+bug 修复 ⑤测试 ⑥文档），便于评审与回滚；**不要**单 commit 一锅端，也**不要**强推 `main`。
- **CI 失败处理**：据 CI 日志定点修复后重新推送；本清单 §7 的高风险项即为最易触发 CI 报错的来源。

---

*本文档为第三方代码审查导航，细节以 §0 所列设计事源文档与代码注释为准。*
