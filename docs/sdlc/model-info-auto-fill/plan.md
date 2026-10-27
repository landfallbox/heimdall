# 模型信息自动填充 — 实现计划

## 背景 / 问题

0.20.0 在 Router 供应商编辑页选择模型后，只有**价格**被自动匹配（`pricingMode` 自动切到有该模型价格的目录），而**模型信息**（显示名 / 上下文窗口 / 最大输出 tokens / 能力 / 推理强度）完全不填，需手动录入。

**根因**：代码库里不存在「模型 id → 元数据」的数据源。`data/pricing.json` 只有价格；`listVendorModels` 只返回 `string[]`；全仓库没有任何模型 id 到上下文/输出/能力的映射。所以这不是回归，而是**功能从未实现**。

> 注：分支 `agents/sync-model-info-vscode-logic` 是空分支（HEAD 停在 0.19.0，领先 main 0 提交，工作区干净），当时建了但没开工。

## 已确认的决策

| 决策项 | 选择 |
|--------|------|
| 元数据来源 | **独立文件** `data/model-info.json`，复用与 pricing 相同的管道（生成内置兜底 + 远程刷新 + 本地缓存） |
| 填充字段 | **全部**：显示名 + 上下文窗口 + 最大输出 + 能力（toolCalling/vision/thinking）+ 推理强度 |
| 填充策略 | **只填空字段**（only-empty），不覆盖用户已填内容 |
| 自我更新 | **两层**：运行时 24h 自动同步 + 仓库侧脚本自动抓官方模型页开 PR（镜像 pricing-auto-refresh 设计） |

## 数据格式

`data/model-info.json`（单一事实来源，与 `data/pricing.json` 同级同待遇；保鲜方式见下方「自我更新机制」两层设计）：

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-26",
  "models": {
    "deepseek-v4-flash": {
      "displayName": "DeepSeek V4 Flash",
      "contextWindow": 128000,
      "maxOutputTokens": 16384,
      "capabilities": { "toolCalling": true, "vision": false, "thinking": true },
      "supportsReasoningEffort": ["low", "medium", "high"]
    }
  }
}
```

- 以**模型 id 字符串**为键（与价格目录内按 id 匹配一致；不同厂商暴露同一 id 时共享同一份元数据）。
- 所有字段可选；缺某字段则不填该字段。
- 种子数据：先内置一批**真实且规格确定**的模型（gpt-4o / gpt-4.1 / o3 / o4-mini / deepseek-chat / deepseek-reasoner / claude-3-5-sonnet / gemini-2.5-* 等）。目录里未来/新模型（gpt-6-*、gemini-4-*、kimi-k3.*、glm-5.*、mimo-v2.*、deepseek-v4.* 等）规格我无法可靠确认，**不臆造**，先不建条目；无条目时自动填充优雅跳过。

## 自我更新机制（两层，与 pricing 完全对齐）

### 第一层：运行时自动同步（应用侧，无需手动维护）

`data/model-info.json` 走与 `data/pricing.json` **一模一样**的运行时链路：

1. **Router 主进程** 每 24h 从 GitHub 拉取最新（`MODEL_INFO_REMOTE_URL` → `.../main/data/model-info.json`），按 `updatedAt` 比较后写入本地 `model-info-cache.json`（`startModelInfoRefresh`，镜像 `startPricingRefresh`）。
2. **GUI** 每 5min 通过 IPC `model-info:loadCache` 读本地缓存并 `applyModelInfo` 更新内存（`useModelInfoCache`，镜像 `usePricingCache`）。
3. **内置兜底**：`src/model-info-data.ts`（由 `data/model-info.json` 生成）保证离线/首启也有数据；远程失败时保留上一次缓存。

### 第二层：仓库侧自动保鲜（数据源侧，镜像 pricing-auto-refresh）

目标与 `docs/sdlc/pricing-auto-refresh/plan.md` 一致：`data/model-info.json` 不靠人工盯官方页手改，而是**脚本自动抓取官方模型页 → 更新 JSON → 自动开 PR 人工审核合入**。

> **现状说明**：pricing 的仓库侧保鲜目前**只有计划文档、尚未实现**（`scripts/pricing-refresh/` 在 main 及所有分支均不存在，`package.json` 无 `pricing:refresh` 脚本，`.github/workflows/` 无对应工作流）。因此本功能第二层与 pricing 第二层是**同一套设计、可共用基建**：若 pricing-refresh 先落地，model-info-refresh 直接复用其 `lib.mjs`（fetch/diff/bump/commit-PR）与 CI 模式；若本功能先落地，pricing 侧后续照抄。

**架构**（镜像 pricing-auto-refresh）：

```
scripts/model-info-refresh/
  refresh-model-info.mjs     # CLI：fetch → parse → diff → write → regenerate（--only/--dry-run/--commit）
  lib.mjs                    # 复用 pricing-refresh 同款：fetch（超时/UA）、diff、写 JSON、bump updatedAt、报告
  parsers/
    openai.mjs               # 模型列表页（context window / 能力）
    anthropic.mjs            # 模型总览页（context / max output / 工具调用）
    google.mjs               # 模型页（context window / max output 表）
    deepseek.mjs             # API 文档模型列表（context length）
    kimi.mjs / glm.mjs / mimo.mjs   # 各自模型列表页
```

- **数据源**：各厂商**模型列表/模型总览页**（与 pricing 抓定价页不同，具体 URL 与页面形态开工前逐一探测确认，方法同 pricing-auto-refresh 的探测表）。
- **抓取字段**：`contextWindow`、`maxOutputTokens`、`capabilities`（toolCalling/vision/thinking）；`displayName`/`supportsReasoningEffort` 官方页通常无结构化来源，**保持人工字段**（脚本不覆盖）。
- **合并语义**：只增改、不删除；官方页已下架的模型保留条目并写报告警告（与 pricing 一致）。
- **熔断**：单厂商解析 0 个模型或模型数骤降 >50% → 该厂商整体放弃并报错，不写半份数据。
- **测试**：parser 对存档 HTML fixture 跑单测（`test/fixtures/model-info/`），不触网。
- **CI**：`.github/workflows/model-info-refresh.yml`，cron 每日 + `workflow_dispatch`；有变化 → 分支 `model-info-refresh-YYYYMMDD` 提交并开 PR（不自动合并），PR body 附 diff 摘要与警告。
- **风险差异（vs pricing）**：模型规格比价格更稳定（上下文/能力很少变），变化频率低；但规格散落在模型页而非统一定价表，部分厂商（如 mimo）可能无结构化来源 → 该厂商降级为人工维护并在报告中声明，不阻塞其他厂商。

## 改动文件（按实现顺序）

### 阶段一：运行时自动同步 + 种子数据 + GUI 自动填充

**新增**
1. `data/model-info.json` — 种子数据
2. `src/model-info.ts` — 类型 `ModelInfo`/`RemoteModelInfoData`、内置兜底加载、可变 `MODEL_INFO` 记录、`getModelInfo(modelId)`、`applyModelInfo(data)`（镜像 `usage.ts` 的 `PRICING_CATALOGS` 模式）
3. `src/model-info-data.ts` — 生成产物（内置兜底 `BUILTIN_MODEL_INFO`）
4. `src/model-info-updater.ts` — zod schema + `parseModelInfo` + 缓存读写 + 远程 fetch + `refreshModelInfo`/`startModelInfoRefresh`（镜像 `pricing-updater.ts`）
5. `scripts/generate-model-info-data.mjs` — 从 `data/model-info.json` 生成 `src/model-info-data.ts`（含 `--check`）
6. `test/model-info.test.ts` — `getModelInfo`/`applyModelInfo` 单测
7. `test/model-info-updater.test.ts` — schema/缓存/刷新单测（镜像 `pricing-updater.test.ts`）

**修改**
8. `package.json` — 新增 `modelinfo:generate` 脚本；`check` 追加 `node scripts/generate-model-info-data.mjs --check`；`test` 追加两个新测试
9. `src/server.ts` — 启动 `startModelInfoRefresh`（与 `startPricingRefresh` 同处）
10. `gui/electron/main.ts` — 注册 IPC `model-info:loadCache`
11. `gui/electron/preload.cjs` — 暴露 `loadModelInfoCache`
12. `gui/electron/ipc-contracts.ts` — 契约 `model-info:loadCache`
13. `gui/src/desktop-api.ts` — 接口 `loadModelInfoCache()`
14. `gui/src/mock-desktop-api.ts` — mock 返回
15. `gui/src/app-controllers.ts` — 新增 `useModelInfoCache` hook（镜像 `usePricingCache`，轮询 + `applyModelInfo`）
16. `gui/src/pages/vendor-editor-page.tsx` — 模型 `Select` 的 `onValueChange` 里调用 `getModelInfo(modelId)`，按 only-empty 合并进 `vscode` 草稿
17. `gui/src/App.tsx` — 挂载 `useModelInfoCache`

### 阶段二：仓库侧自动保鲜（镜像 pricing-auto-refresh，可与阶段一解耦、后续提交）

**新增**
18. `scripts/model-info-refresh/lib.mjs` — fetch（超时/UA）/diff/写 JSON/bump updatedAt/报告；若 pricing-refresh 已落地则直接复用其 `lib.mjs`
19. `scripts/model-info-refresh/refresh-model-info.mjs` — CLI 骨架（`--only`/`--dry-run`/`--commit`/`--from-file` fixture 模式）
20. `scripts/model-info-refresh/parsers/*.mjs` — openai/anthropic/google/deepseek/kimi/glm/mimo（逐个实现，每完成一个用真实页面 dry-run 验证）
21. `test/fixtures/model-info/*` — 各厂商模型页当前存档（测试不触网）
22. `test/model-info-refresh.test.ts` — parser 单测 + 合并语义/熔断/updatedAt bump 测试
23. `.github/workflows/model-info-refresh.yml` — 每日 cron + `workflow_dispatch`，有变化自动开 PR（不自动合并）

**修改**
24. `package.json` — 加 `modelinfo:refresh` 脚本

## 自动填充逻辑（核心）

在 `vendor-editor-page.tsx` 模型下拉的 `onValueChange` 中，设置 `id` 与 `pricingMode` 之后：

```ts
const info = getModelInfo(modelId);
if (info) {
  const next = { ...(model.vscode || {}) };
  let changed = false;
  const setIfEmpty = (key, val) => {
    if (val !== undefined && (next[key] === undefined || next[key] === "")) { next[key] = val; changed = true; }
  };
  setIfEmpty("name", info.displayName);
  setIfEmpty("contextWindow", info.contextWindow != null ? String(info.contextWindow) : undefined);
  setIfEmpty("maxOutputTokens", info.maxOutputTokens != null ? String(info.maxOutputTokens) : undefined);
  setIfEmpty("toolCalling", info.capabilities?.toolCalling);
  setIfEmpty("vision", info.capabilities?.vision);
  setIfEmpty("thinking", info.capabilities?.thinking);
  if (info.supportsReasoningEffort?.length && !next.supportsReasoningEffort?.length) { next.supportsReasoningEffort = info.supportsReasoningEffort; changed = true; }
  if (changed) onUpdateVendorModel(index, "vscode", Object.keys(next).length ? next : undefined);
}
```

- 基于**变更前**的 `model.vscode` 合并，保留用户已填值。
- 能力布尔值仅在草稿中为 `undefined` 时填（`false` 也算已填，不覆盖）。

## 影响面

- 以**新增文件**为主；对现有文件均为小范围追加，**不改动价格逻辑**。
- 只填空字段，不影响任何已有配置；无元数据条目时行为与现状完全一致（优雅降级）。
- 新增一条 IPC 通道与一个本地缓存文件 `model-info-cache.json`，与 pricing 完全对称。
- 阶段二为纯仓库侧工具（新脚本/新测试/新工作流），不影响运行时；工作流失败不影响现有 CI/发布。

## 验证

**阶段一**
- `npm run check`（tsc + preload 语法 + pricing/model-info 生成同步检查）
- `npm test`（含新增 `model-info`、`model-info-updater` 单测）
- 手动：`npm run gui`，选一个有元数据条目的模型，确认显示名/上下文/最大输出/能力被自动填入空字段；再改模型确认不覆盖已填值。

**阶段二**
- `test/model-info-refresh.test.ts`：parser 对 fixture 解析出正确规格；合并语义（增/改/保留下架模型/警告）；模型数骤降熔断；`updatedAt` bump 规则。
- `npm run modelinfo:refresh -- --dry-run`（真实网络）：预期各厂商"无变化"或仅新增新模型。
- `workflow_dispatch` 手动触发一次，验证"无变化静默退出"与"有变化开 PR"两条路径。
