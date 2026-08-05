# Risk Assessment — pi-agent-core Step B3: pi skills/agents 生态导入

## S.U.P.E.R Architecture Health（B3 视角）

| Principle | Status | Findings（B3 变更面） | Priority |
|:----------|:-------|:---------------------|:---------|
| **S** Single Purpose | 🟢 | pi-importer 单一职责：SKILL.md 解析 + 桥接现有导入管线 | 低 |
| **U** Unidirectional Flow | 🟢 | 技能内容单向：文件 → 解析 → 现有存储 → 现有增强管线 | 低 |
| **P** Ports over Implementation | 🟢 | 复用 `core/skill` 记录模型与 local-importer 端口；pi-importer 零 pi 依赖 | 低 |
| **E** Environment-Agnostic | 🟢 | 纯解析器（无 FileSystem/Shell ExecutionEnv）；浏览器/Node 均可运行 | 低 |
| **R** Replaceable Parts | 🟢 | 格式桥接可替换（换解析器不影响存储/注入） | 低 |

## Risk Matrix（B3 增量）

| # | 风险项 | 概率 | 影响 | 缓解方向 |
|:--|:-------|:----:|:----:|:---------|
| (p1) | 记忆/会话双轨（pi session/memory 落持久化） | 低 | 高 | pi 上下文只作工作内存（既有规则）；技能只进现有 Skill 存储；无新持久化键（pi-storage-boundary 守护） |
| (p2) | prompt 字节契约破坏（pi system-prompt 模板进 wire） | 低 | 高 | 不消费 `formatSkillsForSystemPrompt`/`formatSkillInvocation`（grep 断言零引用）；prompt:freeze 零 diff 必跑 |
| (p3) | 导入格式兼容性（frontmatter 变体/编码/嵌套/未知字段） | 中 | 中 | 解析器契约测试（合法/畸形/未知字段）；畸形行为标 `current-gap` 不升级为合法 fixture |
| (p4) | 体积（import pi harness 拖入 FileSystem/Shell 依赖） | 中 | 中 | pi-importer 零 pi 依赖（纯解析，不 import @earendil-works/*）；护栏 probe 实测 + sdkMarkers 门 |
| (p5) | 社区技能内容安全（指令注入/恶意 frontmatter） | 中 | 高 | 与现有本地技能同信任面（用户显式导入）；只注入 prompt 不自动执行；复用现有授权/消毒路径 |
| (p6) | 与现有技能注册表冲突（同名/重复导入） | 中 | 中 | 复用 local-importer 既有去重/覆盖语义；契约测试 |

## 不可违反清单（B3 映射）

- **A（inline-agent 语义）**：AGENT_* 事件协议逐字节不变（golden 10/10）。
- **B（工具授权红线）**：技能导入不触及工具执行；不变。
- **C（prompt 字节契约）**：prompt:freeze 零 diff；技能经现有增强管线注入；pi 模板零引用。
- **D（SSE/route 契约）**：不触及。
- **E（fixtures 同步）**：无跨 runtime 契约变更；畸形解析行为只标 `current-gap`。
- **F（验证顺序）**：定向测试 → compile → prompt:freeze → build:all → verify:* → 窄冒烟 → ci:quality。
- **约束 2**：无新持久化键（pi-storage-boundary 保持全绿）。

## 测试面挂载

| 测试面 | 代表文件 | B3 用途 |
|:-------|:---------|:--------|
| SKILL.md 解析（新增） | `tests/pi-skill-importer.test.ts` | frontmatter/body/递归/畸形/未知字段契约 |
| 桥接落库（新增） | 同上或 `tests/pi-skill-importer.test.ts` | 解析 → 现有记录形状 → local-importer 路径 |
| 存储边界 | `tests/pi-storage-boundary.test.ts` | 无新持久化键守护（保持绿） |
| 事件协议 golden | `tests/inline-agent-event-protocol-golden.test.ts` | 10/10 回归 |
| 体积护栏 | `scripts/pi-bundle-budget.mjs` | pi-importer probe（无 pi harness 泄漏） |
