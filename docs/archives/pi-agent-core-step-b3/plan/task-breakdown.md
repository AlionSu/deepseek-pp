# Task Breakdown — pi-agent-core Step B3: pi skills/agents 生态导入

## Overview

- **Total Phases**: 3 ｜ **Total Tasks**: 6（归入 1 个 Issue）｜ **Delivery Batches / PRs**: 3
- **Estimated Total Effort**: M（2×S + 2×M + 1×L）
- **工作区**: worktree `/Users/zcl/code/deepseek-pp-worktrees/pi-agent-core-step-b3`（分支 `spec/pi-agent-core-skills`）
- **前置**: B2 完成（双后端就位）；pi 锁 0.83.0 不动。

## 现状核查（2026-08-05，决定 B3 范围）

**关键事实**：项目 `core/skill/local-importer.ts` **已完整支持** SKILL.md 目录导入——`parseSkillDoc`（BOM 剥离 + frontmatter name/description/version + body + H1 兜底 + 父目录兜底）、`previewLocalSkillSource`/`pickLocalSkillFolder`/`importLocalSkillSource`（目录递归 + 索引模式 + local_file 激活）、`github-importer.ts` 的 `findSkillPaths`（仓库扫描）。这与 pi 生态的 SKILL.md（agentskills.io 规范）**格式兼容**。

**B3 的实际增量**（非新建解析器）：
1. **契约固化**：`parseSkillDoc` 是内部函数，frontmatter 解析行为只有间接测试（local-skill-importer.test.ts 21 项，含 BOM 用例）。B3 导出解析面 + 补 SKILL.md 解析专项契约测试（frontmatter 变体/畸形/未知字段/嵌套目录）。
2. **pi 特有字段桥接**：pi 的 `disable-model-invocation` frontmatter 字段——项目无此概念（启停由用户控制）。B3 解析为 `metadata` 键（不改变模型可见性语义），未知字段标 `current-gap`。
3. **验证生态兼容**：社区 pi 技能目录（SKILL.md 格式）可直接经现有导入路径使用——契约测试 + 全量验证链证明。

## Phase 1: SKILL.md 解析契约固化（Issue B3）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B3-T1 | 导出 SKILL.md 解析面（`parseSkillMarkdown` 公共函数，包装现有 parseSkillDoc 逻辑，不改变行为）+ 解析契约测试（frontmatter name/description/version/body、H1/父目录兜底、BOM、畸形 frontmatter 标 current-gap、未知字段） | P0 | M | — | P1-B3 | P, R | `tests/pi-skill-importer.test.ts` 解析契约全绿 | 解析行为与现有导入一致（既有 21 项 local-skill-importer 测试保持绿）；compile 绿 |
| B3-T2 | pi 字段桥接契约：`disable-model-invocation` → metadata 键的映射规则测试；`formatSkillsForSystemPrompt`/`formatSkillInvocation` 零引用 grep 断言 | P0 | S | B3-T1 | P1-B3 | P, C | 桥接映射 + grep 断言测试 | 映射表文档化；pi 模板零引用断言绿 |

## Phase 2: pi-importer 桥接实现（Issue B3）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B3-T3 | `core/skill/pi-importer.ts`：`parsePiSkillMarkdown`（包装 B3-T1 解析面 + pi frontmatter 字段桥接）——**零 pi 依赖**（不 import @earendil-works/*）；社区技能目录导入走现有 `previewLocalSkillSource`/`importLocalSkillSource` | P0 | M | B3-T1 | P2-B3 | S, E | `tests/pi-skill-importer.test.ts` 全部改跑真实实现 | 定向测试 + compile 绿；grep 断言无 @earendil-works import；未接线（生产行为零变化） |
| B3-T4 | 体积探针：护栏脚本增加 pi-importer probe（含 local-importer 图）并校准 | P1 | S | B3-T3 | P2-B3 | E | probe 实测增量报告 | 护栏绿；无 node:/SDK 泄漏 |

## Phase 3: 接线与全量验证（Issue B3）

| # | Task | Priority | Effort | Depends On | Delivery Batch | S.U.P.E.R | Test Expectation | Acceptance Criteria |
|:--|:-----|:---------|:-------|:-----------|:---------------|:----------|:-----------------|:--------------------|
| B3-T5 | 接线：社区技能导入入口复用现有 local-importer 调用面（UI/命令不变，仅文档化"支持 pi 生态 SKILL.md 目录"）；prompt 注入走现有增强管线（无需新注入路径） | P0 | L | B3-T3 | P3-B3 | U, C | golden 10/10；prompt:freeze 零 diff；既有 local-skill 测试全绿 | 无 pi 模板进 wire（grep 断言）；导入生态技能后增强契约测试绿 |
| B3-T6 | 全量验证 + 存储边界 + fixtures 检查 | P1 | M | B3-T5 | P3-B3 | R, E | compile + prompt:freeze + build:all + verify:* + 护栏 + 窄冒烟 + ci:quality | 全链绿；pi-storage-boundary 保持；fixtures 无意外 diff |

## Delivery Batches

| Batch | Tasks / Issue | Integration Branch | Combined Validation | Depends On | Rationale |
|:------|:--------------|:--------------------|:--------------------|:-----------|:----------|
| P1-B3 | B3-T1..T2 / #B3 | `batch/b3-p1-skill-contract` | 定向测试 + compile | — | 契约固化，生产零改动（导出不改行为） |
| P2-B3 | B3-T3..T4 / #B3 | `batch/b3-p2-skill-impl` | 定向测试 + compile + build:chrome + 护栏 | P1-B3 | 桥接实现 + 体积实证，未接线 |
| P3-B3 | B3-T5..T6 / #B3 | `batch/b3-p3-skill-wiring` | 完整验证链 + golden + prompt:freeze | P2-B3 | 唯一行为接触批次（回滚边界） |

> 每批一个 PR，PR 体含一行 `Closes #B3`；三批同一 Issue（验收清单贯穿）。
