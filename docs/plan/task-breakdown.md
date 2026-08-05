# Task Breakdown — pi-agent-core Step B3: pi skills/agents 生态导入

## Overview

- **Total Phases**: 3 ｜ **Total Tasks**: 6（归入 1 个 Issue）｜ **Delivery Batches / PRs**: 3
- **Estimated Total Effort**: M+（3×S + 2×M + 1×L）
- **工作区**: worktree `/Users/zcl/code/deepseek-pp-worktrees/pi-agent-core-step-b3`（分支 `spec/pi-agent-core-skills`）
- **前置**: B2 完成（双后端就位）；pi 锁 0.83.0 不动。

## 设计约束（S.U.P.E.R + AGENTS.md）

- **P** 契约先行：SKILL.md 解析契约（frontmatter/body/递归/畸形）先于实现。
- **S** pi-importer 单一职责：只做格式桥接，不 import pi harness，不触碰运行时 loop。
- **U** 技能内容单向流动：文件 → 解析 → 现有存储 → 现有增强管线。
- **E** 零 pi 依赖：纯解析器（浏览器/Node 均可运行）；护栏 probe 实证。
- **C** prompt 字节契约：pi 模板零引用（grep 断言）；prompt:freeze 零 diff。

## Phase 1: SKILL.md 解析契约（Issue B3）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B3-T1 | SKILL.md 解析契约测试（frontmatter name/description/disable-model-invocation + body；目录递归 SKILL.md 优先/根级 .md 兜底；畸形/未知字段） | P0 | M | — | P1-B3 | P, R | `tests/pi-skill-importer.test.ts` 契约部分全绿 | 契约固化；畸形标 current-gap；生产零改动 |
| B3-T2 | 桥接形状契约：SKILL.md 解析结果 ↔ 现有技能记录模型（codec.ts 形状）映射规则测试 | P0 | S | B3-T1 | P1-B3 | P | 映射表测试 | 映射表文档化；测试绿；生产零改动 |

## Phase 2: pi-importer 实现（Issue B3）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B3-T3 | `core/skill/pi-importer.ts`：`parsePiSkillMarkdown`/`importPiSkillDirectory`（纯解析 + 经 local-importer 落库）；零 pi 依赖 | P0 | M | B3-T1 | P2-B3 | S, E | `tests/pi-skill-importer.test.ts` 全部改跑真实实现 | 定向测试 + compile 绿；grep 断言无 @earendil-works import；未接线（生产行为零变化） |
| B3-T4 | 体积探针：护栏脚本增加 pi-importer probe（含 local-importer 图）并校准 | P1 | S | B3-T3 | P2-B3 | E | probe 实测增量报告 | 护栏绿；无 node:/SDK 泄漏 |

## Phase 3: 接线与全量验证（Issue B3）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B3-T5 | 接线：导入入口（复用 local-importer 调用面或新增显式入口）+ prompt 注入走现有增强管线（augmentRequestBody skills 段） | P0 | L | B3-T3 | P3-B3 | U, C | golden 10/10；prompt:freeze 零 diff；注入后增强契约测试 | 无 pi 模板进 wire（grep）；技能注入后行为可测 |
| B3-T6 | 全量验证 + 存储边界 + fixtures 检查 | P1 | M | B3-T5 | P3-B3 | R, E | compile + prompt:freeze + build:all + verify:* + 护栏 + 窄冒烟 + ci:quality | 全链绿；pi-storage-boundary 保持；fixtures 无意外 diff |

## Delivery Batches

| Batch | Tasks / Issue | Integration Branch | Combined Validation | Depends On | Rationale |
|:------|:--------------|:--------------------|:--------------------|:-----------|:----------|
| P1-B3 | B3-T1..T2 / #B3 | `batch/b3-p1-skill-contract` | 定向测试 + compile | — | 契约先行，生产零改动 |
| P2-B3 | B3-T3..T4 / #B3 | `batch/b3-p2-skill-impl` | 定向测试 + compile + build:chrome + 护栏 | P1-B3 | 实现 + 体积实证，未接线 |
| P3-B3 | B3-T5..T6 / #B3 | `batch/b3-p3-skill-wiring` | 完整验证链 + golden + prompt:freeze | P2-B3 | 唯一行为接触批次（回滚边界） |

> 每批一个 PR，PR 体含一行 `Closes #B3`；三批同一 Issue（验收清单贯穿）。
