# pi-agent-core 集成 — Progress Tracker

> **Task**: 内置 `@earendil-works/pi-agent-core@0.83.0` 为 inline agent 的 loop 引擎，用自定义 StreamFn 封装 DeepSeek 网页接口为模型后端，替换现有自研 inline-agent loop（保留执行策略/授权/渲染）；Step A 落地，Step B 记路线图。
> **Started**: 2026-07-31
> **Mode**: GITHUB_STANDARD（Labels + Milestones + Issues + PRs，无 Project board）
> **Repository**: `zhu1090093659/deepseek-pp`
> **Branch / Worktree**: `spec/pi-agent-core-integration` @ `/Users/zcl/code/deepseek-pp-worktrees/pi-agent-core-integration`

## References

- [Project Overview](../analysis/project-overview.md)
- [Module Inventory](../analysis/module-inventory.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Dependency Graph](../plan/dependency-graph.md)
- [Milestones](../plan/milestones.md)
- 基线参照：`docs/archives/deepseek-pp-reliability-compatibility-refactor/`（已完成重构记录）、`docs/archives/mcp-capability-plane/`（本次 run 之前刚归档）

## Milestones

| # | Milestone | Target | Criteria | Status |
|:--|:----------|:-------|:---------|:-------|
| 51 | M1 契约与地基就绪 | After Phase 1 | golden 全绿且生产零改动；pi 锁 0.83.0；bundle 红线内；护栏脚本生效 | Pending |
| 52 | M2 Step A 完成（pi loop 替换上线） | After Phase 5 | ci:quality 全绿；旧 loop 删除；prompt:freeze 零 diff；golden 逐字节一致；注册表/AGENTS.md 同步 | Pending |

## Issue Mapping（Task → Issue → Batch → PR → Status）

| Task | Issue | Delivery Batch | PR | Status |
|:-----|:------|:---------------|:---|:-------|
| A0（A0-T1 + A0-T2） | [#511](https://github.com/zhu1090093659/deepseek-pp/issues/511) | P1-B1 | [#516](https://github.com/zhu1090093659/deepseek-pp/pull/516) | **Merged（#511 closed）** |
| A1（A1-T1..3） | [#512](https://github.com/zhu1090093659/deepseek-pp/issues/512) | P2-B1 | [#517](https://github.com/zhu1090093659/deepseek-pp/pull/517) | **Merged（#512 closed）** |
| A2（A2-T1..3） | [#513](https://github.com/zhu1090093659/deepseek-pp/issues/513) | P3-B1 | [#518](https://github.com/zhu1090093659/deepseek-pp/pull/518) | **Merged（#513 closed）** |
| A3（A3-T1..3） | [#514](https://github.com/zhu1090093659/deepseek-pp/issues/514) | P4-B1 | [#519](https://github.com/zhu1090093659/deepseek-pp/pull/519) | In review |
| A2（A2-T1..3） | [#513](https://github.com/zhu1090093659/deepseek-pp/issues/513) | P3-B1 | — | Open |

| A4（A4-T1..2） | [#515](https://github.com/zhu1090093659/deepseek-pp/issues/515) | P5-B1 | — | Open |

## Delivery Batches

| Batch | Issue | Integration Branch | Validation | Depends On | Status |
|:------|:------|:--------------------|:-----------|:-----------|:-------|
| P1-B1 | #511 | `batch/p1-b1-contract-foundation` | golden + compile + build:chrome + pi-bundle-budget | — | **PR #516 in review** |
| P2-B1 | #512 | `batch/p2-b1-deepseek-stream-fn` | 定向测试 + compile + build:chrome + shake 断言 | P1-B1 | **PR #517 merged** |
| P3-B1 | #513 | `batch/p3-b1-tool-bridge-auth` | 定向测试 + compile + prompt:freeze + build | P1-B1 | **PR #518 merged** |
| P4-B1 | #514 | `batch/p4-b1-loop-swap` | 完整验证链（prompt:freeze 零 diff → build:all → verify → 窄冒烟）+ L3 评审 | P2-B1, P3-B1 | **PR #519 in review** |
| P5-B1 | #515 | `batch/p5-b1-validation-closure` | ci:quality 全链 + fixtures diff + 注册表/AGENTS.md 校验 | P4-B1 | Planned |

## Quick Status Commands

```bash
# Issues / PRs of this run
gh issue list --repo zhu1090093659/deepseek-pp --label spec:pi-agent-core-integration --state open
# Milestone progress
gh api repos/zhu1090093659/deepseek-pp/milestones --jq '.[] | select(.number==51 or .number==52) | {number,title,open_issues,closed_issues}'
```

## Current Status

**Active Phase**: Phase 4（P4-B1）PR #519 待 CI/评审
**Active Task**: A0-A3 完成（P1/P2/P3 已合入并关 Issue）；A3 经 L3 评审 FIXED→修复（HIGH-1 全量记录透传 + MEDIUM-2 abort 守卫）
**Blockers**: 无

## Governance Status

**Shared instruction surface**: `AGENTS.md`（唯一项目级真源；root `CLAUDE.md` 禁止）
**Other platform rule surfaces**: 无相关项目规则面
**Memory surface**: Codex native memory
**Memory fallback path**: 无（AGENTS.md 禁止 repo 内 memory 文件）
**主工作区纪律**: 主工作区（`/Users/zcl/code/deepseek-pp`）有其他 Agent 的未提交改动（CP-B1 批次，等其完成后授权提交）；本 run 所有 git 操作/文件改动只在 worktree 内进行，主工作区只读参照。

## Execution Telemetry

- 遥测与 drift 状态按 `references/adaptive-control.md` 存储：**Milestone 描述 YAML 块**（M1=#51、M2=#52，已初始化 thresholds annotate/replan/rescope）。
- 每个任务完成后：收集实际 effort / S.U.P.E.R / 非计划依赖 → 写 Issue 评论 → 更新对应 Milestone YAML 的 drift_score → 阈值触发即自动响应（annotate 20% / replan 40% / rescope 60%）。

## Next Steps

1. 等用户确认（Phase 5a）后开始执行。
2. 执行顺序：P1-B1（A0-T1 ∥ A0-T2 双 lane Tier 2）→ P2-B1 → P3-B1 → P4-B1（L3 评审：A3-T2、A2-T3）→ P5-B1。
3. 每批一个 PR（一行 `Closes #N`）；P4-B1 是唯一行为替换 PR（回滚边界），其前置 = A0-T1 golden 已绿。
4. 全部完成后 Phase 6 归档（`docs/archives/pi-agent-core-integration/`）+ 关闭 Milestones。

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-07-31 | Planning | 归档 MCP capability plane（docs-only 提交 e809010，代码批次留给其主 Agent）；创建 worktree `spec/pi-agent-core-integration`；Phase 1 分析（3 子代理 + npm 事实核查）；Phase 2 决策（直接替换 / B 只记路线图 / 消费现有 prompt 产物）；Phase 3 分解（5 Phases / 13 Tasks / 5 Issues / 5 Batches）+ GitHub 资源（Labels、M1=#51、M2=#52、Issues #511-#515）。 |
