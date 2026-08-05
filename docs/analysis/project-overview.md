# Project Overview — pi-agent-core Step B1: deepseek-web 正式 provider 注册

> **Run**: spec:pi-agent-core-provider ｜ **Mode**: GITHUB_STANDARD ｜ **Base**: origin/main (c283e49, Step A 归档合入)
> **日期**: 2026-08-05 ｜ **交接**: step-b-handoff.md（Step A 已合入 main v1.12.2，浏览器实测无问题）

## 目标

把当前"自定义 StreamFn 独有路径"（`core/inline-agent/pi/deepseek-stream-fn.ts` 的 `createDeepSeekStreamFn` 直接构造 pi StreamFn）升级为 **pi-ai 正式 provider 注册**：利用 `Api = KnownApi | (string & {})` 扩展点，将 DS 网页后端注册为 pi-ai 的 `Provider`（`createProvider` + `ProviderStreams`），使 deepseek-web 成为 pi-ai 模型注册表中的一等公民，为 B2（多后端切换）与 B3（skills/agents 生态）铺路。

**非目标**：不改变任何生产行为（golden 10/10 保持）；不引入新持久化；不触碰主工作区；不升级 pi 版本（仍锁 0.83.0）；不引入 OpenAI SDK 依赖树。

## 现状（Step A 交付，2026-08-05 合入）

- `core/inline-agent/pi/deepseek-stream-fn.ts`：
  - `createDeepSeekTurnSubmitter(options)` → `DeepSeekTurnSubmitter`（薄封装 `submitPromptStreaming`，PoW 一次/回合、无-chunk-才重试、120s 步超时）。
  - `createDeepSeekStreamFn(deps)` → `StreamFn`（`(model, context, options) => AssistantMessageEventStream`），内部复用 `createClientHeaders`/`createPowHeaders`/`submitPromptStreaming` + interceptor 的 tool-parser/streaming-tool-call-parser/streaming-tool-text。
- `core/inline-agent/pi/stream-fn-port.ts`：纯类型契约模块（`DeepSeekStreamFnDeps` 等），无具体实现导入。
- `core/inline-agent/pi/loop-adapter.ts`：`runPiInlineAgentLoop` 手工构造 `Model<Api>`（`{ id: 'deepseek-chat', api: 'openai-completions', provider: 'deepseek' }`）+ `pacedStreamFn` 包装后传给 `runAgentLoop`。
- 体积护栏：`scripts/pi-bundle-budget.mjs`（双 probe：pi 裸面 230K/72K、full-A3 430K/145K；node:/SDK 泄漏门；background 红线 raw≤820K/gzip≤240K）。

## pi-ai 0.83.0 provider 体系（事实核查，node_modules 实测）

- `Api = KnownApi | (string & {})`：`KnownApi` 为 10 个已知 api 字符串；自定义字符串（如 `'deepseek-web'`）合法，`ApiOptionsMap` 无条目时回退 `StreamOptions & Record<string, unknown>`。
- `createProvider<TApi>(input: CreateProviderOptions<TApi>)`（`dist/models.js`）：
  - `{ id, name?, baseUrl?, headers?, auth, models, fetchModels?, filterModels?, api }`；
  - `api` 可以是单 `ProviderStreams`（`{ stream, streamSimple }`）或 `Partial<Record<TApi, ProviderStreams>>` 按 `model.api` 分发；无条目时报 stream error；
  - `Provider<TApi>` 接口：`getModels()`、`stream(model, context, options)`、`streamSimple(...)`；`auth` 必填（`ProviderAuth`，`apiKey`/`oauth` 至少其一）。
- `ProviderStreams`（`dist/types.d.ts`）：`{ stream(model, context, options?) => AssistantMessageEventStream; streamSimple(...) }`。
- `AssistantMessageEventStream`：`EventStream<AssistantMessageEvent, AssistantMessage>`，`createAssistantMessageEventStream()` 工厂（已有导入）。
- 参考实现：`providers/deepseek.js` = `createProvider({ id: 'deepseek', baseUrl: 'https://api.deepseek.com', auth: { apiKey: envApiKeyAuth(...) }, models: Object.values(DEEPSEEK_MODELS), api: openAICompletionsApi() })`。注意 `openAICompletionsApi` 是 `lazyApi(() => import('./openai-completions.js'))` —— 重型 SDK 在动态 import 后，静态图不进入 bundle。

## B1 设计决策

1. **自定义 api 形状 `'deepseek-web'`**：DS 网页私有格式（SSE `{p,o,v}` patch、XML 工具调用、PoW、无原生 function-calling）不是 OpenAI 兼容消息格式；pi-ai 现有 `openai-completions` api 的 `convertMessages`/`buildParams` 假设 OpenAI 消息形状，直接复用会违反"不得复制协议逻辑"。因此定义新 api 字符串，`ApiOptionsMap` 之外（回退 `StreamOptions`），由我们自己的 `ProviderStreams` 实现承载。
2. **薄封装复用**：`createDeepSeekWebProvider(deps)` 内部直接复用 `createDeepSeekStreamFn` 与 `createDeepSeekTurnSubmitter`（同一个 body，注册面 = `{ stream: streamFn, streamSimple: streamFn }`）。**不复制** stream-codec/active-client 协议逻辑（AGENTS.md 规则 3）。
3. **auth 形状**：`ProviderAuth` 必填。deepseek-web 的"认证"是页面会话 headers（`createClientHeaders` 从 localStorage 读取 userToken + x-client-*），不是 API key。用 `apiKey.resolve()` 形式表达"已配置"（返回 `{ auth: { headers } }`，source 标记 `'DeepSeek Web session'`）；无 token 时 resolve undefined（未配置）——语义与 pi-ai 的 "ambient credentials" 一致。
4. **模型目录**：静态 `Model<'deepseek-web'>` 列表（`deepseek-chat` / `deepseek-reasoner` 两个 id，api='deepseek-web'），`getModels()` 同步返回。B1 不接 `createModels` 集合，loop-adapter 直接持 provider 对象（最小改动面）。
5. **loop-adapter 接线**：`runPiInlineAgentLoop` 改为 `createDeepSeekWebProvider(deps)` 取 `model` + `stream`，替换手工 `Model` 构造 + `pacedStreamFn`；`pacedStreamFn` 包装保留（行为不变）。`model.api` 由 `'openai-completions'` 变为 `'deepseek-web'`、`provider` 由 `'deepseek'` 变为 `'deepseek-web'`——golden 只断言 AGENT_* 事件载荷，不含 model 元数据，预期全绿。
6. **streamSimple**：与 stream 同一实现（pi loop 只用 stream；streamSimple 是接口要求，映射同一函数）。
7. **体积**：`createProvider` 依赖 `dist/models.js`（auth/context、credential-store、resolve、models-store、api/lazy、event-stream）。这些模块远小于 OpenAI SDK 树；需实测 pi-bundle-budget 增量并校准。禁止把 `openai-completions.js`（OpenAI SDK）引入静态图。

## 风险承接（承自 Step A risk-assessment，B1 新增标注）

| # | 风险 | 概率 | 影响 | 缓解 |
|:--|:-----|:----:|:----:|:-----|
| (b2) | 引入 createProvider 依赖面拉大 bundle | 中 | 高 | 窄入口只导入 `createProvider`/`createModels`（如需）；实测 probe 增量；护栏脚本校准；禁止动态 import 重型 API 模块进静态图 |
| (d2) | prompt 字节契约 | 低 | 高 | provider 不消费 pi 模板；prompt 序列化仍走 loop-adapter 注入的 `serializePrompt`（现有 `buildContinuationPrompt`/`buildNudgePrompt`）；prompt:freeze 零 diff 必跑 |
| (g2) | 会话链 authority 漂移 | 低 | 高 | `DeepSeekSessionState` 仍由 loop-adapter 持有并注入；provider 不持有页面状态 |
| (a2) | pi-ai 版本漂移 | 中 | 中 | 精确锁 0.83.0 不动；契约测试编译期断言 `Provider<'deepseek-web'>` 可赋值 |
| (f2) | 授权路径 | 低 | 高 | provider 不接触工具执行；tool-bridge 不变 |
| (e2) | DS 网页协议变更 | 中 | 中 | stream 仍复用 active-client/stream-codec 唯一权威 |

## 验收方向（承交接文档）

- `pi-bundle-budget` 全绿（含新增 provider probe 或扩展 adapter probe）；
- golden 10/10（`tests/inline-agent-event-protocol-golden.test.ts`）；
- 既有 StreamFn 路径行为不变（`tests/stream-fn-adapter.test.ts`、`stream-fn-event-mapping.test.ts` 全绿）；
- provider 注册契约测试（编译期赋值断言 + 注册形状 + stream 委托一致性）；
- `prompt:freeze` 零 diff；`npm run compile` 干净；浏览器构建通过。

## References

- `docs/archives/pi-agent-core-integration/`（Step A 归档：MASTER.md / milestones.md / risk-assessment.md / task-breakdown.md）
- `AGENTS.md`（pi-agent-core 集成 5 条稳定规则）
- `step-b-handoff.md`（交接文档）
