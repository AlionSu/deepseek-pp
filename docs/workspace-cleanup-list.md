# Deepseek-pp 工作区清理清单（只读扫描结论）

> 生成时间：2026-07-24 13:49 GMT+8
> 扫描目的：识别与本项目的「项目代码 / 冒烟测试 / git 仓库管理」无关的过程文件、临时文件，为后续清理工作区做准备。
> 扫描方式：`git status --short`、根目录 `ls`、`Glob` 递归扫描常见临时文件模式、构建产物目录检查。
> 说明：本清单仅列出扫描结论，**未执行任何删除**。任何删除动作需单独授权。

## 一、扫描结论速览

| 检查项 | 结果 |
|---|---|
| 工作区改动 | 20 个已修改 + 9 个未跟踪（共 29 个文件）。经核对均为 T8 功能代码 + 审查清单文档产出，属「项目代码 / 文档」，**不应清理** |
| 构建产物（node_modules / dist / .wxt / .output / coverage / .cache / logs） | 全部不存在（禁本地编译环境，未安装依赖、未构建） |
| 常见临时文件（*.swp / *.bak / *.tmp / *.log / *.orig / *.DS_Store / *~） | 全部不存在（Glob 递归扫描 `**/*.{swp,bak,tmp,log,orig}~` 与 `**/.DS_Store` 均 `No files found`） |
| 根目录 `nul` | **存在（39 字节，Windows 保留名，疑似命令重定向误产，垃圾文件）** |
| `videos/` | 项目宣传资源（`deepseek-pp-promo`），非临时，**保留** |
| `.workbuddy/` | 工具 / 代理状态（审计过程文件 + 设计事源 + 每日日志），**酌情（见第四节）** |

## 二、明确可清理（强烈建议删除）

| 文件 | 路径 | 大小 | 性质 | 删除理由 | 风险与删除方式 |
|---|---|---|---|---|---|
| `nul` | 项目根 `D:\Documents\AI_Work_Temp\Deepseek-pp\nul` | 39 B | Windows 保留设备名误产 | 文件内容为 `错误: 没有找到进程 "360chromex.exe"。`，是某次命令行 `> nul` 重定向误把输出写成了真实文件 `nul`，与项目功能无关 | 极低（非项目文件）。⚠️ 注意：`nul` 为 Windows 保留名，普通 `del nul` 可能失败，需用 Git Bash `rm -f "./nul"` 或 `cmd /c del "\\?\D:\Documents\AI_Work_Temp\Deepseek-pp\nul"` 特殊处理 |

## 三、建议保留但需纳入 git 管理（本次工作产出，非垃圾）

以下未跟踪文件是 T8 功能与审查清单的直接产出，**不是清理对象**，但当前未提交，建议后续走功能分支 + 远程 CI 再提交：

- `docs/local-skill-code-review-checklist.md`（用户指令③要求的第三方审查清单）
- `docs/t8-relocate-implementation-plan.md`（T8 实施计划文档）
- `core/skill/auto-activation-settings.ts`、`core/skill/local-path-rewriter.ts`、`core/skill/local-skill-scorer.ts`（3 个新增 core 模块）
- `tests/auto-activation.test.ts`、`tests/local-path-rewriter.test.ts`、`tests/local-skill-scorer.test.ts`、`tests/request-augmentation-local.test.ts`（4 个新增测试）

> 注：本清理清单文档本身（`docs/workspace-cleanup-list.md`）为过程产物，清理工作完成后可自行删除。

## 四、需用户酌定（工具 / 代理状态，非项目代码但可能有延续价值）

| 文件 / 目录 | 路径 | 说明 | 建议 |
|---|---|---|---|
| `audit-report-2026-07-23.md` | `.workbuddy/audit-report-2026-07-23.md` | 工具审计过程文件（8.2 KB） | 若不再需要审计痕迹可删；否则保留 |
| `memory/local-skill-import-design.md` | `.workbuddy/memory/` | 本地 Skill 导入设计事源 | 跨会话延续有价值，建议保留 |
| `memory/local-skill-scoring-spec.md` | `.workbuddy/memory/` | 隐式打分规格 | 同上 |
| `memory/local-skill-implementation-tasks.md` | `.workbuddy/memory/` | 实施任务清单 | 同上 |
| `memory/2026-07-23.md` / `2026-07-24.md` | `.workbuddy/memory/` | 每日工作日志 | 跨会话延续有价值，建议保留；可按 30 天归档策略蒸馏后删旧 |

> 注：`.workbuddy/` 由 WorkBuddy 运行时管理，其内存 / 审计文件严格说不属于「项目代码」，但属于「工具状态与跨会话记忆」，通常不应随项目代码清理而删除。是否清理请以你的判断为准。

## 五、明确无需清理（项目核心）

- 全部源码：`core/`、`entrypoints/`、`packages/`、`scripts/`、`public/`、`assets/`
- 全部测试：`tests/`（含上述新增 4 个）
- 项目文档：`docs/`（含 T8 计划与审查清单）、`README.md`、`README_EN.md`、`AGENTS.md`、`CONTRIBUTING.md`、`LICENSE`
- 构建配置：`package.json`、`package-lock.json`、`tsconfig.json`、`vitest.config.ts`、`wxt.config.ts`、`.gitignore`、`.gitattributes`、`.github/`
- 宣传资源：`videos/deepseek-pp-promo/`

## 六、下一步（需你确认）

1. **是否删除 `nul`**：垃圾文件，强烈建议删除；因 Windows 保留名，删除方式需特殊处理（见第二节风险列）。
2. **是否清理 `.workbuddy/` 中酌定项**：默认建议保留（延续价值）。
3. **是否将 29 个功能 / 文档改动走功能分支 + CI 提交**：与清理无关，但建议跟进。

请确认上述第 1、2 项后，我再执行删除（如有）。
