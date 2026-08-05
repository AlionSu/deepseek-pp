# pi-agent-core 集成 Step B1 — Progress Tracker

> **Task**: 将 deepseek-web 模型后端注册为 pi-ai 正式 provider（`createProvider` + `Provider<'deepseek-web'>`），脱离自定义 StreamFn 独有路径；Step B 第一项（B1 → B2 → B3）。
> **Started**: 2026-08-05
> **Mode**: GITHUB_STANDARD（Labels + Milestones + Issues + PRs，无 Project board）
> **Repository**: `zhu1090093659/deepseek-pp`
> **Branch / Worktree**: `spec/pi-agent-core-provider` @ `/Users/zcl/code/deepseek-pp-worktrees/pi-agent-core-step-b`
> **Base**: origin/main (c283e49 — Step A 归档 #521 合入)

## References

- [Project Overview](../analysis/project-overview.md)
- [Risk Assessment](../analysis/risk-assessment.md)
- [Task Breakdown](../plan/task-breakdown.md)
- [Milestones](../plan/milestones.md)
- 交接：`step-b-handoff.md`；Step A 归档：`docs/archives/pi-agent-core-integration/`

## Milestones

| # | Milestone | Target | Criteria | Status |
|:--|:----------|:-------|:---------|:-------|
| 1 | M-B1 deepseek-web 正式 provider 注册完成 | After P3-B1 | 护栏全绿 + golden 10/10 + 既有路径不变 + 契约测试 + freeze 零 diff + B2 启动条件 | Pending |

## Issue Mapping

| Task | Issue | Delivery Batch | PR | Status |
|:-----|:------|:---------------|:---|:-------|
| B1-T1..T7 | #B1（待创建） | P1-B1 / P2-B1 / P3-B1 | 待创建 | Planning |

## Delivery Batches

| Batch | Tasks | Integration Branch | Validation | Depends On | Status |
|:------|:------|:--------------------|:-----------|:-----------|:-------|
| P1-B1 | B1-T1..T2 | `batch/b1-p1-provider-contract` | 定向测试 + compile（生产零改动） | — | Planning |
| P2-B1 | B1-T3..T4 | `batch/b1-p2-provider-impl` | 定向测试 + compile + build:chrome + 护栏 | P1-B1 | Planning |
| P3-B1 | B1-T5..T7 | `batch/b1-p3-loop-wiring` | 完整验证链 + golden + ci:quality | P2-B1 | Planning |

## Quick Status Commands

```bash
gh issue list --repo zhu1090093659/deepseek-pp --label spec:pi-agent-core-provider --state open
```

## Current Status

**Active Phase**: Planning（Phase 1 分析完成）
**Active Task**: B1-T1（provider 端口定义）
**Blockers**: 无

## Governance Status

**Shared instruction surface**: `AGENTS.md`（唯一项目级真源）
**主工作区纪律**: 主工作区（`/Users/zcl/code/deepseek-pp`）只读参照；本 run 所有 git 操作只在 worktree 内进行。

## Session Log

| Date | Session | Summary |
|:--|:--|:--|
| 2026-08-05 | Planning | 读交接文档 + Step A 归档（MASTER/milestones/risk/task-breakdown）；pi-ai 0.83.0 provider 体系事实核查（models.js createProvider、types.d.ts Api/ProviderStreams、auth/types、lazy.js）；创建 worktree `spec/pi-agent-core-provider`；写 analysis/plan/progress 文档。 |
