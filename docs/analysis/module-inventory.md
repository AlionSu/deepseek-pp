# Module Inventory — pi-agent-core 集成

> 范围：与"inline agent loop 替换 + StreamFn 适配"直接相关的模块。全量项目分析见 `docs/archives/deepseek-pp-reliability-compatibility-refactor/analysis/module-inventory.md`。

## 总览表

| Module | Responsibility | Files | Lines | S.U.P.E.R |
|:-------|:---------------|------:|------:|:----------|
| inline-agent | 自研 agent loop + 执行策略 + 渲染 + trace | 9 | ~2003 | S🟡 U🟡 P🟢 E🟡 R🟡 |
| tool-loop/engine | 通用工具执行/续跑循环（注入式解耦） | 1 | 114 | S🟢 U🟢 P🟢 E🟢 R🟢 |
| deepseek | DS 网页会话客户端（认证/PoW/SSE/编解码）+ 官方 API | 10 | ~2223 | S🟢 U🟢 P🟢 E🟢 R🟢 |
| interceptor | 页面透明拦截 + prompt 增强 + 工具调用解析/剥离 | 7 | ~3442 | S🟡 U🟡 P🟢 E🟡 R🟢 |
| tool（invocation 面） | 工具描述/调用建模、XML 解析、授权类型族 | 4 | ~751 | S🟢 U🟢 P🟢 E🟢 R🟢 |
| pi-agent-core（目标引入） | 外部 agent loop 引擎（npm 0.83.0，MIT） | - | 271K dist | S🟡（多功能巨砖，需窄入口） |

## Module Details

### core/inline-agent/（替换主体）
- **Responsibility**: 自研 agent loop——用续跑 prompt 驱动 DS 网页接口循环（流式请求 → 工具调用解析 → 顺序执行 → 渲染/trace）。
- **Public API**: `runInlineAgentLoop(payload: InlineAgentStartPayload, deps: {post, executeTool, signal})`；prompt.ts（`buildContinuationPrompt`/`buildNudgePrompt`/`extractTaskCompleteSignal`/`shouldNudge`）；execution-policy.ts（`selectContinuableToolExecutions`）；renderer.ts；markdown.ts；auto-save.ts；trace-codec/trace-store（key `dpp_inline_agent_traces`，TTL 30 天）；types.ts（`AGENT_*` 7 种消息 + 预算常量）。
- **关键契约**: 与模型后端唯一交互 `submitPromptStreaming(input, {retainAssistantText, onTextChunk, onTokenSpeed}, signal) → ModelTurn{assistantText, responseMessageId, requestMessageId, finished}`；工具调用 = 纯文本流 XML `<invocationName>{JSON}</invocationName>`；会话链安全：`responseMessageId === null && toolCalls.length > 0` 拒绝执行；续跑 prompt 是页面/历史可见 wire 契约（`<original_task>`/`<tool_results>`/`<task_complete>`/占位符 `\u2063\u2064\u2063`）。
- **Transformation Notes**: loop.ts 与 adapter 函数级直连（`submitPromptStreaming/createClientHeaders/createPowHeaders`），未走 `DeepSeekAutomationClient` 端口——替换时接缝必须显式化。R=3 是本次改造靶心。
- **S.U.P.E.R**: S🟡（loop+prompt+policy+render+trace 一模块）U🟡（事件靠隐式回调）P🟢（消息形状已类型化）E🟡（content 上下文假设）R🟡（无事件协议契约测试）。

### core/tool-loop/engine.ts（保留复用）
- **Responsibility**: 通用工具执行/续跑循环，自动化与 inline agent 共用。
- **Public API**: `executeToolCallsSequentially(calls, executeTool, {signal})`；`runToolContinuationLoop<TTurn>(input)`；`createToolExecutionRecord`。
- **关键契约**: 执行器与"谁执行、怎么授权"完全解耦；`ToolLoopExecuteTool = (call) => Promise<ToolExecutionRecord>` 是唯一外部依赖面。
- **Transformation Notes**: pi 的 AgentTool 执行应映射到该注入面（其背后是 background 授权）。

### core/deepseek/（模型后端真源，复用）
- **Responsibility**: DS 网页会话客户端 + 官方 API。
- **Public API**: `automation-client-port.ts` 的 `DeepSeekAutomationClient` 端口（**模型后端接缝的现成定义**）；`active-client.ts`（`createClientHeaders`/`createChatSession`/`createPowHeaders`/`submitPrompt`/`submitPromptStreaming`/`readHistorySnapshot`/`uploadDeepSeekFile`）；`request-codec.ts`（`encodeCompletionRequest`/`normalizeDeepSeekMessageId` u32 严格校验）；`stream-codec.ts`（byte→frame→event→parsed 分层解码、`consumeDeepSeekSseEvents`、`extractResponseTextFromParsed` 4 种 patch 格式、`isStreamFinishedFromParsed`）；`pow.ts`；`official-api.ts`。
- **关键契约**: 请求体 `{chat_session_id, parent_message_id, model_type, prompt, ref_file_ids, thinking_enabled, search_enabled, ...}`；认证 Bearer + `X-DS-PoW-Response` + `x-client-*`；流事件 `{p,o,v}` JSON patch；无原生 function-calling（工具调用全在文本）；`fetchWithNetworkPolicy` 统一网络策略（deadline/4MiB）。
- **Transformation Notes**: P=5。StreamFn 适配器应以 `DeepSeekAutomationClient`/`ModelTurn` 为边界，薄封装、不复制协议逻辑。

### core/interceptor/（页面行为层，保留）
- **Responsibility**: 页面透明拦截（fetch/XHR/IDB）、prompt 增强、流式工具调用解析、SSE 工具块剥离、历史消毒。
- **Public API**: `installFetchHook`/`HookState` 回调注册表（onRequestBody/onHeadersCaptured/onToolCall*/onResponseComplete/onRequestTerminal/onMemoriesUsed）；`augmentRequestBody`；`extractToolCalls`/`stripToolCalls`；`createStreamingToolCallParser`；`createStreamingToolTextAccumulator`；`stripToolCallsFromHistory`。
- **关键契约**: 内部请求带 `X-DPP-Bypass-Hook` 头；`isInlineAgentContinuationRequest` 抑制页面事件（与 inline-agent/prompt.ts 深度耦合）；SSE 帧级 `XmlToolStreamFilter` 剥离工具块。
- **Transformation Notes**: S=3.4 最低分模块（fetch-hook.ts 1461 行一人多职）；但非本 run 改造目标——**只消费、不修改**其行为契约。

### core/tool/（授权边界，保留）
- **Responsibility**: 工具描述/调用建模、XML/DSML 双协议解析、provider 注册/执行/授权类型族。
- **Public API**: `createToolInvocationCatalog`/`createToolCallFromInvocation`；`ToolCall`/`ToolDescriptor`/`ToolAuthorizationSubject`/`ToolAuthorizationGrantSummary`/`ToolCapabilityScope`/`ToolGrantExecutionContext`。
- **关键契约**: wire 协议 `<name>{JSON}</name>` 或 `｜DSML｜`；所有生产执行必须过 runtime 授权路径（grant/trusted 二选一）；`ToolCall.source` 只是路由声明不是授权证据。
- **Transformation Notes**: 不可违反清单 B1-B4 的锚点。pi loop 只能通过现有 `executeTool(call, grantId)` 端口向下调用。

### @earendil-works/pi-agent-core@0.83.0（目标引入，npm 已核实）
- **事实**: 版本 0.83.0；MIT；exports `.` → dist/index.js（环境无关）、`./node` → dist/node.js（Node 专属，content 不可用）；deps：`@earendil-works/pi-ai ^0.83.0`、`diff 8.0.4`、`ignore 7.0.5`、`typebox 1.3.7`、`yaml 2.9.0`（全部纯 JS）；dist 无 `node:` 内置导入；engines node≥22.19。
- **关键接缝**: `agentLoop(prompts, context, config, signal, streamFn) → EventStream<AgentEvent, AgentMessage[]>`；`StreamFn = (model, context, options) => AssistantMessageEventStream`（可完全自定义）；hooks（BeforeToolCall/AfterToolCall/PrepareNextTurn/ShouldStopAfterTurn）；compaction/branch-summary；`QueueMode`（sequential/parallel）；`runAgentLoopContinue`（重试）。
- **Transformation Notes**: `.` 入口 `export *` 全量子模块（含 harness/session/compaction/tools），宽导入会拖入 pi-ai 的 AWS/Anthropic/Google/Mistral SDK 依赖树——必须窄入口导入 + tree-shake 实测。

## 耦合热点清单（本 run 的规划输入）

1. **loop.ts ↔ active-client.ts 函数级耦合（最高优先）**：`runInlineAgentLoop` 直接 import adapter 函数；StreamFn 应把 `DeepSeekAutomationClient`/`ModelTurn` 作为适配器边界。
2. **续跑 prompt wire 契约（隐式最大契约）**：`<original_task>`/`<tool_results>`/`<task_complete>`/占位符被 fetch-hook（事件抑制）、history-cleanup（消毒）、loop（续跑）三方共享；换引擎后识别/消毒逻辑必须保留或同步升级，否则页面历史泄漏内部 prompt。
3. **工具调用协议形状**：ToolCall 与 `｜DSML｜` legacy 遍布 interceptor/tool-parser/history-cleanup/授权还原；pi 自带工具调用编码需双向映射，`streaming-tool-call-parser` 的流式增量/去重/超大 body 外部化语义不能丢。
4. **授权路径必须原样保留**：pi loop 只替换"调用方"；`core/tool/runtime + authorization` 信任边界不能绕过。
5. **SSE 形状共享**：StreamFn 消费的 SSE 形状必须与 interceptor 的 `XmlToolStreamFilter` 共享唯一真源 `stream-codec.ts`。
6. **AGENT_* 事件协议**：7 种消息形状是受保护桥记录；pi 的 AgentEvent 需翻译为该协议或升级协议（涉及 MAIN/content 桥契约变更，需注册表同步）。
7. **预算/节流**：MAX_STEPS/NUDGES/延迟/超时 + `INLINE_AGENT_FULL_TOOL_RESULT_WINDOW=4` 窗口压缩，需映射到 pi 的 step 控制与上下文管理。
8. **会话链安全校验**：`responseMessageId === null && toolCalls.length > 0` 拒绝执行——防 fork 防线必须由适配层承接。
9. **执行记录形状**：`ToolExecutionRecord` 被 prompt 渲染/trace codec/auto-save/history 共用——pi 工具结果需归一化到该形状。
