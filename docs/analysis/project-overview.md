# Project Overview — pi-agent-core Step B3: pi skills/agents 生态导入

> **Run**: spec:pi-agent-core-skills ｜ **Mode**: GITHUB_STANDARD ｜ **Base**: origin/main (35ddb86, B2 归档合入)
> **日期**: 2026-08-05 ｜ **前置**: B2 完成（双后端就位）

## 目标

复用 pi 的 agents/skills 配置生态：开源 pi 项目有大量社区 skills（SKILL.md 目录 + frontmatter 格式，agentskills.io 规范）。DeepSeek++ 已有完整的本地 Skill 体系（`core/skill/`：registry/codec/parser/local-importer/builtin/auto-activation），B3 = **把 pi 生态的 SKILL.md 技能格式接入 DeepSeek++ 现有 Skill 管线**，使用户可以导入/复用社区技能，同时严格遵守：

- **记忆单一权威（约束 2）**：pi 的 session/memory 一律不落持久化；技能内容只进入 DeepSeek++ 现有 Skill 存储（IndexedDB/local），无新持久化键。
- **prompt 字节契约（约束 5）**：pi 的 system-prompt 模板/`formatSkillsForSystemPrompt` 产物**不得**直接进入 wire；技能内容经现有 `augmentRequestBody`/`buildContinuationPrompt` 管线注入（字节零变化），`prompt:freeze` 必须零 diff。

**非目标**：不引入 pi 的 agents 配置（`~/.pi/agents`）作为运行时真源；不新建第二套技能注册表；不改 pi 锁版。

## 现状（B1/B2 完成后）

- inline agent 双后端：`deepseek-web`（默认）+ `deepseek-api`（官方 API），均经 pi-ai provider 注册。
- 项目技能体系（`core/skill/`）：`registry.ts`（技能注册表）、`codec.ts`、`parser.ts`（`parseSkillCommand`）、`local-importer.ts`、`local-path-rewriter.ts`、`builtin.ts`、`bundled-loader.ts`、`auto-activation-settings.ts`、`github-importer.ts`、`officecli-library.ts`、`spec-driven-develop-library.ts`。
- pi 生态格式（`@earendil-works/pi-agent-core/dist/harness/`）：
  - `Skill { name, description, content, filePath, disableModelInvocation? }`；
  - `loadSkills(env, dirs)`：递归遍历目录，加载 `SKILL.md` + 根级 `.md`，解析 frontmatter（name/description/disable-model-invocation）；
  - `formatSkillsForSystemPrompt(skills)` / `formatSkillInvocation(skill)`：生成 agentskills.io 规范 XML 块——**B3 不消费这两个产物**（prompt 模板不进 wire）。

## B3 设计决策

1. **格式桥接，非运行时依赖**：pi 生态技能 = 文件系统中的 SKILL.md（frontmatter + body）。B3 新增 `core/skill/pi-importer.ts`：解析 SKILL.md → DeepSeek++ 现有技能记录形状（复用 `codec.ts` 的记录模型），经 `local-importer.ts` 既有导入路径落库。**不 import pi-agent-core harness**（避免拖入 FileSystem/Shell ExecutionEnv 依赖面，体积护栏把关）。
2. **SKILL.md 解析器**：frontmatter（name/description/disable-model-invocation）+ body（content）；复用项目现有 YAML/markdown 解析面（不新引入依赖）；目录递归规则与 pi `loadSkills` 一致（SKILL.md 优先，根级 .md 兜底）。
3. **prompt 注入复用现有管线**：导入后的技能走既有增强路径（`augmentRequestBody` 的 skills 段）；`prompt:freeze` 零 diff 必跑。
4. **无新持久化键**：技能落 `core/skill` 现有存储；`tests/pi-storage-boundary.test.ts` 守护不变。
5. **体积**：pi-importer 不 import pi 包（纯解析器）；护栏 probe 扩展实测。

## 风险承接（B3 增量）

| # | 风险 | 概率 | 影响 | 缓解 |
|:--|:-----|:----:|:----:|:-----|
| (p1) | 记忆/会话双轨（pi session 落持久化） | 低 | 高 | pi 上下文只作工作内存（既有规则）；技能内容只进现有 Skill 存储；无新持久化键 |
| (p2) | prompt 字节契约破坏（pi system-prompt 模板进 wire） | 低 | 高 | 禁用 `formatSkillsForSystemPrompt`/`formatSkillInvocation` 产物（grep 断言）；prompt:freeze 零 diff |
| (p3) | 导入格式兼容性（frontmatter 变体/编码/嵌套） | 中 | 中 | 解析器契约测试（合法/畸形/未知字段——畸形标 current-gap）；复用项目 YAML 面 |
| (p4) | 体积（import pi harness 拖入依赖） | 中 | 中 | pi-importer 零 pi 依赖（纯解析）；护栏 probe 实测 |
| (p5) | 社区技能内容安全（指令注入） | 中 | 高 | 技能是用户显式导入的本地内容（与现有本地技能同信任面）；不自动执行、仅注入 prompt；现有授权/消毒路径覆盖 |

## 验收方向

- `prompt:freeze` 零 diff；golden 10/10；
- SKILL.md 导入管线定向测试全绿（解析/落库/注入）；
- `pi-bundle-budget` 全绿（含 pi-importer probe，无 pi harness 泄漏）；
- 无新持久化键（pi-storage-boundary 保持）；
- 每项变更独立 Issue 授权（本 run = SKILL.md 生态导入一条）。

## References

- `docs/archives/pi-agent-core-step-b1/`、`docs/archives/pi-agent-core-step-b2/`（B1/B2 归档）
- `docs/archives/pi-agent-core-integration/`（Step A 归档）
- `AGENTS.md`（pi-agent-core 集成稳定规则）
- `step-b-handoff.md`（交接文档）
