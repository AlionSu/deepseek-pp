# Milestones — pi-agent-core Step B2

| # | Milestone | Target | Criteria | Status |
|:--|:----------|:-------|:---------|:-------|
| 1 | **M-B2 · 官方 API 第二模型后端接入完成** | After P3-B2 合入 | ① golden 10/10（web 路径零变化） ② 官方 API provider 契约测试绿 ③ 双后端选择单一 authority ④ prompt:freeze 零 diff ⑤ 护栏全绿 ⑥ 用户切换语义与聊天一致 ⑦ B3 启动条件记录 | Pending |

## Step B 后续（记录，不建 Milestone/Issue，逐项独立 run）

| # | Roadmap Item | 启动条件 | 备注（风险承接） |
|:--|:-------------|:---------|:-----------------|
| B3 | pi skills/agents 生态导入 | B2 完成 | 记忆双轨（pi 自身记忆 vs IndexedDB——必须保持单一权威）、prompt 字节契约（pi 模板不得进入 wire）；每项变更独立 Issue 授权 |
