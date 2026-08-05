# Risk Assessment — pi-agent-core Step B1: deepseek-web provider 注册

## S.U.P.E.R Architecture Health（B1 视角）

| Principle | Status | Findings（B1 变更面） | Priority |
|:----------|:-------|:---------------------|:---------|
| **S** Single Purpose | 🟢 | 新增 provider 模块单一职责：注册面 + 委托，不复刻协议 | 低 |
| **U** Unidirectional Flow | 🟢 | provider 只向下调 stream/active-client；不反向持有授权/页面状态（会话链仍在 loop-adapter） | 低 |
| **P** Ports over Implementation | 🟢 | 复用 `stream-fn-port.ts` 契约模块；provider 端口类型可序列化 | 低 |
| **E** Environment-Agnostic | 🟡 | `createProvider` 依赖面（models.js → auth/models-store/event-stream）需 bundle 实测（风险 b2） | 高 |
| **R** Replaceable Parts | 🟢 | golden 契约测试守护；provider 注册可替换为任何 pi-ai provider | 低 |

## Risk Matrix（B1 增量）

| # | 风险项 | 概率 | 影响 | 缓解方向 |
|:--|:-------|:----:|:----:|:---------|
| (b2) | `createProvider`/`models.js` 依赖面拉大 content bundle | 中 | 高 | 只导入 `createProvider` 一个符号；probe 实测增量并校准护栏；保持 `openai-completions`/`openai-responses` 等重型 API 模块不进静态图（lazy 门） |
| (d2) | provider 层误用 pi prompt 模板或改变序列化 | 低 | 高 | 序列化仍由 loop-adapter 注入；provider 无模板引用（grep 断言）；prompt:freeze 零 diff |
| (g2) | provider 持有会话链状态导致 fork | 低 | 高 | `DeepSeekSessionState` 保持 loop-adapter 所有；provider 构造时注入，不新建状态 |
| (a2) | pi-ai 上游类型漂移 | 中 | 中 | 精确锁 0.83.0；`tests/deepseek-web-provider.test.ts` 编译期赋值断言 |
| (f2) | 授权路径被绕 | 低 | 高 | provider 不触碰工具；tool-bridge 不变；golden 全量工具记录载荷回归 |
| (m2) | model.api 标识变更（'openai-completions'→'deepseek-web'）影响 pi 内部逻辑 | 低 | 中 | 核查 agent-loop.js：`model.api` 仅透传给 AssistantMessage/streamFn，无 api 分支；golden 不测 model 元数据；回归全绿即证 |

## 不可违反清单（B1 映射）

- **A（inline-agent 语义）**：AGENT_* 事件协议逐字节不变（golden 10/10）；abort/预算/截断语义不动。
- **B（工具授权红线）**：provider 层零工具逻辑；执行路径不变。
- **C（prompt 字节契约）**：prompt:freeze 零 diff；序列化函数不变。
- **D（SSE/route 契约）**：stream 仍复用 active-client/stream-codec；不复制协议。
- **E（fixtures 同步）**：无跨 runtime 契约变更（AGENT_* 载荷不变）→ 无 fixtures diff；如有意外 diff 立即停查。
- **F（验证顺序）**：定向测试 → compile → prompt:freeze → build:all → verify:* → 窄冒烟 → ci:quality。

## 测试面挂载

| 测试面 | 代表文件 | B1 用途 |
|:-------|:---------|:--------|
| provider 注册契约（新增） | `tests/deepseek-web-provider.test.ts` | 编译期赋值断言 + 注册形状 + stream/streamSimple 委托一致性 + auth resolve |
| 事件协议 golden | `tests/inline-agent-event-protocol-golden.test.ts` | 10 场景逐字节回归（接线后必跑） |
| StreamFn 适配 | `tests/stream-fn-adapter.test.ts`、`stream-fn-event-mapping.test.ts` | 既有路径行为不变 |
| 体积护栏 | `scripts/pi-bundle-budget.mjs` | provider probe 增量校准 |
