# Project Overview — pi-agent-core Step B2: 官方 API 第二模型后端

> **Run**: spec:pi-agent-core-official-api ｜ **Mode**: GITHUB_STANDARD ｜ **Base**: origin/main (7d2e52a, B1 治理合入)
> **日期**: 2026-08-05 ｜ **前置**: B1 完成（deepseek-web 已注册为 pi-ai 正式 provider）

## 目标

同一 pi loop 接入第二个模型后端：DeepSeek **官方 API**（`core/deepseek/official-api.ts` 的 `submitOfficialDeepSeekStreaming`，OpenAI 兼容 + reasoning_content），用户可切换（配置 API key 后自动走官方 API，与聊天 `runChatTurn` 的 `apiKey ? 'official-api' : 'web'` 模式一致）。

**非目标**：不改变网页后端行为（B1 交付保持）；不改 prompt 字节契约（buildContinuationPrompt/buildNudgePrompt 产物原样复用）；不引入 OpenAI SDK 依赖树（薄封装现有 `submitOfficialDeepSeekStreaming`）；不新增持久化键（API key/chat config 已存在 `deepseek_pp_official_api_key` / `deepseek_pp_official_api_chat_config`）。

## 现状（B1 完成后）

- `core/inline-agent/pi/deepseek-web-provider.ts`：`createDeepSeekWebProvider(deps)` → `Provider<'deepseek-web'>`，loop 经 `provider.stream` 消费（B1）。
- `core/inline-agent/pi/stream-fn-port.ts`：`DeepSeekStreamFnDeps`（submitTurn/session/serializePrompt/mapToolCall/toolDescriptors/turnDefaults/onTokenSpeed）。
- `core/deepseek/official-api.ts`：`submitOfficialDeepSeekStreaming(input, callbacks, signal)` — OpenAI 兼容 messages 数组（role/content/reasoningContent）+ SSE 流；无页面会话链（无 parentMessageId 概念）。
- `core/chat/api-key.ts`：`getDeepSeekApiKey()`/`saveDeepSeekApiKey()`（storage key `deepseek_pp_official_api_key`）。
- `core/chat/official-api-config.ts`：`getOfficialApiChatConfig()`（model/thinking/reasoningEffort）。
- `entrypoints/background/chat-runtime-service.ts`：聊天已有官方 API 工具循环（`runOfficialToolLoop`）——同一 XML 工具协议（`extractToolCalls`）+ `serializeToolExecutions` + `continueWithToolResults`（i18n `background.chat.continueWithToolResults`）。

## B2 关键设计差异（网页 vs 官方 API）

| 维度 | deepseek-web（B1） | deepseek-api（B2 新增） |
|:-----|:-------------------|:------------------------|
| 协议 | DS 网页 SSE `{p,o,v}` patch + PoW + 页面会话链 | OpenAI 兼容 SSE（choices/delta/reasoning_content），无页面会话链 |
| 消息格式 | 单 prompt 字符串（serializePrompt 序列化 Context） | messages 数组（role/content/reasoningContent），天然接近 pi Context |
| 会话链 authority | `DeepSeekSessionState.parentMessageId`（页面链，防 fork） | 无 parentMessageId；每条消息数组自包含（pi Context 即链） |
| 工具调用 | XML 文本流解析（现有） | 同一 XML 协议（模型输出 XML 文本，`extractToolCalls` 解析）——与聊天官方 API 循环一致 |
| 认证 | 页面 headers（createClientHeaders） | `Authorization: Bearer <apiKey>`（storage 配置） |
| 模型 | deepseek-chat / deepseek-reasoner（web） | 官方 config 模型（deepseek-v4-flash / deepseek-v4-pro）+ thinking/reasoningEffort |
| 用户切换 | 无（默认） | 配置 API key 后自动切官方 API（与聊天一致）；无 key 回退 web |

## B2 设计决策

1. **新 provider `deepseek-api`**：`createDeepSeekApiProvider(deps)` → `Provider<'deepseek-api'>`，薄封装 `submitOfficialDeepSeekStreaming`（不复制协议逻辑，AGENTS.md StreamFn 规则）；`Api = KnownApi | (string & {})` 扩展点，api id `'deepseek-api'`。
2. **StreamFn 端口扩展**：`DeepSeekStreamFnDeps` 增加可选的官方 API 分支或新增 `DeepSeekApiStreamFnDeps`（messages 直传 + reasoning 回调）；契约模块保持纯类型。
3. **loop-adapter 后端选择**：`runPiInlineAgentLoop` 增加后端选择（payload 新增 `modelBackend?: 'web' | 'official-api'`，或按是否有 API key 自动选——与聊天一致，用户侧无需新 UI）；默认 web 保持行为不变。
4. **会话链适配**：官方 API 模式 `session.parentMessageId` 恒 null 不可用——需要新的链权威：pi Context 消息数组（tool 结果作为 user 消息回传，与 `runOfficialToolLoop` 一致）；fail-closed 语义调整为"无链时拒绝工具"的官方 API 等价物（无 responseMessageId 概念，改为 Context 消息完整性检查）。
5. **prompt 字节契约**：序列化仍复用 `buildContinuationPrompt`/`buildNudgePrompt` 产物（作为 user 消息 content）；`prompt:freeze` 必跑零 diff。
6. **体积**：新增 provider probe（deepseek-api）实测增量；`submitOfficialDeepSeekStreaming` 已在 background 使用（chat），content 侧增量需实测。

## 风险承接（B2 增量）

| # | 风险 | 概率 | 影响 | 缓解 |
|:--|:-----|:----:|:----:|:-----|
| (n1) | 官方 API 消息格式与 pi Context 映射错误（reasoning_content/thinking） | 中 | 高 | 映射契约测试（pi Message[] → OfficialDeepSeekMessage[] 逐字段）；官方 API 流测试沿用现有 mock |
| (n2) | 会话链 authority 漂移（无 parentMessageId 的链完整性） | 中 | 高 | 官方 API 模式链权威 = pi Context；工具执行前验证 Context 含有效 assistant 消息；fail-closed 测试 |
| (n3) | 用户切换语义（自动 vs 手动）不明确 | 中 | 中 | 与聊天 `apiKey ? 'official-api' : 'web'` 一致（自动）；无新 UI；行为文档化 |
| (n4) | prompt 字节契约破坏 | 低 | 高 | 序列化复用现有产物；prompt:freeze 零 diff 必跑 |
| (n5) | bundle 增量（官方 API 客户端进入 content） | 中 | 中 | 薄封装无 SDK；provider probe 实测校准 |
| (n6) | 授权 provider 身份扩展（official-api 模式下 tool 授权 subject） | 中 | 高 | tool-bridge callSource 不变（requestId/chatSessionId 仍在）；授权测试回归 |

## 验收方向

- golden 10/10 保持（web 默认路径零变化）；
- 官方 API 后端定向测试全绿（消息映射、reasoning、工具循环、fail-closed、abort）；
- `prompt:freeze` 零 diff；`pi-bundle-budget` 全绿（含 deepseek-api provider probe）；
- 用户切换语义与聊天一致（配置 API key 即用官方 API，无 key 回退 web）；
- 每条新后端独立 Issue 授权（本 run = 官方 API 一条）。

## References

- `docs/archives/pi-agent-core-step-b1/`（B1 归档：MASTER.md / project-overview / risk-assessment / task-breakdown）
- `docs/archives/pi-agent-core-integration/`（Step A 归档）
- `AGENTS.md`（pi-agent-core 集成稳定规则，B1 新增 provider 规则）
- `step-b-handoff.md`（交接文档）
