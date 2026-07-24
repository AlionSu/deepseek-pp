# T8 实现方案：本地 Skill 源「文件夹挪动 → 重指定路径」

> 状态：方案草案（未实现，本轮仅起草）
> 依据：`.workbuddy/memory/2026-07-24.md` §10（T8 接线核查）、§11（T8 可复用代码调研）
> 约束：本机禁止本地编译，验证交远程 CI；不改写用户原始 Skill 文件；复用现有弹窗/校验/告知机制。

---

## 0. 目标与范围

- **目标**：本地 Skill 源（`provider === 'local'`）的原文件夹被挪动/改名后，用户可通过弹窗重新选择新路径，系统按新路径重导并刷新关联，全程不破坏已激活引用与用户设置。
- **范围**：仅本地 Skill 源。GitHub 源不涉及。
- **不变量**：
  - 复用 `PICK_LOCAL_SKILL_FOLDER` / `local_folder_pick`（弹窗）、`PREVIEW_LOCAL_SKILL_SOURCE` / `local_skill_preview`（校验）、模型层 `local_file_read`/`local_file_stat`（激活期告知）、`policy.ts` 白名单——**这些零改动**。
  - `source.id` 在重定位后保持稳定，避免激活引用与用户设置断裂。

---

## 1. 复用资产（已确认，零改动）

| 编号 | 资产 | 位置 | T8 用途 |
|---|---|---|---|
| A | 文件夹选择弹窗 | `PICK_LOCAL_SKILL_FOLDER` → `pickLocalSkillFolder`（`core/skill/local-importer.ts:112`）→ `local_folder_pick`（`packages/shell-host/native/picker-provider.mjs:10`） | 弹窗选新文件夹，支持 `defaultPath` |
| B | 路径有效性校验 | `PREVIEW_LOCAL_SKILL_SOURCE` → `previewLocalSkillSource`（`:108`）→ `loadLocalSkillSource`；失败抛 `:160` | 重指定后校验新路径含 SKILL.md |
| C | 激活期存在性告知 | 模型层 `local_file_read`/`local_file_stat`（`file-provider.mjs`）读盘失败即告知；`updateLocalSkillSource` 链路 `:211`/`:160` 文案 | 未重指定而失效时，激活自然告知 |
| D | 契约/白名单已就绪 | `core/shell/policy.ts:14,19`、`core/types.ts:560` 等命令契约 | 复用既有命令，契约层零改动 |

---

## 2. 改动清单（按文件）

### 2.1 `core/skill/local-importer.ts`（底层核心）

新增 `relocateLocalSkillSource`。**关键设计：原地更新 `source` 记录、保留 `source.id`**，不调用 `importLocalSkillSource`（后者会 `createLocalSourceId(rootPath)` 生成新 id，导致关联断裂）。

```ts
export async function relocateLocalSkillSource(
  sourceId: string,
  newRootPath: string,
  deps: LocalSkillImportDeps,
): Promise<LocalSkillImportResponse> {
  if (!sourceId) throw new Error('Local Skill source id must be a non-empty string.');
  if (!newRootPath?.trim()) throw new Error('New root path must be a non-empty string.');
  const sources = await getAllSkillSources();
  const source = sources.find((candidate) => candidate.id === sourceId);
  if (!source || source.provider !== 'local') {
    throw new Error('Local Skill source was not found'); // 复用 :211 文案
  }
  // 用新路径读取 bundle（复用 preview/load 逻辑）
  const loaded = await loadLocalSkillSource(newRootPath.trim(), source.skillPaths, undefined, deps);
  // 原地更新现有 source 记录，保留 source.id（稳定关联）
  const updated: LocalSkillSource = {
    ...source,
    rootPath: loaded.source.rootPath,
    displayName: loaded.source.displayName,
    directoryName: loaded.source.directoryName,
    skillPaths: loaded.source.skillPaths,
    warnings: loaded.source.warnings,
    importedSkillNames: loaded.imported.map((skill) => skill.name),
    updatedAt: Date.now(),
    lastCheckedAt: Date.now(),
  };
  await persistLocalSkillSource(updated); // 复用 importLocalSkillSource 内部的持久化 API
  return buildLocalSkillImportResponse(
    updated,
    loaded.imported,
    /* replaced */ [],
    /* renamed */ [],
    loaded.preview.warnings,
  );
}
```

- 复用：`loadLocalSkillSource`（`:220`）、`getAllSkillSources`、`persistLocalSkillSource`（参照 `importLocalSkillSource` 内部写法）。
- 错误处理：复用 `:160`（路径未找到）、`:211`（source 未找到）。

### 2.2 `core/types.ts`（命令契约）

新增命令类型（**推荐方案 A：语义隔离**，不污染 `UPDATE_LOCAL_SKILL_SOURCE` 的"原地重导"语义；位置紧邻 `:560`）：

```ts
| { type: 'RELOCATE_LOCAL_SKILL_SOURCE'; payload: { sourceId: string; newRootPath: string } }
```

> 备选方案 B（最小改动）：仅扩展 `UPDATE_LOCAL_SKILL_SOURCE` payload 加 `newRootPath?: string`。不推荐，因会混入"重定位"语义。

### 2.3 `core/messaging/*`（三处登记，参照 `PICK_LOCAL_SKILL_FOLDER` 的登记）

- `runtime-command-contracts.ts:73`：登记 `RELOCATE_LOCAL_SKILL_SOURCE: typedCommand('payload-decoded', 'value', 'background-error', 'live-and-declared', 'required')`。
- `persistence-runtime-request-codec.ts:119`：加 `RELOCATE_LOCAL_SKILL_SOURCE(value)` 编解码（payload：`sourceId` + `newRootPath`，均必填 string，校验非空）。
- `persistence-runtime-contracts.ts:109`：加 request/response 契约声明。

### 2.4 `entrypoints/background/skill-handlers.ts`

- 接口 `LocalSkillSourceMutationHandlers` 加声明（参照 `:35` `importLocalSkillSource`）：
  ```ts
  relocateLocalSkillSource(sourceId: string, newRootPath: string): Promise<LocalSkillImportResponse>;
  ```
- 新增 handler（参照 `:91` PICK / `:100` UPDATE）：
  ```ts
  definePersistencePayloadRuntimeCommandHandler('RELOCATE_LOCAL_SKILL_SOURCE', async (payload, context) => {
    const result = await dependencies.relocateLocalSkillSource(payload.sourceId, payload.newRootPath);
    if (!result.ok) return result;
    await dependencies.broadcastStateUpdate(context.tabId);
    return result;
  });
  ```

### 2.5 `entrypoints/background/persistence-mutation-bindings.ts`

- 接口加（参照 `:48`）：
  ```ts
  relocateLocalSkillSource(sourceId: string, newRootPath: string): Promise<LocalSkillImportResponse>;
  ```
- 实现（参照 `:71` `importLocalSkillSource`）：
  ```ts
  relocateLocalSkillSource: (sourceId: string, newRootPath: string) =>
    dependencies.relocateLocalSkillSource(sourceId, newRootPath, {
      ...runner,
      executeToolCall: dependencies.executeLocalSkillImporterToolCall,
    }),
  ```

### 2.6 `entrypoints/background.ts`

注入点（`:29` 导入 / `:370` 解构 / `:436` 对象字面量，三处与 `importLocalSkillSource` 对称）加入 `relocateLocalSkillSource`。

### 2.7 `entrypoints/sidepanel/pages/SkillPage.tsx`（UI 触发）

修改 `handleUpdateLocalSkill`（`:313`）：

1. 先发 `UPDATE_LOCAL_SKILL_SOURCE`（原地重导）。
2. 若 `response.ok === false` 且错误指示 `rootPath` 失效（或用户在提示条主动点"重新选择"），调用 `PICK_LOCAL_SKILL_FOLDER` 带 `defaultPath: skill.remote?.localDirectory ?? ''`。
3. 拿到 `newRootPath` 后发 `RELOCATE_LOCAL_SKILL_SOURCE`。
4. picker 取消（`response` 含取消标记/异常）→ 静默回退，不报错。

新增 UI 提示条：当检测到 `rootPath` 失效（重导失败或 source 标记 `needsRelocate`），显示"原文件夹已挪动，请重新选择" + "重新选择文件夹"按钮（复用 `FolderPickerIcon` 与 `pickFolder` 模式）。状态 `relocating` 防重入（参照 `picking` 模式）。

### 2.8 `core/i18n/resources/zh-CN.ts` & `en.ts`

新增：
- `sidepanel.skillPage.relocatePrompt`：`'原文件夹已挪动或不存在，请重新选择本地 Skill 文件夹。'` / `'The original folder was moved or no longer exists. Please reselect the local Skill folder.'`
- `sidepanel.skillPage.relocateButton`：`'重新选择文件夹'` / `'Reselect folder'`

复用现有 `pickFolder`、`importFailed`、`pickFailed`。

---

## 3. 关键设计决策

- **RELOCATE 命令 vs 扩展 UPDATE**：选 RELOCATE，语义隔离，最小意外。
- **id 稳定性**：`relocateLocalSkillSource` 原地更新 `source` 记录、保留 `source.id`（不调 `importLocalSkillSource` 生成新 id），避免激活引用、禁用状态、用户设置断裂。这是相对"调 `importLocalSkillSource` 创建新 source"的更稳健选择。
- **selectedPaths 差异**：新路径下文件集可能变化。`relocateLocalSkillSource` 用旧 `skillPaths` 先尝试；若某些 path 在新路径不存在，`loadLocalSkillSource` 会抛 `:160`（复用），UI 提示用户重新选择或调整。
- **用户取消**：picker 取消静默回退，保留原 source 不变。

---

## 4. 验证与测试

- **单测**（`tests/local-skill-importer.test.ts` 扩展）：
  - `relocateLocalSkillSource` 正常重定位 → `source.rootPath` 更新、`source.id` 不变、响应 `ok`。
  - `newRootPath` 无 SKILL.md → 抛 `:160`。
  - `newRootPath` 为空 → 抛参数错误。
  - `sourceId` 不存在 → 抛 `:211`。
- **集成/E2E**：模拟文件夹挪动 → 触发重选 → 验证激活后 `local_file_read` 指向新路径。
- **远程 CI**：type-check / build / test 全交 CI（本机禁编译）。

---

## 5. 风险与回滚

- **风险1**：若某些上游状态按 `sourceId` 缓存且未随 `broadcastStateUpdate` 刷新。因 `source.id` 保留，理论上无需恢复；极端情形重激活即可。
- **风险2**：大文件夹重导耗时。`relocating` 防重入 + 复用现有 `requestMs: 120_000` 超时。
- **回滚**：T8 为新命令 + 新函数，不影响既有 `UPDATE`/`IMPORT`；若出问题可禁用 RELOCATE 入口，旧行为不变。

---

## 6. 实施顺序

1. 底层 `relocateLocalSkillSource` + 单测（`local-importer.ts`）。
2. 命令契约 + 三处 `messaging` 登记（`types.ts` + 3 文件）。
3. background handler + bindings + `background.ts` 注入（`skill-handlers.ts` + `persistence-mutation-bindings.ts` + `background.ts`）。
4. UI 触发 + 提示条 + i18n（`SkillPage.tsx` + `resources`）。
5. 远程 CI 验证。

---

## 7. 实施记录（实际偏差与修正）

### 7.1 已落地改动（共 11 文件）

底层与命令契约：
- `core/skill/local-importer.ts`：新增 `relocateLocalSkillSource`（原地更新、保留 `source.id`）；**修正 `updateLocalSkillSource`**（见 7.2）。
- `core/types.ts`：MessageAction 联合类型加 `RELOCATE_LOCAL_SKILL_SOURCE`（实际 :562）。
- `core/messaging/runtime-command-contracts.ts`：`typedCommand` 登记（实际 :76）。
- `core/messaging/persistence-runtime-request-codec.ts`：`RELOCATE_LOCAL_SKILL_SOURCE(value)` 编解码 + `nonEmptyString` 校验 `sourceId`/`newRootPath`（实际 :125）。
- `core/messaging/persistence-runtime-contracts.ts`：request/response 声明（实际 :117）。

Background 注入：
- `entrypoints/background/skill-handlers.ts`：接口 + handler（实际 :37 / :107）。
- `entrypoints/background/persistence-mutation-bindings.ts`：依赖接口 + 绑定接口 + 实现（实际 :38 / :57 / :87）。
- `entrypoints/background.ts`：导入 + 解构进 bindings + `skill` 对象（实际 :32 / :373 / :440）。

UI + i18n：
- `entrypoints/sidepanel/pages/SkillPage.tsx`：`pickNewLocalFolder` + 重写 `handleUpdateLocalSkill`（实际 :313 / :326）。
- `core/i18n/resources/zh-CN.ts` & `en.ts`：新增 `sidepanel.skillPage.relocatePrompt`（实际 :348）。

测试：
- `tests/local-skill-importer.test.ts`：新增 `relocateLocalSkillSource` 4 用例 + `updateLocalSkillSource` 2 用例（含修复回归）。

> 方案正文里的行号（如 `:73`/`:119`/`:29`/`:370`/`:436`）为起草时预估，实际以 git 落地后的行号为准（已在上文标注）。

### 7.2 关键缺陷修复（端到端阻断）

**问题**：`handleUpdateLocalSkill` 依赖 `UPDATE_LOCAL_SKILL_SOURCE` 返回 `{ ok: false }` 来触发 relocate 分支；但底层 `updateLocalSkillSource` → `importLocalSkillSource` 在"原文件夹被挪动 / 未找到 SKILL.md"时**抛异常**（如 `No SKILL.md was found under this local directory.`），异常会被 UI 的 `catch` 直接吞掉提示错误，**T8 重定位流程永远不会触发**。

**修复**：在 `updateLocalSkillSource` 中将 `importLocalSkillSource` 调用包进 `try/catch`，把文件夹失效导致的抛错转为 `{ ok: false, error }` 返回（与 `importLocalSkillSource` 自身对 `LocalSkillImportBlockedError` 的处理一致）。这样 UI 的 `!response.ok` 分支才能进入、引导用户重选路径并发送 `RELOCATE_LOCAL_SKILL_SOURCE`。新增 `updateLocalSkillSource` 回归测试锁定该行为（空 skills → `ok:false` 且不抛；不存在的 sourceId → 仍抛 `Local Skill source was not found`，契约不变）。

### 7.3 验证（本机禁编译，交远程 CI）

本机环境禁止本地编译（永久记忆硬约束），type-check / build / test 全部交给远程 CI：

- 类型检查：`npm run compile`（= `tsc --noEmit`）。
- 单测：`npm test`（= `vitest run`）；本任务新增用例集中在 `tests/local-skill-importer.test.ts` 的 `relocateLocalSkillSource` / `updateLocalSkillSource` describe。
- 全量质量门：`npm run ci:quality`（含 compile + test + i18n + build:all 等）。

**用户操作建议**：推送到 你的远端仓库(origin) 后由 CI 跑 `ci:quality` 校验；本地无需、也不建议自行 `npm test`/`npm run compile`（会触发本地编译，违反环境硬约束）。如 CI 报类型或测试错误，再据日志定点修复并重新推送。
