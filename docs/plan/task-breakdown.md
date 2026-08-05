# Task Breakdown — pi-agent-core Step B2: 官方 API 第二模型后端

## Overview

- **Total Phases**: 4 ｜ **Total Tasks**: 7（归入 1 个 Issue）｜ **Delivery Batches / PRs**: 3
- **Estimated Total Effort**: L（4×S + 2×M + 1×L）
- **工作区**: worktree `/Users/zcl/code/deepseek-pp-worktrees/pi-agent-core-step-b2`（分支 `spec/pi-agent-core-official-api`）
- **前置**: B1 完成（deepseek-web provider 已注册）；pi 锁 0.83.0 不动。

## 设计约束（S.U.P.E.R + AGENTS.md）

- **P** 契约先行：官方 API StreamFn 端口（deps 形状、消息映射、链权威声明）先于实现。
- **S** provider 模块单一职责：只做注册面 + 委托，不复制 official-api 协议逻辑。
- **U** 工具授权方向不变：官方 API 模式工具仍经 tool-bridge → background grant。
- **E** 新依赖面（官方 API 客户端进 content）必须 probe 实测体积。
- **R** golden 守护：web 默认路径 10/10；官方 API 是旁路新增（可独立回退）。

## Phase 1: 官方 API StreamFn 端口与消息映射契约（Issue B2）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B2-T1 | 官方 API StreamFn 端口定义（`core/inline-agent/pi/official-api-port.ts` 或扩展 stream-fn-port）：`DeepSeekApiStreamFnDeps`（apiKey 提供者、config 提供者、消息映射器、reasoning 回调）、`DeepSeekApiProviderFactory` 纯类型 | P0 | S | — | P1-B2 | P, U | 编译期导出类型断言 | 契约模块零实现依赖（grep 断言）；compile 绿；生产零改动 |
| B2-T2 | 消息映射契约测试：pi `Message[]` ↔ `OfficialDeepSeekMessage[]` 逐字段（role/content/reasoningContent；toolResult 归一化为 user 消息 + 工具结果文本；thinking 开关） | P0 | M | B2-T1 | P1-B2 | P, R | 映射表测试全绿 | 映射表文档化；测试绿；生产零改动 |

## Phase 2: 官方 API provider 实现（Issue B2）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B2-T3 | `core/inline-agent/pi/official-api-provider.ts`：`createDeepSeekApiProvider(deps)` → `Provider<'deepseek-api'>`，薄封装 `submitOfficialDeepSeekStreaming`（messages 直传 + onReasoningChunk → thinking 事件 + onTextChunk → text 事件）；auth = apiKey 解析 | P0 | M | B2-T1 | P2-B2 | S, E | `tests/deepseek-api-provider.test.ts`（注册形状 + stream 委托 + reasoning 透传 + auth） | 定向测试 + compile 绿；未接线 loop（生产行为零变化） |
| B2-T4 | 体积探针扩展：provider probe 增加 `createDeepSeekApiProvider`；预算校准 | P1 | S | B2-T3 | P2-B2 | E | probe 实测增量报告 | 护栏绿；无 node:/SDK 泄漏 |

## Phase 3: loop-adapter 双后端选择 + 链适配（Issue B2）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B2-T5 | loop-adapter 后端选择：payload 增 `modelBackend?: 'web' \| 'official-api'`（缺省 web 保持 golden 不变）；官方 API 模式走 `createDeepSeekApiProvider`；链权威 = pi Context（工具执行前验证 Context 含有效 assistant 消息，fail-closed） | P0 | L | B2-T3 | P3-B2 | R, U | golden 10/10（web 路径）；官方 API 后端定向测试（工具循环、reasoning、fail-closed、abort） | 双后端选择单一 authority；golden 10/10；prompt:freeze 零 diff |
| B2-T6 | 用户切换接线：调用方（content.ts startInlineAgentLoop 构造 payload 处）按 `getDeepSeekApiKey()` 有无设置 modelBackend（与聊天一致）；无新 UI | P1 | M | B2-T5 | P3-B2 | U | 构造 payload 的单元测试/集成测试 | 切换语义与聊天一致；web 默认路径零变化 |
| B2-T7 | 全量验证：compile + prompt:freeze + build:all + verify:* + 护栏（3 浏览器）+ 窄冒烟 + fixtures 检查 | P1 | M | B2-T5 | P3-B2 | R, E | ci:quality 全链（如适用） | 全链绿；fixtures 无意外 diff；无新持久化键 |

## Delivery Batches

| Batch | Tasks / Issue | Integration Branch | Combined Validation | Depends On | Rationale |
|:------|:--------------|:--------------------|:--------------------|:-----------|:----------|
| P1-B2 | B2-T1..T2 / #B2 | `batch/b2-p1-official-contract` | 定向测试 + compile | — | 契约先行，生产零改动 |
| P2-B2 | B2-T3..T4 / #B2 | `batch/b2-p2-official-impl` | 定向测试 + compile + build:chrome + 护栏 | P1-B2 | 实现 + 体积实证，未接线 |
| P3-B2 | B2-T5..T7 / #B2 | `batch/b2-p3-dual-backend` | 完整验证链 + golden | P2-B2 | 唯一行为接触批次（回滚边界） |

> 每批一个 PR，PR 体含一行 `Closes #B2`；三批同一 Issue（验收清单贯穿）。
