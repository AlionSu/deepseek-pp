# Task Breakdown — pi-agent-core Step B1: deepseek-web provider 注册

## Overview

- **Total Phases**: 4 ｜ **Total Tasks**: 7（归入 1 个 Issue）｜ **Delivery Batches / PRs**: 3（每批一个 PR，每 PR 一行 `Closes #N`）
- **Estimated Total Effort**: M+（4×S + 2×M + 1×L）
- **工作区**: worktree `/Users/zcl/code/deepseek-pp-worktrees/pi-agent-core-step-b`（分支 `spec/pi-agent-core-provider`）；主工作区只读参照，一律不碰。
- **前置**: Step A 已合入（c283e49）；pi 锁 0.83.0 不动。

## 设计约束（S.U.P.E.R + AGENTS.md）

- **P** 契约先行：provider 端口（deps 形状、注册形状、stream 委托契约）先于实现。
- **S** provider 模块单一职责：只做"注册面 + 委托"，不复制 stream-codec/active-client 协议逻辑。
- **E** 新依赖面（models.js/createProvider）必须 probe 实测体积；禁止重型 API 模块进静态图。
- **R** golden 契约守护：接线批次必须 golden 10/10 + 既有 StreamFn 测试全绿。
- 验证顺序（F）：定向测试 → compile → prompt:freeze → build:all → verify:* → 窄冒烟 → ci:quality。

## Phase 1: provider 端口定义与契约测试（Issue B1）

**Goal**: 零生产行为变化下，把"deepseek-web 注册为 pi-ai provider"的形状固化为契约测试。
**S.U.P.E.R Focus**: P + R。

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B1-T1 | provider 端口定义（`core/inline-agent/pi/provider-port.ts` 或扩展 stream-fn-port）：`DeepSeekWebProviderDeps`、`DeepSeekWebProviderFactory`（`(deps) => Provider<'deepseek-web'>`）纯类型 | P0 | S | — | P1-B1 | P, U | 编译期导出类型断言测试（`Provider<'deepseek-web'>` 可赋值、deps 可构造） | 契约模块 import 面仅 pi 包 + 纯类型相对导入（grep 断言）；compile 绿；生产代码 0 行改动 |
| B1-T2 | provider 注册形状契约测试（`tests/deepseek-web-provider.test.ts`）：createProvider 产物形状（id/api/models/auth/stream 委托）、streamSimple 与 stream 一致性、auth resolve 语义（有 token→headers；无 token→undefined） | P0 | M | B1-T1 | P1-B1 | R, P | 注册形状 + auth 语义单测（mock deps） | 测试绿；测试不 import 生产 provider 实现（先定义后实现）|

**本 phase 验证链**：定向测试 → compile（生产零改动，无 build/prompt 需求，理由记录）。

## Phase 2: provider 注册实现（Issue B1）

**Goal**: `createDeepSeekWebProvider(deps)` 实现——复用 `createDeepSeekStreamFn`/`createDeepSeekTurnSubmitter`，`createProvider` 注册。
**S.U.P.E.R Focus**: S + E。

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B1-T3 | `core/inline-agent/pi/deepseek-web-provider.ts`：`createDeepSeekWebProvider(deps)` → `Provider<'deepseek-web'>`（`createProvider({ id: 'deepseek-web', auth, models, api: { stream, streamSimple } })`）；auth.resolve 读注入 token 提供者；模型目录静态 2 条目 | P0 | M | B1-T1 | P2-B1 | S, E | `tests/deepseek-web-provider.test.ts` 全部改跑真实实现；grep 断言无 openai-completions/pi 模板引用 | 定向测试 + compile 绿；provider 产物形状与 Phase 1 契约一致；未接线 loop（生产行为零变化） |
| B1-T4 | 体积探针扩展：`pi-bundle-budget.mjs` 增加 provider probe（或扩展 adapter probe 导入 `createDeepSeekWebProvider`）并校准预算 | P1 | S | B1-T3 | P2-B1 | E | probe 实测增量报告；护栏绿 | 护栏脚本绿；增量实测记录入 Issue；无 node:/SDK 泄漏 |

**本 phase 验证链**：定向测试 → compile → build:chrome → pi-bundle-budget。

## Phase 3: loop-adapter 接线 + golden 回归（Issue B1）

**Goal**: `runPiInlineAgentLoop` 从 `createDeepSeekWebProvider` 取 model + stream；AGENT_* 事件序列与 golden 逐字节一致。
**S.U.P.E.R Focus**: R（替换）+ U。

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B1-T5 | loop-adapter 接线：替换手工 `Model` 构造 + 直接 `createDeepSeekStreamFn` 为 provider 注册取用；`pacedStreamFn` 包装保留 | P0 | L | B1-T3 | P3-B1 | R, U | `inline-agent-event-protocol-golden.test.ts` 10/10；`stream-fn-adapter.test.ts`/`stream-fn-event-mapping.test.ts` 全绿 | golden 10/10 逐字节；行为不变；prompt:freeze 零 diff |
| B1-T6 | 全量验证 + 体积护栏 + fixtures 检查 | P1 | M | B1-T5 | P3-B1 | R, E | `npm run compile`；`prompt:freeze`；`build:all`；`verify:manifest-policy`/`verify:extension-utf8`；`pi-bundle-budget`（三浏览器）；窄冒烟 | 全链绿；fixtures 无意外 diff（AGENT_* 载荷不变）；无新持久化键 |

**本 phase 验证链**（完整）：定向测试 → compile → prompt:freeze（零 diff）→ build:all → verify:* → 窄冒烟。

## Phase 4: 收尾与归档（Issue B1）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B1-T7 | ci:quality + 治理收尾（Issue 关闭、docs/plan 完成、归档准备） | P1 | S | B1-T6 | P3-B1（随 P3） | E | N/A（收尾；最近验证 = B1-T6 全链绿） | ci:quality 绿（如适用）；Issue 验收清单全勾；B2 启动条件记录（provider 已注册 + 契约测试就位） |

## Delivery Batches

| Batch | Tasks / Issue | Integration Branch | Combined Validation | Depends On | Rationale |
|:------|:--------------|:--------------------|:--------------------|:-----------|:----------|
| P1-B1 | B1-T1..T2 / #B1 | `batch/b1-p1-provider-contract` | 定向测试 + compile | — | 契约先行，生产零改动，评审面干净 |
| P2-B1 | B1-T3..T4 / #B1 | `batch/b1-p2-provider-impl` | 定向测试 + compile + build:chrome + 护栏 | P1-B1 | 实现 + 体积实证，未接线 |
| P3-B1 | B1-T5..T7 / #B1 | `batch/b1-p3-loop-wiring` | 完整验证链 + golden + ci:quality | P2-B1 | 唯一行为接触批次（回滚边界：revert 单 PR 即回退） |

> 每批一个 PR，PR 体含一行 `Closes #B1`；三批同一 Issue（验收清单贯穿）。
