# Milestones — pi-agent-core Step B1

| # | Milestone | Target | Criteria | Status |
|:--|:----------|:-------|:---------|:-------|
| 1 | **M-B1 · deepseek-web 正式 provider 注册完成** | After P3-B1 合入 | ① `pi-bundle-budget` 全绿（含 provider probe） ② golden 10/10 ③ 既有 StreamFn 路径测试全绿 ④ provider 注册契约测试绿 ⑤ prompt:freeze 零 diff ⑥ B2 启动条件记录 | Pending |

## Step B 后续（记录，不建 Milestone/Issue，逐项独立 run）

| # | Roadmap Item | 启动条件 | 备注（风险承接） |
|:--|:-------------|:---------|:-----------------|
| B2 | 多后端支持（官方 API 等第二模型后端） | B1 完成 | 复用 `DeepSeekAutomationClient` 端口；每条新后端需独立 Issue 授权（不可违反 D）；消息格式差异（reasoning_content/thinking）、授权 provider 身份扩展、prompt 字节契约评估 |
| B3 | pi skills/agents 生态导入 | B2 完成 | 记忆双轨（pi 自身记忆 vs IndexedDB——必须保持单一权威）、prompt 字节契约（pi 模板不得进入 wire）；每项变更独立 Issue 授权 |
