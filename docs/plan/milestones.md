# Milestones — pi-agent-core 集成 Step A

| # | Milestone | Target Phase | Criteria | Status |
|:--|:----------|:-------------|:---------|:-------|
| 1 | **M1 · 契约与地基就绪** | After Phase 1（P1-B1 合入） | ① golden 契约测试全绿且生产代码零改动 ② pi-agent-core 精确锁 0.83.0（lockfile 一致） ③ 窄入口 bundle 实测在体积红线内 ④ `pi-bundle-budget` 护栏脚本生效 | Pending |
| 2 | **M2 · Step A 完成（pi loop 替换上线）** | After Phase 5（P5-B1 合入） | ① `ci:quality` 21 段全绿 ② 旧自研 loop 主体已删除（单一权威） ③ `prompt:freeze` 零 diff（prompt 字节零变化） ④ AGENT_* 事件序列与 golden 逐字节一致 ⑤ 体积护栏生效 ⑥ docs/compatibility 注册表 + AGENTS.md 已同步 ⑦ 归档清单就绪（Phase 6） | Pending |

## Step B 路线图（记录，不建 Milestone/Issue）

| # | Roadmap Item | 内容 | 启动条件 | 备注（风险承接） |
|:--|:-------------|:-----|:---------|:-----------------|
| B1 | pi-ai provider 注册 | 把 deepseek-web 模型后端注册为 pi-ai 正式 provider（脱离自定义 StreamFn 独有路径） | Step A 归档后独立 run | 依赖 A1 端口已稳定；关注多 provider 注册表与授权 provider/mode/risk 面扩展 |
| B2 | 多后端支持 | 官方 API / 自动化端口等第二模型后端接入同一 loop | B1 之后 | 复用 `DeepSeekAutomationClient` 端口；每条新后端需 Issue 授权（不可违反 D） |
| B3 | pi skills/agents 生态导入 | 复用 pi 的 agents/skills 配置生态 | B2 之后 | 风险承接：记忆双轨 (h)、prompt 字节契约 (d)——每项变更需独立 Issue 授权 + prompt:freeze |
