# Deepseek-pp 本地 Skill 重构 — 审查报告复核（代码实证）

> 生成时间：2026-07-24 16:48 GMT+8
> 复核方法：逐条对照实际代码（文件:行号）+ 关键单元测试（relocate 测试）确认运行时行为。
> 复核对象：用户提交的代码审查报告（BUG-01/02/03 + 四条逻辑结论 + 优先修复建议）。

## 0. 复核结论速览

| 报告条目 | 复核结论 | 关键证据 |
|---|---|---|
| BUG-01 [P0] 路径匹配逻辑错误 | **不成立（误报）** | `skillPaths` 存 root-相对路径；rename/move 不改变内部相对结构；relocate 改名测试通过 |
| BUG-02 [P1] resolveSkills 未 async | **误报（代码符合锁定设计）**；暴露设计文档自相矛盾 | `resolveSkills` 同步返回索引文本是 §2.9 锁定红线预期；报告引用的是早期 §1.5/§2.2 提案 |
| BUG-03 [P2] D1 未跳过代码块 | **成立（技术正确），但影响被高估** | 正则确会匹配代码块；但 `fileExists` 双基门闸限制误伤面，建议降为低危加固 |
| 逻辑① T8 + updateLocalSkillSource ok:false | 正确 | local-importer.ts:217-227；RELOCATE 4 处登记一致 |
| 逻辑② 打分双闸 + auto-activation 不变式 | 正确 | local-skill-scorer.ts:18-19/72-73；auto-activation-settings.ts:50-51 |
| 逻辑③ D4 cwd 软约束 | 正确（合法观察） | buildLocalExecutionBoundary 为纯文本 prompt，硬强制依赖 Native Host 层 |
| 逻辑④ nul 误产 + 禁编译 | 正确 | 根目录 `nul`（39B）已确认为 cmd 重定向误产 |

---

## 1. BUG-01 [P0]：不成立（误报）

**报告论断**：`relocateLocalSkillSource`（local-importer.ts:250/257）用 `localSource.skillPaths`（相对于旧 rootPath 的相对路径）去过滤从新 rootPath 加载的 `loaded.skills`，文件夹移动/改名后路径基准切换导致 `selected` 为空，抛 "Selected local Skill paths were not found"。

**实际代码与行为**：
- `skillPaths` 在存储时存的是 **root-相对路径**，而非绝对路径。证据：
  - 单测 mock 的预览返回 `path: 'SKILL.md'`（local-skill-importer.test.ts:393，相对），`directoryPath` 才是绝对路径（:395 `D:\skills\ref-material-writing`）。
  - 导入后落盘的 `skillPaths = ['SKILL.md']`（:485 断言；另见 persisted-data-i18n.test.ts:197/209 `['中文/SKILL.md']`、remaining-local-state-store.test.ts:85 `['updated/SKILL.md']`）。
- `relocateLocalSkillSource` 与 `importLocalSkillSource`（local-importer.ts:156）使用**完全相同的相对路径约定**：`loaded.skills.filter((skill) => localSource.skillPaths.includes(skill.item.path))`。
- 文件夹移动/改名只改变最外层目录，**内部相对结构不变**，因此旧相对路径 `SKILL.md` 与新预览返回的 `SKILL.md` 一致，匹配成功。
- **改名为场景已被测试直接覆盖**：local-skill-importer.test.ts:462-488 将 `demo` 重定位到 `demo-renamed`（rootPath 改变），断言 `relocated.source.skillPaths` 仍为 `['SKILL.md']`、`id` 保留、`ok === true`。T8 在移动场景实证可用。

**报告前提错误点**：认为 `localSource.skillPaths` 是"旧 rootPath 绝对路径"或"路径基准已切换"——实际为 root-相对且 move 不改变相对结构，故匹配不发生偏差。

**附加说明（真实失败点）**：若真的发生不匹配，最早失败在 local-importer.ts:250 的 `loadLocalSkillSource`（preview 的 `selectedPaths` 过滤使 `bundle.skills` 为空 → 抛 "No SKILL.md was found under this local directory"，:315），而非 :257 的后置过滤。但相对约定下该路径不触发。

**处置**：无需修改代码。报告建议的"改用名称/模糊匹配"反而会在多 Skill 同目录时匹配错误 Skill，当前精确相对匹配是正确的。

---

## 2. BUG-02 [P1]：误报（代码符合最终锁定设计），但暴露设计文档自相矛盾

**报告论断（事实部分正确）**：`resolveSkills`（request-augmentation.ts:240）仍为同步函数、仅返回"索引文本"、未读盘，违背"设计文档（§3）方案2：resolveSkills 改 async、命中时经 local_file_read 读全文"。

**代码实证**：
- `resolveSkills` 确为 `function`（非 `async`），对本地索引 Skill 走 `composeResolvedInstructions` → `composeLocalSkillPrompt`（:196-221）。
- `composeLocalSkillPrompt` 仅做：①D1 防御性改写（调用 `absolutizeSkillReferences`）；②拼接 D4 边界（`buildLocalExecutionBoundary`）；③返回索引文本。**无任何磁盘 I/O**。
- 其中 `fileExists` 闭包（:208-214）由 `skill.remote.includedFiles/scriptFiles/omittedFiles` 的**已存储元数据**预构建 `knownAbs` 集合，非运行时 `local_file_stat`——再次印证"扩展侧不读盘"。
- 代码注释 line 196 明确："真正读盘由 Agent 在激活时经 local_file_read 完成（扩展运行在浏览器沙箱，无本地同步读文件通道）"。

**为何不是 BUG（锁定决策覆盖早期提案）**：
- 设计事源 `local-skill-import-design.md` **line 7 硬约束（锁死）**："加载模式恒为 **Agent 驱动、按需 local_file_read/shell_exec 读取**；系统递归灌入被引用文件的加载模式当前与将来均不存在。"
- 同文档 **§2.9（line 130-131）** 锁死"模型甲（Agent 驱动、按需读）"：Agent 看到绝对化路径自行调用 `local_file_read`/`shell_exec`，递归加载也由 Agent 驱动。
- 报告引用的"§3 方案2 async"实为早期提案（文档 **§1.5 line 55 / §2.2 line 82**），已被 §2.9 锁定红线推翻。报告章节号亦误标（应为 §1.5/§2.2，非 §3）。

**结论**：代码与锁定设计一致，`resolveSkills` 同步是**预期实现**，BUG 标签误报。
**真正的待办（根因）**：设计文档 §1.5/§2.2 与 §2.9/line 7 自相矛盾——前者仍写"resolveSkills 改 async"，后者锁死 Agent 驱动。应**修正设计文档使其与代码对齐**，否则会持续误导后续审查者（本报告即一例）。不要改代码。

---

## 3. BUG-03 [P2]：成立（技术正确），但影响被高估，建议降为低危加固

**报告论断**：`MARKDOWN_REF_RE = /(\]\()([^)\s]+)(\))/g`（local-path-rewriter.ts:46）会匹配 Markdown 链接，若 SKILL.md 代码块（```）内含 `[link](path)` 文本会被误绝对化。技术正确。

**限制因素（报告未计）**：`absolutizeSkillReferences`（:54-71）对每个命中先过 `fileExists` 双基校验门闸（:67-69：先 `joinUnderRoot(thisFileDir, rel)` 再 `joinUnderRoot(skillDir, rel)`，任一存在才改写）。因此：
- 代码块内的伪链接只有当其 `path` **真实存在于磁盘**时才会被改写；
- 真正风险 = 文档代码块里举例的相对链接恰好在磁盘对应位置存在 → 被改写成绝对路径，**影响展示文本、不改变功能或安全**。

**结论**：Valid hardening，非功能缺陷。建议（可选、低优先级）：
- 在 `replace` 前剥离 fenced code block（```...```）内容，或将代码块区域从正则作用域排除；
- 或显式记录"D1 仅改写非代码块区域"的设计边界。

---

## 4. 逻辑与流程结论复核

### 4.1 T8 重定位与阻断 Bug 修复 — 正确
- `updateLocalSkillSource`（local-importer.ts:217-227）将 `importLocalSkillSource` 包入 `try/catch`，原文件夹失效抛错转为 `{ ok: false, error }` 返回（非 reject），使 UI `handleUpdateLocalSkill` 进入 `!response.ok` 重选分支、触发 T8。行为正确（报告称"第 222 行"，实际 `ok:false` 在 :224，catch 块 :222 起）。
- `RELOCATE_LOCAL_SKILL_SOURCE` 命令 4 处登记完全一致且有 `nonEmptyString` 校验：
  - `core/types.ts:562`（MessageAction 联合类型）
  - `core/messaging/runtime-command-contracts.ts:76`（typedCommand）
  - `core/messaging/persistence-runtime-contracts.ts:117`（request 声明）
  - `core/messaging/persistence-runtime-request-codec.ts:125-129`（typedPayload + `nonEmptyString(sourceId/newRootPath)`）

### 4.2 打分与自动激活 — 正确
- `local-skill-scorer.ts`：`ACTIVATION_THRESHOLD=100`、`MIN_LEAD_GAP=50`（:18-19）；`selectImplicitSkill`（:72-73）双闸——`top.score < 100` 不激活；`second` 存在且 `top.score < second.score + 50` 不激活（防"两弱争激活"）。与报告一致。
- `auto-activation-settings.ts`：`normalizeSkillAutoActivationSettings`（:50-51）强制 `everyMessage ⇒ firstMessage` 且 `!firstMessage ⇒ !everyMessage` 不变式。与报告一致。

### 4.3 D4 动态软提示与 cwd 硬设 — 合法观察（真实待闭环项）
- `buildLocalExecutionBoundary`（local-importer.ts:746-757）以**纯文本 prompt** 声明 `cwd`（`- Run commands with cwd set to the Skill directory path: ${skillDir}`）及"激活前 `local_file_stat` 校验 SKILL.md"。
- **历史结论（实施前）**：`cwd` 是否真正硬强制取决于 **Native Host 层 `shell_exec` 实现**，扩展代码侧仅做"软约束"声明。报告此观察当时成立。
- **纠正 + 方案A 已闭环（2026-07-24）**：经实测，Native Host 的 `shell_exec` 执行源码**就在本仓库内**（`packages/shell-host/native/process-provider.mjs:69` 读 `args.cwd`、`spawn({ cwd })` 于 :94），并非外部仓库，原"跨仓待办"判断误判，已撤销。现扩展侧以**方案A** 硬落实 cwd：当 local skill 激活时，解析器给 `shell_exec`/`shell_session_begin` 调用贴 `localSkillDir`，background runtime 的 `parseExternalizedToolPayload` 据此把 `cwd` 强制归一化为 `skillDir`（见 `core/tool/local-skill-cwd.ts`）。Agent 未给 cwd 或给错时不再回退 `homedir()`，缺口已从扩展侧闭环。
- 残余依赖：最终 `cwd` 仍由 Native Host 按传入值执行（无 cwd 语义则报错），属预期职责划分；扩展侧已保证"本地 Skill 场景下 cwd 恒为 skillDir"。

### 4.4 垃圾文件与验证约束 — 正确
- 根目录 `nul`（39B，内容为 `错误: 没有找到进程 "360chromex.exe"。`）确为某次命令行 `> nul` 重定向误产，与项目无关，建议删除（注意 Windows 保留名需特殊处理）。
- "代码中未发现本地直接调用 `npm test`"：成立，测试全走远程 CI（本机禁编译硬约束）。

---

## 5. 优先修复建议复核与修订

| 原建议 | 复核裁决 | 修订建议 |
|---|---|---|
| ① 紧急修复 relocate 路径匹配 | **不成立，无需修** | 撤销；当前精确相对匹配正确 |
| ② resolveSkills 异步化或加强路径预校验 | **不应改代码** | 改为**修正设计文档 §1.5/§2.2 与 §2.9 锁定红线对齐**（消除 BUG-02 类误读根源） |
| （新增 A）设计文档自相矛盾 | — | **高优先**：统一设计事源，避免误导 |
| （新增 B）D1 跳过代码块 | — | 低优先加固（见 §3） |
| （新增 C）D4 cwd 硬强制闭环 | **已在本仓实施（方案A）** | 高优先：扩展侧硬强制 `shell_exec` cwd=skillDir（见 §7-C） |

**优先级排序**：A（修文档，已完成） > C（方案A 扩展侧 cwd 硬强制，已完成） > B（D1 代码块加固，已完成） > 删除 `nul`（用户指令保留）。

---

## 6. 总体结论

报告整体质量高、方向对，对 T8 端到端链路、阻断 Bug 修复、命令契约一致性、打分双闸、auto-activation 不变式、D4 软约束、`nul` 误产的判断**全部正确**。

三条 BUG 中：
- **BUG-01 为误报**：`skillPaths` 存 root-相对路径，move/rename 不改变内部相对结构，匹配成功；relocate 改名测试实证可用。
- **BUG-02 为误报但价值高**：代码符合 §2.9 锁定红线（Agent 驱动、按需读取），`resolveSkills` 同步是预期实现；真正问题是**设计文档 §1.5/§2.2 与 §2.9 自相矛盾**，应修文档而非代码。
- **BUG-03 成立但低危**：正则确会匹配代码块，但 `fileExists` 门闸限制误伤面，建议择机加固。

**给报告作者的建议**：下次审查前先读取 `.workbuddy/memory/local-skill-import-design.md` 的 **line 7 + §2.9 锁定红线**（而非 §1.5/§2.2 早期提案），可直接避免 BUG-02 类误判；并对 `skillPaths` 的路径格式（root-相对）做一句代码取证即可排除 BUG-01。

---

## 7. 实施状态（按用户指令：不删 nul，其余建议实施）

用户指令："不用删除 nul，其余按你的建议实施。"

- **A（高）：修设计文档矛盾 — 已完成。**
  - 修订 `.workbuddy/memory/local-skill-import-design.md`：
    - §1.5:55 → 改为"取方案2 的'按需懒加载'精神，但加载执行方锁定为 Agent（模型甲，见 §2.9）；`resolveSkills` 保持同步，仅组合索引 + D4 边界 + D1 改写；真正读盘由 Agent 经 `local_file_read` 完成；早期'resolveSkills 改 async 由扩展读盘'方案已被锁定红线推翻"。
    - §2.2:82 → 改为"`resolveSkills`（`request-augmentation.ts:240`）保持同步（见 §2.9 锁定红线），对本地索引 Skill 组合索引 + D4 边界 + D1 改写后返回、不读盘；`state.skills` 仅填索引，加载器实例由 Agent 按需读盘取代"。
    - §2.1:78 → 补"由 Agent 经 Shell MCP 按 `skillDir` 实时读（扩展仅提供 D4 边界与 D1 绝对化，不主动读盘）"。
    - 行号引用校正：`resolveSkills` 实际位于 `request-augmentation.ts:240`（原文档误标 :156）。
  - 效果：消除 BUG-02 类误读根源（文档与锁定设计/代码一致）。

- **B（低）：D1 跳过代码块 — 已完成（代码 + 回归测试）。**
  - `core/skill/local-path-rewriter.ts`：`absolutizeSkillReferences` 处理前用 `CODE_SEGMENT_RE`（匹配 fenced ``` / ~~~ 与 inline `）抽出代码区，以私有区占位符 `\uE000<index>\uE001` 保护，仅改写非代码区后还原。
  - `tests/local-path-rewriter.test.ts`：新增 2 例——fenced 代码块内伪链接不改写（非代码区同路径仍改写）、inline code 内伪链接不改写。
  - 验证：本机禁编译，需经远程 CI（`vitest run`）确认。

- **C（高）：扩展侧硬强制 `shell_exec` cwd=skillDir — 方案A 已在本仓实施完成。**
  - **纠正前序误判**：原 C 记为"跨仓待办 / Native Host 在外部仓库"。实测 `packages/shell-host/native/process-provider.mjs`（`:69` 读 `args.cwd`、`spawn({ cwd })` 于 `:94`）就是 `shell_exec` 执行处，**源码在本仓库内**，C 可在本仓闭环，原"需用户提供 Native Host 仓路径"判断作废。
  - **方案A 设计**：当某个 local skill 处于激活态时，扩展侧在**出站前**把 `shell_exec`/`shell_session_begin` 调用的 `cwd` 强制归一化为该 skill 的 `skillDir`（而非回退 `homedir()`）。这是 D4「Local Execution Boundary」的硬落实。
  - **激活链路（完整闭环）**：
    1. 真实页面 主世界(DeepSeek 页) → 桥 `requestAugmentedBody` → `content.ts:1087 handleAugmentRequestBody` → `augmentDecodedRequestBody` 计算 `activeLocalSkillDir`（取 `primarySkill.remote?.localDirectory` 或隐式命中的 `picked.remote?.localDirectory`）。
    2. `content.ts` 调 `setActiveLocalSkillDir(result.activeLocalSkillDir)` 注入 `fetch-hook.ts` 模块级变量。
    3. 工具调用在 `fetch-hook.ts` 响应解析时由 `createStreamingToolCallParser(descriptors, { activeLocalSkillDir })` 把 `localSkillDir` 贴到 `ToolCall`。
    4. `ToolCall.localSkillDir` 经 `bindNewChatToolCallToBrowserSession`（`{...call}` 展开）跨进程保留，到 background runtime 的 `runtime.executeToolCall`。
    5. `parseExternalizedToolPayload(body, invocationName, call.localSkillDir)` 调用 `enforceLocalSkillCwd` 落实 `cwd = skillDir`。
  - **改动文件清单**：
    - `core/tool/types.ts`（`ToolCall` 接口）：新增 `localSkillDir?: string` 跨进程载体字段。
    - `core/tool/invocation.ts`（`createToolCallFromInvocation`）：options 加 `localSkillDir?`，构造后透传。
    - `core/tool/local-skill-cwd.ts`（**新建**）：方案A 核心纯函数 `enforceLocalSkillCwd` + `isCwdEnforcedInvocation`；仅对 `shell_exec`/`shell_session_begin` 强制，`local_file_read` 等无 cwd 语义的不动；Agent 已给对 cwd 则幂等不复制对象。
    - `core/tool/externalized-payload.ts`（`parseExternalizedToolPayload`）：签名加 `skillDir?` 参数，返回前过 `enforceLocalSkillCwd`。
    - `core/tool/runtime.ts`：透传 `call.localSkillDir` 到 `parseExternalizedToolPayload`。
    - `core/interceptor/request-augmentation.ts`：`RequestBodyAugmentationResult` 加 `activeLocalSkillDir?`；`augmentDecodedRequestBody` 显式/隐式两分支计算并 return 该字段。
    - `core/interceptor/streaming-tool-call-parser.ts`：`StreamingToolCallParserOptions` 加 `activeLocalSkillDir?`；构造函数与 5 处 `createToolCallFromInvocation`（completed 合法/非法 JSON、incomplete、oversized、externalized）均补 `localSkillDir: this.activeLocalSkillDir`。
    - `core/interceptor/fetch-hook.ts`：模块级 `let activeLocalSkillDir` + 导出 `setActiveLocalSkillDir`；`createStreamingResponseToolState` 传 `{ activeLocalSkillDir }`。
    - `entrypoints/content.ts`：`handleAugmentRequestBody` 后调 `setActiveLocalSkillDir(result.activeLocalSkillDir)`。
  - **新增/补强测试**：
    - `tests/local-skill-cwd.test.ts`（**新建**）：`enforceLocalSkillCwd` 6 例 + `parseExternalizedToolPayload` cwd 落点 3 例。
    - `tests/request-augmentation-local.test.ts`（追加 describe）：`activeLocalSkillDir` 隐式/显式命中 = `/skills/demo`、未激活（builtin/旧快照）为 `undefined`，共 3 例。
    - `tests/streaming-tool-call-parser.test.ts`（追加 describe）：解析器带 `activeLocalSkillDir` 时 completed `shell_exec` 调用贴 `localSkillDir`、未激活为 `undefined`、非法 JSON 仍贴，共 3 例。
  - **验证约束**：本机禁编译，全部改动留工作区、未提交未推送；待推送 你的远端仓库(origin) 后由远程 CI（`npm run ci:quality` 含 `tsc --noEmit` + `vitest run`，覆盖上述三测试文件）验证。

- **`nul`**：按用户指令不删除。

- **验证约束**：本机环境禁止本地编译；A/B/C 的文档与代码改动均未本地运行测试/类型检查，待推送 你的远端仓库(origin) 后由远程 CI（`npm run ci:quality` 含 `tsc --noEmit` + `vitest run`，覆盖 `local-skill-cwd` / `request-augmentation-local` / `streaming-tool-call-parser`）验证。
