# 一键添加 Vendor 所有模型 — Intent

## 当前问题

在 Vendor 编辑页添加模型目前是逐行操作：点「添加模型」→ 空行 → 下拉选择模型 ID。
当某个 vendor（如 OpenAI、DeepSeek、Anthropic）的模型列表较长（几十到上百个）时，
用户需要反复执行「添加 → 选择」才能把想要的模型都加进来，操作繁琐、效率低。

虽然页面已能拉取 vendor 的 `/v1/models` 列表（`availableVendorModels`），
但只用于下拉选项，没有「批量加入」的入口。

## 期望结果

在 Vendor 编辑页提供一个「一键添加所有模型」入口：
- 数据源为 vendor `/v1/models` 接口返回的全部模型 ID（即已拉取的 `availableVendorModels`）
- 排除当前 vendor 模型列表中已存在的 ID（按 ID 去重，不产生重复行）
- 批量加入的模型行：
  - `enabled: true`（与现有单个添加行为一致）
  - `pricing`：按模型 ID 自动推断计费目录（openai / deepseek / anthropic / google / kimi / glm / mimo 等），推断不到则留空（与现有单个添加行为一致）
  - `vscode` 元数据：若模型 ID 在 `model-info.json` 中有记录，自动填充（与现有单个添加/切换模型行为一致）
- 点击后弹出选择弹窗：列出待添加的模型清单，默认全选，用户可手动取消勾选部分模型，最终只添加勾选的模型
- 添加完成后用户可继续逐个调整（启用/禁用、计费、VS Code 元数据）

## 受影响系统

- **GUI 前端**：`gui/src/pages/vendor-editor-page.tsx`（新增按钮 + 确认交互）
- **GUI 状态/逻辑**：`gui/src/App.tsx`（批量添加 handler）、`gui/src/app-model.ts`（批量添加纯函数，复用 `suggestCatalogSwitch`、`getModelInfo`）
- **数据**：仅影响当前编辑中的 vendor draft，保存前不写盘；保存后进入 `config.json` 的 `vendors[].models[]`
- **下游**：VS Code 同步（`chatLanguageModels.json`）会随保存后的配置同步新增模型；usage 统计按新增模型 ID 归集

## 数据 / 技术约束

- 模型 ID 来源为 vendor `/v1/models` 拉取结果（`availableVendorModels`）；点击时若列表尚未拉取（为空），先自动触发拉取，拉取失败则 toast 提示且不打开选择弹窗
- 去重以模型 ID 精确匹配（trim 后比较）
- 计费目录推断复用现有 `suggestCatalogSwitch` 逻辑，不新增推断规则
- VS Code 元数据填充复用现有 `getModelInfo` + `applyModelSwitch` 的填充逻辑，不新增元数据来源
- 不改动 `/v1/models` 拉取链路（`listVendorModels` IPC）
- 批量添加只操作内存中的 draft，不自动保存

## 明确不做的事

- 弹窗内只做勾选/取消勾选，不做搜索、分类、批量操作等复杂筛选能力
- 不做批量删除、批量启用/禁用
- 不做模型 ID 的模糊匹配或别名归一化
- 不改动 vendor 列表页（router-page）的行为
- 不改动 `/v1/models` 拉取、计费目录数据、model-info 数据本身的生成逻辑
- 不自动保存配置（添加后仍需用户点保存）

## 已确认决策

1. 按钮位置：模型列表区块的「添加模型」按钮旁
2. 模型列表尚未拉取时点击：先自动触发拉取，拉取失败则 toast 提示
3. 确认交互：弹窗列出待添加模型清单，默认全选，用户可手动取消勾选，最终只添加勾选的模型
4. 计费目录推断失败（`suggestCatalogSwitch` 返回 null）时：该行 pricing 留空，与现有单个添加行为一致
