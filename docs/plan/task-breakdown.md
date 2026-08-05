# Task Breakdown — pi-agent-core 集成 Step A

## Overview
- **Total Phases**: 5
- **Total Tasks**: 13（归入 5 个 Issue：A0–A4）
- **Planned Delivery Batches / PRs**: 5（每批一个 PR，每 PR 一行 `Closes #N`）
- **Estimated Total Effort**: L（10×M + 2×L + 2×S）
- **工作区**: worktree `/Users/zcl/code/deepseek-pp-worktrees/pi-agent-core-integration`（分支 `spec/pi-agent-core-integration`）；主工作区其他 Agent 的未提交改动一律不触碰（只读参照除外）。

## S.U.P.E.R Design Constraints

> 所有任务隐含验收："通过所列原则的 S.U.P.E.R Quick Check"。本 run 靶心（来自 risk-assessment）：**R**（AGENT_* 契约固化 → loop 可替换）、**E**（pi 窄入口可打包实证）、**U**（授权方向红线：pi 只能经现有 `executeTool(call, grantId)` 端口向下调用，pi 反向持有授权/页面状态即架构级违反）。

- **S**：StreamFn 是"薄适配器"单一职责——不复制 fetch/分帧/PoW/SSE 逻辑（`stream-codec.ts` 唯一权威）。
- **U**：数据单向 input→processing→output；pi 层永远不 import 浏览器/DOM/provider 实现。
- **P**：契约先行——StreamFn 端口、事件映射、配置映射先定义 schema 再实现；跨模块 I/O 可序列化；契约模块不得 import 具体实现。
- **E**：所有新依赖显式声明；pi 依赖只走窄入口；无硬编码路径/URL。
- **R**：替换测试——"只触碰本模块即可换掉 pi 引擎"。

## Testing and Governance Constraints

- **测试默认**：本 run 全部任务都涉行为/契约/依赖变更 → 全部要求自动化测试；唯一例外 A4-T2（文档/治理，注明 N/A 理由与最近验证）。
- **验证顺序（AGENTS.md，落到每个任务验收）**：定向测试 → `compile` → `prompt:freeze`（涉 prompt/tool/inline-agent 时）→ `build:all`（跨浏览器/收尾）→ `verify:manifest-policy`/`verify:extension-utf8` → 窄口径 smoke → 收尾 `ci:quality`。单元测试硬 60s 超时。
- **prompt 字节零变化（不可违反 C）**：`prompt:freeze` 必须零 diff；任何 diff 需 Issue 授权 + `prompt:freeze:update` + 人工审查。
- **fixtures 同步义务（不可违反 E）**：runtime-contract（AGENT_* 桥记录/tool-record）、external-runtime（DS route/SSE）、persistence-contract（pi 无新持久化键）随契约变更同步。
- **治理**：GITHUB_STANDARD（Labels + Milestones + Issues + PRs，无 Project board）；Labels：`spec:pi-agent-core-integration` + `spec-driven` + priority/size/phase/lane。
- **记忆面**：Codex native memory（无 repo 内 memory 文件）；稳定规则统一在 A4-T2 沉淀进 AGENTS.md。

## Phase 1: 契约先行与依赖探路（Issue A0）

**Goal**: 零生产行为变化前提下，把 AGENT_* 事件协议固化为 golden 契约，并把 `@earendil-works/pi-agent-core@0.83.0` 精确锁版引入依赖树、实证窄入口可打包、体积可控。
**Prerequisite**: 无（本 run 最前）。
**S.U.P.E.R Focus**: R（契约固化→可替换性）+ E（依赖可打包实证）。

| # | Task | Priority | Effort | Depends On | Lane | Delivery Batch | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:---------------|:----------|:-----------------|:--------------|:--------------------|
| A0-T1 | AGENT_* 事件协议 golden 契约测试（契约先行，生产代码零改动） | P0 | M | — | A | P1-B1 | R, P | 新增 `tests/inline-agent-event-protocol-golden.test.ts` | 协议契约状态记入 native memory；注册表记"AGENT_* 受契约测试保护"（仅记录行） | 8 场景 golden 全绿；`compile` 干净；生产代码 0 行改动（git diff 仅 tests/）；事件载荷形状与 `types.ts` 逐字段对应；验证顺序：定向测试 → compile |
| A0-T2 | pi-agent-core@0.83.0 精确锁版 + 窄入口探路 + 体积护栏 | P0 | M | — | B | P1-B1 | E, S | 探针脚本/测试 + `scripts/pi-bundle-budget.mjs` | 锁版/升级政策记入 native memory（AGENTS.md 正式规则留 A4-T2） | `"@earendil-works/pi-agent-core": "0.83.0"`（无 `^`）+ `overrides` 钉传递依赖；`build:chrome` 通过；bundle raw/gzip 在红线内（background ≤820K/240K）；pi 增量护栏以实测校准；探路结论写入 A0 Issue |

**A0-T1 细则**：8 个场景（自然完成 / 工具执行 / 无工具自然答复 / nudge 链 / nudge 预算耗尽 / abort 静默完成 / 错误路径 / DSML+fallback 解析与 12k 流事件截断），采集 7 种消息（AGENT_STEP_STARTED / AGENT_STREAM_CHUNK / AGENT_TOOL_DETECTED / AGENT_TOKEN_SPEED / AGENT_STEP_COMPLETE / AGENT_LOOP_COMPLETE / AGENT_LOOP_ERROR）的完整事件序列 + 载荷快照为 golden；沿用 `vi.mock('../core/deepseek/adapter')` 现有 seam（A3 替换后 mock 面不变，场景可复用）。

### Parallel Lanes（Phase 1）
| Lane | Tasks | Combined Effort | Merge Risk | Key Files |
|:-----|:------|:----------------|:-----------|:----------|
| A（契约线） | A0-T1 | M | Low（tests/ 新增，零重叠） | `tests/inline-agent-event-protocol-golden.test.ts` |
| B（依赖线） | A0-T2 | M | Low（package.json/lockfile/scripts/） | `package.json`、`scripts/pi-bundle-budget.mjs` |

## Phase 2: StreamFn 模型后端适配（Issue A1）

**Goal**: 用薄适配器把 DS 网页接口封装为 pi 的模型后端（内部复用 `active-client.submitPromptStreaming` 与 `stream-codec`，不复制协议逻辑）；本 phase **不接线到 loop**（生产行为零变化）。
**Prerequisite**: A0 合入（pi 已安装、契约已固化）。
**S.U.P.E.R Focus**: P（端口先行）+ S（薄适配器单一职责）。

| # | Task | Priority | Effort | Depends On | Lane | Delivery Batch | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:---------------|:----------|:-----------------|:--------------|:--------------------|
| A1-T1 | StreamFn 端口定义（契约模块，零实现依赖） | P0 | S | A0-T2 | S1 | P2-B1 | P, U | 编译期导出类型断言测试（risk (a) 版本漂移防线） | StreamFn 边界定义记入 native memory | 端口类型可序列化、被 A1-T2/A3 消费；契约模块 import 面仅纯类型（grep 断言）；compile 绿 |
| A1-T2 | DeepSeekStreamFn 薄适配器实现 | P0 | L | A1-T1 | S1 | P2-B1 | P, E, S | `tests/stream-fn-adapter.test.ts`（事件映射/截断/abort/无-chunk-才重试/token speed 透传） | "stream-codec.ts 唯一协议权威，StreamFn 不复制协议逻辑"记入 native memory | 仅依赖端口 + active-client + stream-codec 纯函数；未接入 loop；定向测试 + compile 绿 |
| A1-T3 | StreamFn ↔ pi 事件流映射契约测试 + 窄入口 tree-shake 测试 | P1 | M | A1-T2 | S1 | P2-B1 | R | 映射表测试（AssistantMessageEventStream 各事件 ↔ AGENT_* 对应）+ bundle shake 断言测试 | 映射表记入 native memory（供 A3 事件翻译层复用） | 映射表文档化（入 A1 Issue）；测试绿；产物无 pi-ai 重型 SDK（断言测试） |

**本 phase 验证链**（batch 级）：定向测试 → compile → build:chrome（不跑 prompt:freeze——无 inline-agent 行为变化，理由记录在 Issue）。

## Phase 3: 工具桥接与授权保真（Issue A2）

**Goal**: pi 的工具执行全部映射到现有授权路径（`executeTool(call, grantId)`，经 `tool-loop/engine` 的 `ToolLoopExecuteTool` 注入面，不发明第二条执行路径）；工具结果归一化为 `ToolExecutionRecord`；防 fork 的 fail-closed 由适配层承接。
**Prerequisite**: A0 合入。
**S.U.P.E.R Focus**: U（授权方向红线）+ P（记录形状 schema）。

| # | Task | Priority | Effort | Depends On | Lane | Delivery Batch | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:---------------|:----------|:-----------------|:--------------|:--------------------|
| A2-T1 | pi AgentTool → 现有执行面桥接 | P0 | M | A0-T2 | S1 | P3-B1 | U, S | `tests/pi-tool-bridge.test.ts`（XML/DSML 双协议、ToolCall.source 仅路由声明） | 授权方向不变量（pi 只能向下调用）记入 native memory | 只消费 `ToolLoopExecuteTool` 注入面；不可违反 B；定向测试 + compile 绿 |
| A2-T2 | 工具结果归一化 + 会话链 fail-closed + 预算映射 | P0 | M | A2-T1 | S1 | P3-B1 | P, U | 归一化单元测试（`ToolExecutionRecord` 形状不变）+ chat-active-loop 联动测试扩展 | 防 fork 防线归属（适配层）记入 native memory | `responseMessageId===null && toolCalls>0` → 拒绝执行（新路径测试证明）；预算常量（25/8/120s/2.5–6.5s/4 窗口）映射表落地；prompt:freeze 零 diff |
| A2-T3 | 授权路径回归测试（每个工具调用过 grant） | P0 | M | A2-T1 | S1 | P3-B1 | U | 扩展 `tool-authorization.test.ts`/`background-tool-authorization-integration` | 无（AGENTS.md 已有红线，测试强化） | 风险 (f) 测试锚点就位；授权链集成测试全绿 |

**本 phase 验证链**（batch 级）：定向测试 → compile → **prompt:freeze（涉工具行为）** → build。

## Phase 4: loop 引擎替换（Issue A3）——单批次 PR 替换（回滚边界）

**Goal**: `runInlineAgentLoop` 改为驱动 pi `agentLoop`（自定义 StreamFn + hooks 注入现有 `buildContinuationPrompt`/`buildNudgePrompt` 产物，禁用 pi 模板）；删除旧自研 loop 主体；AGENT_* 事件序列与 golden 逐字节一致。
**Prerequisite**: A1、A2 合入。
**S.U.P.E.R Focus**: R（替换）+ U（方向）+ P（配置映射 schema）。

| # | Task | Priority | Effort | Depends On | Lane | Delivery Batch | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:---------------|:----------|:-----------------|:--------------|:--------------------|
| A3-T1 | pi loop 适配层（config/hooks/预算映射） | P0 | L | A1-T2, A2-T2 | S1 | P4-B1 | P, S, U | `tests/pi-loop-adapter.test.ts`；grep 断言 pi 模板未被引用 | "pi 上下文仅作当前回合工作记忆，不落新持久化"记入 native memory（风险 h） | agentLoop 接线完成但入口未替换（可独立验证）；hooks 注入现有 prompt 产物；compaction 关闭/按窗口压缩语义；abort 静默；定向测试 + compile + prompt:freeze 绿 |
| A3-T2 | 替换 `runInlineAgentLoop` 主体（删旧 loop） | P0 | M | A3-T1 | S1 | P4-B1 | R, U | 既有 `inline-agent-loop.test.ts` 全部改跑新引擎（mock 面保持 adapter 层）；golden 对照 | 无新增（旧 loop 删除 = 单一权威落实） | loop.ts 仅剩组装层（pi 引擎 + StreamFn + 桥接 + 事件翻译）；旧自研 loop 主体删除（git diff 确认无残留）；post/executeTool 端口签名与 abort 语义不变；**L3 独立评审 APPROVED/FIXED** |
| A3-T3 | 双轨回归与 golden 对齐 | P1 | M | A3-T2（基准 A0-T1） | S1 | P4-B1 | R | golden 在新引擎下全绿（序列+载荷逐字节一致）；inline-agent 全行为测试面回归 | 事件翻译层映射表定稿记入 native memory | AGENT_* 序列与替换前逐字节一致；abort 静默、预算 notice、截断后缀、窗口压缩语义一致；prompt:freeze 零 diff |

**本 phase 验证链**（batch 级，完整走 AGENTS.md 顺序）：定向测试 → compile → **prompt:freeze（必须，零 diff；有 diff 即停，走 Issue 授权 + 人工审查）** → **build:all（三浏览器）** → verify:manifest-policy + verify:extension-utf8 → 窄口径 smoke（受影响运行时：smoke:pow / smoke:web / inline-agent 冒烟路径，至少一次真实命令或工具调用）→ ci:quality 留 A5。

## Phase 5: 验证收尾（Issue A4）

**Goal**: 全量验证链 + 体积护栏生效 + fixtures/注册表/指令面同步 + 归档准备。
**Prerequisite**: A3 合入。
**S.U.P.E.R Focus**: R（回归闭环）+ E（跨浏览器、可复现）。

| # | Task | Priority | Effort | Depends On | Lane | Delivery Batch | S.U.P.E.R | Test Expectation | Memory Impact | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:-----|:---------------|:----------|:-----------------|:--------------|:--------------------|
| A4-T1 | 全量验证与 fixtures 同步 | P0 | M | A3-T3 | S1 | P5-B1 | R, E | `ci:quality` 全链 21 段；fixtures 同步（runtime-contract/external-runtime/persistence-contract）；窄冒烟真实调用 | 无 | ci:quality 全绿；fixtures diff 全部有授权依据（不可违反 E）；pi 无新 IndexedDB/localStorage 键（grep 断言） |
| A4-T2 | 治理与文档收尾（注册表/AGENTS.md/记忆/归档） | P1 | S | A4-T1 | S1 | P5-B1 | E | N/A（文档/治理；理由：无运行时代码变更，最近验证 = ci:quality 已绿；补充静态校验：链接/清单检查） | AGENTS.md 新增稳定规则：① pi 精确锁版升级政策 ② pi 上下文不落持久化 ③ StreamFn 复用 stream-codec 义务；docs/compatibility 注册表更新；native memory 同步；归档准备 | AGENTS.md/注册表 diff 经审查合入；无 repo 内 memory 文件；归档清单就绪 |

## Parallel Lanes 汇总（全 run）

| Lane | Phase | Tasks | Combined Effort | Merge Risk | Key Files |
|:-----|:------|:------|:----------------|:-----------|:----------|
| P1-Lane A（契约线） | 1 | A0-T1 | M | Low（tests/ 新增） | `tests/inline-agent-event-protocol-golden.test.ts` |
| P1-Lane B（依赖线） | 1 | A0-T2 | M | Low（package.json/lockfile/scripts/） | `package.json`、`scripts/pi-bundle-budget.mjs` |
| P2-Lane S1 | 2 | A1-T1 → T2 → T3 | L | —（新增，顺序） | `core/inline-agent/pi/stream-fn-port.ts`、`deepseek-stream-fn.ts`、tests |
| P3-Lane S1 | 3 | A2-T1 → T2 ∥ T3 | M+ | Low–Mid | `core/inline-agent/pi/tool-bridge.ts`、`tests/pi-tool-bridge.test.ts`、tool-authorization 测试面 |
| P4-Lane S1 | 4 | A3-T1 → T2 → T3 | L+ | —（loop.ts 单文件替换，**严禁并行**） | `core/inline-agent/loop.ts`、`core/inline-agent/pi/loop-adapter.ts` |
| P5-Lane S1 | 5 | A4-T1 → T2 | M | — | `tests/fixtures/**`、`docs/compatibility/**`、`AGENTS.md` |

**并行/串行结论**：
- ✅ 可并行：**仅 A0-T1 ∥ A0-T2**（文件零重叠，Tier 2 双 lane）；A2-T2 ∥ A2-T3（低重叠）。
- ❌ 不可并行：A1 内部（T1→T2→T3 硬依赖）；A3 内部（loop.ts 单文件替换，严格顺序）；全部跨批次（每批依赖前批合入）。

## Delivery Batches

| Batch | Tasks / Issue | Execution Waves | Goal and Grouping Rationale | Integration Branch | Combined Validation | Depends On | Split / Single-Issue Rationale |
|:------|:--------------|:----------------|:----------------------------|:-------------------|:--------------------|:-----------|:-------------------------------|
| P1-B1 | A0-T1, A0-T2 / #A0 | W1: Lane A + Lane B 并行 | 零行为变化的"契约 + 地基"PR | `batch/p1-b1-contract-foundation` | golden 全绿 + compile + build:chrome + pi-bundle-budget 绿 | — | 测试-only + 依赖-only 组合，评审面干净、可独立回退 |
| P2-B1 | A1-T1..3 / #A1 | W1: T1 → W2: T2 → W3: T3 | StreamFn 适配面独立落地（纯新增、不接线） | `batch/p2-b1-deepseek-stream-fn` | 定向测试 + compile + build:chrome + shake 断言 | P1-B1 | 与 A2 分离：各自独立适配面，合并则 PR 过大 |
| P3-B1 | A2-T1..3 / #A2 | W1: T1 → W2: T2 ∥ T3 | 授权保真独立评审焦点（安全红线，配 L3） | `batch/p3-b1-tool-bridge-auth` | 定向测试 + compile + prompt:freeze + build | P1-B1 | 授权红线变更需要独立审查焦点 |
| P4-B1 | A3-T1..3 / #A3 | W1: T1 → W2: T2 → W3: T3（严格顺序） | **唯一"行为替换"批次 = 回滚边界** | `batch/p4-b1-loop-swap` | 完整验证链（prompt:freeze 零 diff → build:all → verify → 窄冒烟） | P2-B1, P3-B1 | 用户指定单批次 PR 替换；revert 单 PR 即回退；golden 为安全网 |
| P5-B1 | A4-T1..2 / #A4 | W1: T1 → W2: T2 | 收尾：全量验证 + 治理同步 | `batch/p5-b1-validation-closure` | ci:quality 全链 + fixtures diff + 注册表/AGENTS.md 校验 | P4-B1 | 收尾批次独立于功能代码 |

> 每批一个 PR，PR 体含一行 `Closes #A#`（每批恰一个 Issue）。单 Issue 批次理由已逐批记录（硬依赖链 + 风险隔离 + 回滚边界）。
