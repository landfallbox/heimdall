# 一键添加 Vendor 所有模型 — Spec

> 依据已确认的 [intent.md](./intent.md)。

## 功能如何工作

### 交互流程

1. Vendor 编辑页 Models 区块，「Add model」按钮旁新增「Add all models」按钮。
2. 点击后：
   - 若 `availableVendorModels` 非空 → 直接进入第 4 步；
   - 若为空（尚未拉取）→ 先自动触发拉取（`loadVendorModels`，force）：
     - 拉取成功 → 继续第 4 步；
     - 拉取失败 → toast 报错（复用现有错误提示链路），不打开弹窗。
3. 计算候选模型：拉取结果中排除当前 vendor 已配置的模型 ID（trim 后精确匹配），并自去重。
   - 候选为空 → toast「所有可用模型均已添加」，不打开弹窗。
4. 打开选择弹窗（Dialog）：
   - 标题区显示候选数量；
   - 列表展示全部候选模型 ID，每行一个 checkbox，**默认全选**；
   - 表头提供「全选/取消全选」勾选框；
   - 列表可滚动（上限约 100+ 行，`max-h` + `overflow-y-auto`）；
   - 底部显示「已选 N / 共 M」，Cancel / Add 按钮；
   - 全部取消勾选时 Add 按钮禁用。
5. 点击 Add：把勾选的模型 ID 批量追加到当前 vendor draft 的 `models[]` 末尾，关闭弹窗，toast「已添加 N 个模型」。
6. 配置不自动保存，用户继续逐个调整后点保存。

### 每个新增模型行的字段

与现有「单个添加后选择模型」的落行逻辑保持一致（复用同一套纯函数）：

| 字段 | 取值 |
|------|------|
| `id` | 模型 ID |
| `enabled` | `true` |
| `pricingMode` | `suggestCatalogSwitch(undefined, modelId)` 的推断结果；推断不到（返回 null）则**留空** |
| `vscode` | `applyModelSwitch` 无快照分支：`getModelInfo(modelId)` 命中则填充 name/contextWindow/maxOutputTokens/toolCalling/vision/thinking/supportsReasoningEffort；未命中则 `undefined` |
| `inputPerMillion` / `cachedInputPerMillion` / `outputPerMillion` | `""`（与 `applyModelSwitch` 新模型分支一致） |
| `vscodeModelCache` | 不写（新行无旧快照） |

## 数据如何流动

```
点击「Add all models」
  → App.tsx: openAddVendorModelsDialog()
      → (列表为空时) loadVendorModels(draft, { force: true })
          → desktop-api: listVendorModels(vendor)   [IPC，不改动]
          → 返回模型 ID 列表（改造：loadVendorModels 返回 string[] | null）
      → 计算候选（去重、排除已配置）
      → setModal({ type: "addVendorModels", models: 候选列表 })
  → AddVendorModelsDialog 渲染（checkbox 勾选状态为组件本地 state，默认全选）
  → 点击 Add
      → App.tsx: confirmAddVendorModels(selectedIds)
          → app-model.ts: buildBulkVendorModels(selectedIds)  [新增纯函数]
              → 每行：suggestCatalogSwitch + applyModelSwitch + getModelInfo
          → setVendorEditorDraft: models 追加新行
          → setModal(null) + toast
  → 用户点保存 → 现有 saveVendorEditor 链路（不改动）
      → config.json vendors[].models[]
      → VS Code 同步 / usage 统计（现有下游，不改动）
```

关键点：
- **拉取结果回传**：现有 `loadVendorModels` 是 `Promise<void>`，点击 handler 在 await 后闭包里的 `availableVendorModels` 仍是旧值（React state 异步更新）。改造为返回 `string[] | null`（成功返回模型列表；不可拉取/失败返回 null，错误提示逻辑不变），handler 直接消费返回值，避免闭包过期问题。
- **纯函数落行**：`buildBulkVendorModels` 放在 `app-model.ts`，逐行复用 `suggestCatalogSwitch`、`applyModelSwitch`、`getModelInfo`，不新增推断/填充规则；`app-model.ts` 需新增 `getModelInfo` 的 value import（当前只有 type import）。
- **弹窗状态**：勾选状态是弹窗组件本地 state（`Set<string>`，初始为全部候选）；候选列表由 App.tsx 的 modal state 传入。弹窗组件随 modal 挂载/卸载，无需手动重置。

## 影响哪些系统

| 文件 | 改动 |
|------|------|
| `package.json` | 新增依赖 `@radix-ui/react-checkbox`（现有 UI 均为 shadcn 风格 + radix 原语，无 checkbox 组件） |
| `gui/src/components/ui/checkbox.tsx` | 新增 shadcn 风格 Checkbox 组件（与 dialog/switch/select 同风格） |
| `gui/src/app-model.ts` | 新增纯函数 `buildBulkVendorModels(modelIds: string[]): VendorModelDraft[]`；新增 `getModelInfo` value import |
| `gui/src/App.tsx` | `loadVendorModels` 返回 `string[] \| null`；`ModalState` 增加 `{ type: "addVendorModels"; models: string[] }`；新增 `openAddVendorModelsDialog()`、`confirmAddVendorModels(ids)` 两个 handler；底部渲染 `<AddVendorModelsDialog>` |
| `gui/src/pages/vendor-editor-page.tsx` | 新增 prop `onAddAllVendorModels: () => void`；「Add model」旁新增「Add all models」按钮（`busy === "vendorModels"` 时禁用并显示 spinner）；新增 `AddVendorModelsDialog` 组件（或独立文件） |
| `test/app-model.test.ts` | 为 `buildBulkVendorModels` 补充单测（仓库对 app-model 纯函数有完整测试惯例） |

不改动：`listVendorModels` IPC 链路、`desktop-api.ts`/`mock-desktop-api.ts`、`config-draft.ts`、保存链路、VS Code 同步、usage 统计、计费目录数据、model-info 数据。

## 安全 / 合规 / 性能疑点

- **安全**：无新增外部输入面。模型 ID 来自 vendor 自身 `/v1/models` 响应，现状已用于下拉选项，批量添加不引入新的注入面；ID 只写入本地 config.json。无凭据新增暴露（apiKey 仅用于既有拉取链路）。
- **数据完整性**：去重按 trim 后精确匹配；候选列表自身用 Set 去重，防止 vendor 返回重复 ID 产生重复行。保存时 `validateVendor` 现有校验（如重复模型 ID 报错）仍生效，是最后一道防线。
- **性能**：候选最多上百个，弹窗一次性渲染 checkbox 列表（纯 DOM，无网络），React 可承受；每行 `buildBulkVendorModels` 只做内存查表（pricing 目录 + model-info 均为内存对象），无 IO。`loadVendorModels` 已有 requestId 防竞态，自动拉取路径复用同一机制。
- **可用性**：拉取失败时不打开弹窗且 toast 说明原因；候选为空时 toast 说明原因；全选/取消全选降低长列表操作成本。
- **一致性风险**：批量落行逻辑若与单个选择的落行逻辑（`ModelPricingRow` 的 `onValueChange`）实现方式不一致，会出现「单个添加和批量添加同一模型，行字段不同」。spec 要求 `buildBulkVendorModels` 内部复用 `suggestCatalogSwitch` + `applyModelSwitch`，与单个选择路径同源；plan 阶段需核对单个选择路径的字段写入集合，确保一致。
