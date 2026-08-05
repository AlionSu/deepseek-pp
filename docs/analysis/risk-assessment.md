# Risk Assessment — pi-agent-core 集成

## S.U.P.E.R Architecture Health Summary

| Principle | Status | Key Findings | Transformation Priority |
|:----------|:-------|:-------------|:------------------------|
| **S** Single Purpose | 🟡 | inline-agent 一模块多职（loop/prompt/policy/render/trace）；pi-agent-core 是"多功能巨砖"（loop+harness+session+compaction+tools 单包） | 中 |
| **U** Unidirectional Flow | 🟡 | 授权依赖方向是红线：pi loop 只能经现有 `executeTool` 端口向下调用，pi 反向持有授权/页面状态即架构级违反；fetch-hook 全局可变单例、隐式回调 | 高 |
| **P** Ports over Implementation | 🟢 | `DeepSeekAutomationClient` 端口已存在（adapter.ts 已退化 facade）；deepseek 编解码是纯函数单一权威、可序列化 | 低 |
| **E** Environment-Agnostic | 🟡 | pi-agent-core dist 无 `node:` 导入（好迹象），但 engines≥22.19、依赖链含 Node 导向 SDK；MV3 content/SW 无 Node 运行时，需构建产物实证 | 高 |
| **R** Replaceable Parts | 🟡 | loop.ts 可替换性取决于 AGENT_* 事件序列与 trace/renderer/auto-save 耦合，但**无事件协议契约测试**（R 的最弱环节） | 高 |

**Overall Health**: 3/5 principles healthy — Refactoring Needed（改造靶心：R（补事件契约）、E（实证浏览器可打包）、U（授权方向纪律））

### S.U.P.E.R Violation Hotspots

1. **inline-agent 无 loop 事件协议 golden**：AGENT_* 事件序列+载荷只有行为测试。替换 loop 前必须先固化契约，否则 R 无法成立。
2. **pi-agent-core 宽入口导入风险**：`.` 入口 `export *` 全量子模块，连带 pi-ai 681K 与 AWS/Anthropic 等 SDK；必须窄入口 + tree-shake 实测 + 体积护栏。
3. **fetch-hook.ts 1461 行一人多职**（fetch/XHR/IDB hook + SSE 过滤 + 指标 + 历史接线）：非本 run 改造目标，但 StreamFn 不得复制其逻辑，只能复用 stream-codec。
4. **loop.ts 函数级直连 adapter**：替换引擎时接缝必须显式化为 `DeepSeekAutomationClient` 端口。

## Risk Matrix

| # | 风险项 | 概率 | 影响 | 缓解方向 |
|:--|:-------|:----:|:----:|:---------|
| (a) | pi-mono 版本漂移（0.83.0 迭代快） | 中 | 高 | 精确锁版本 + lockfile + `overrides` 钉传递依赖；StreamFn/类型边界契约测试（编译期导出类型断言）；升级走独立 PR 重跑全验证链 |
| (b) | bundle 体积（pi-core 271K + pi-ai 681K；background 余量 ≈187K raw/59K gzip） | 高 | 高 | 只从窄入口导入（agent-loop/types/stream-fn），harness/tools/session/compaction 挡在 bundle 外；集成后实测三浏览器 raw/gzip；扩展预算脚本覆盖 content/background；必要时动态 chunk |
| (c) | 新旧 loop 双轨回归 | 中 | 高 | 先补 loop 事件协议契约测试；双轨仅限开发期 feature-flag，生产单一权威；迁移完成即删旧 loop（AGENTS.md L45） |
| (d) | prompt 字节契约变化（pi 自带 prompt-templates 若直接用会破坏 PR-002/004/005 冻结） | 高 | 高 | pi loop 必须消费现有 `buildContinuationPrompt`/`buildNudgePrompt` 产物（经 StreamFn/PrepareNextTurn 注入），禁用 pi 模板；`prompt:freeze` 必跑；字节变化走 `prompt:freeze:update` + Issue 授权 |
| (e) | DS 网页私有协议变更 | 中 | 高 | StreamFn 做成薄适配器，内部复用 `active-client.submitPromptStreaming`（唯一协议权威），不复制 fetch/分帧；协议契约测试 + external-runtime fixtures 同步 |
| (f) | 工具授权路径被绕过（安全红线） | 中 | 高 | pi 工具执行全部映射到现有 `executeTool(call, grantId)`；新增测试证明每个工具调用都过 grant 一次性预留；拿不到 grant 拒绝执行 |
| (g) | 页面会话与 loop context 分裂（链 fork/edit/regenerate 错乱） | 高 | 高 | pi context 仅作"当前回合工作内存"；会话身份/消息 ID 以页面 session 为准；保留"无 responseMessageId 拒绝执行工具"fail-closed；补 chat-active-loop/edit/regenerate 联动测试 |
| (h) | 记忆双轨（pi session/memory-repo vs IndexedDB memory v30） | 中 | 中 | pi 上下文只做 loop 内工作记忆，不落新持久化路径；IndexedDB 保持单一权威；同步 persistence-contract fixtures |
| (i) | content 上下文生命周期/性能（25 步×120s、nudge、abort、SPA 导航/BFCache、主线程长任务） | 中 | 中-高 | 保留 content-capability 幂等 start/stop 与 abort 传播；预算常量/截断语义原样保留；pi 循环内不持有 DOM/observer/定时器（交给 content 层） |

## 不可违反清单（来自 AGENTS.md，本 run 的硬约束）

- **A（inline-agent 语义）**：保留 continuation/finalization 语义与用户可见行为（`<original_task>`/`<tool_results>`/`<task_complete>`/截断后缀/窗口化压缩/占位符），除非 Issue 明确授权字节变更；AGENT_* 事件协议、trace-codec/trace-store/auto-save/renderer 消费方契约不变；abort 静默完成；执行策略（`selectContinuableToolExecutions`）与预算常量保留。
- **B（工具授权安全红线）**：每次生产工具执行必须过 runtime 授权路径（background grant：receiver-owned document/session + descriptor 快照 + provider/mode/risk + 请求身份 + one-time reservation）；调用方 ToolCall 元数据不是授权证据；MAIN-world payload 不可信；不得发明第二条执行路径。
- **C（prompt 字节契约）**：prompt 字节输出/tool XML 标签/增强顺序冻结；`prompt:freeze` 只读校验，golden 更新仅经 `prompt:freeze:update` + Issue 授权 + 人工审查 diff；inline-agent 行为受影响时 `prompt:freeze` 必跑。
- **D（SSE/route 契约）**：`stream-codec.ts` 是 DS Web 协议唯一权威；请求独立无自动重放；已收 chunk 后不重试（防 fork）；官方 API 契约冻结；页面 auth 只读 `localStorage.userToken`，绝不改写页面存储。
- **E（fixtures 同步义务）**：跨 runtime 契约变更同步 runtime/bridge/tool-record/sandbox fixtures；持久化变更同步 IndexedDB/local-storage/sync fixtures；外部 runtime 变更同步 DeepSeek route/SSE/MCP/Native/Shell fixtures；容忍的畸形行为只能标 `current-gap` + follow-up，不得升级为合法 fixture。
- **F（CI 验证顺序）**：定向测试 → `compile` + 静态 → `prompt:freeze`（涉 prompt/tool/inline-agent 时）→ 受影响构建（跨浏览器 `build:all`）→ `verify:manifest-policy`/`verify:extension-utf8` → 窄口径 smoke → 收尾 `ci:quality`；单元测试硬 60s 超时；禁止 broad catch/静默默认/mock-success/无日志 fallback；删除废弃路径（单一权威）。

## 测试面清单（本 run 可挂载的测试点）

| 测试面 | 代表文件 | 本 run 用途 |
|:-------|:---------|:------------|
| inline-agent | inline-agent-loop.test.ts(417)、prompt(252)、execution-policy(55)、renderer(297)、chat-active-loop(103) | 双轨对照基线；替换后回归 |
| tool-authorization | tool-authorization.test.ts(909)、background-tool-authorization-integration(310) | 证明 pi 工具执行仍过 grant（风险 f 的测试锚点） |
| deepseek stream | deepseek-adapter-stream(356)、active-protocol(162)、protocol-contract(263)、network-policy | StreamFn 复用层的现有保障 |
| interceptor | main-world-interceptor-controller、fetch-hook-request-lifecycle、request-augmentation(487)、xml-tool-stream-filter(118)、streaming-tool-call-parser(313) | 页面行为不变性保障 |
| fixtures | tests/fixtures/{prompt-output, external-runtime, persistence-contract, runtime-contract} | 契约同步义务的落点 |
| **缺口（本 run 需新建）** | - | AGENT_* loop 事件协议 golden；StreamFn ↔ pi 事件流映射测试；pi 窄入口 bundle 树 shake 测试 |
