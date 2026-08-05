# Risk Assessment — pi-agent-core Step B2: 官方 API 第二模型后端

## S.U.P.E.R Architecture Health（B2 视角）

| Principle | Status | Findings（B2 变更面） | Priority |
|:----------|:-------|:---------------------|:---------|
| **S** Single Purpose | 🟢 | 新增 provider 模块单一职责：注册面 + 委托，不复刻协议 | 低 |
| **U** Unidirectional Flow | 🟢 | provider 只向下调 official-api/network-policy；不反向持有授权/页面状态 | 低 |
| **P** Ports over Implementation | 🟢 | 复用 `DeepSeekAutomationClient` 端口形状与 stream-fn-port 契约模块 | 低 |
| **E** Environment-Agnostic | 🟡 | 官方 API 客户端进入 content bundle 的体积需实测（风险 n5） | 中 |
| **R** Replaceable Parts | 🟢 | golden 契约守护 web 路径；官方 API 是旁路新增 | 低 |

## Risk Matrix（B2 增量）

| # | 风险项 | 概率 | 影响 | 缓解方向 |
|:--|:-------|:----:|:----:|:---------|
| (n1) | 消息映射错误（pi Context → OfficialDeepSeekMessage[]，reasoning_content/thinking） | 中 | 高 | 逐字段映射契约测试；沿用现有官方 API 流 mock；`createOfficialDeepSeekRequestBody` 已有测试 |
| (n2) | 无 parentMessageId 的链完整性（fail-closed 语义变化） | 中 | 高 | 官方 API 模式链权威 = pi Context；工具执行前验证 Context 含有效 assistant 消息；专用 fail-closed 测试 |
| (n3) | 用户切换语义不明确 | 中 | 中 | 与聊天一致（apiKey 有无自动切换）；无新 UI；行为文档化入 Issue |
| (n4) | prompt 字节契约破坏 | 低 | 高 | 序列化复用 buildContinuationPrompt/buildNudgePrompt 产物；prompt:freeze 零 diff 必跑 |
| (n5) | bundle 增量 | 中 | 中 | 薄封装无 SDK（不 import openai 包）；provider probe 实测校准；无 node:/SDK 泄漏门 |
| (n6) | 授权 provider 身份扩展 | 中 | 高 | tool-bridge callSource（requestId/chatSessionId）不变；官方 API 模式仍绑定页面会话；tool-authorization 回归 |
| (n7) | 双后端回归（web 路径被官方 API 分支污染） | 中 | 高 | golden 10/10 必跑；web 默认路径零变化；后端选择单一 authority（payload 字段或 apiKey 检查） |

## 不可违反清单（B2 映射）

- **A（inline-agent 语义）**：AGENT_* 事件协议逐字节不变（golden 10/10）；abort/预算/截断语义不动。
- **B（工具授权红线）**：所有工具执行仍过 background grant；callSource 绑定 requestId/chatSessionId；无第二条执行路径。
- **C（prompt 字节契约）**：prompt:freeze 零 diff；序列化函数不变（产物复用）。
- **D（SSE/route 契约）**：官方 API 契约冻结（`submitOfficialDeepSeekStreaming` 是唯一入口，不复制）；网页协议仍只走 active-client/stream-codec。
- **E（fixtures 同步）**：无跨 runtime 契约变更（AGENT_* 载荷不变）→ 无 fixtures diff；如有意外 diff 立即停查。
- **F（验证顺序）**：定向测试 → compile → prompt:freeze → build:all → verify:* → 窄冒烟 → ci:quality。

## 测试面挂载

| 测试面 | 代表文件 | B2 用途 |
|:-------|:---------|:--------|
| 官方 API provider（新增） | `tests/deepseek-api-provider.test.ts` | 注册形状 + 消息映射 + reasoning 透传 + stream 委托 + auth（apiKey） |
| 消息映射（新增） | 同上或 `tests/pi-official-api-mapping.test.ts` | pi Context ↔ OfficialDeepSeekMessage 逐字段 |
| 事件协议 golden | `tests/inline-agent-event-protocol-golden.test.ts` | web 默认路径 10/10 回归 |
| 官方 API 既有面 | `tests/deepseek-official-api.test.ts`(143) | 底层契约不动（只消费） |
| 工具授权 | `tests/pi-tool-bridge-authorization.test.ts` | 官方 API 模式工具执行仍过 grant |
| 体积护栏 | `scripts/pi-bundle-budget.mjs` | deepseek-api provider probe 增量校准 |
