# 一键添加 Vendor 所有模型 — Plan

> 依据已确认的 [spec.md](./spec.md)。计划批准前不修改任何代码。

## 实现顺序

### Step 1 — 依赖与 Checkbox 组件

**`package.json`**：新增依赖 `@radix-ui/react-checkbox`（与其他 `@radix-ui/react-*` 并列，版本取 `^1.x` 最新）。运行 `npm install`。

**`gui/src/components/ui/checkbox.tsx`**（新增）：shadcn 风格 Checkbox，与现有 `switch.tsx`/`select.tsx` 同风格（`data-slot` 属性、`cn()` 合并 className、lucide `Check` 图标）。导出 `Checkbox`。

### Step 2 — 纯函数 `buildBulkVendorModels`（`gui/src/app-model.ts`）

- 新增 value import：`import { getModelInfo } from "../../src/model-info.ts";`（当前仅有 type import，合并为一条）。
- 新增导出函数：

```ts
export function buildBulkVendorModels(modelIds: string[]): VendorModelDraft[] {
  return modelIds
    .map((raw) => String(raw || "").trim())
    .filter(Boolean)
    .filter((id, index, list) => list.indexOf(id) === index) // 自去重
    .map((id) => {
      const row: VendorModelDraft = { id, enabled: true };
      const switchTo = suggestCatalogSwitch(row.pricingMode, id);
      if (switchTo) row.pricingMode = switchTo;
      const next = applyModelSwitch(row, id, getModelInfo(id));
      if (next.pricingMode) row.pricingMode = next.pricingMode;
      if (next.pricingCurrency !== undefined) row.pricingCurrency = next.pricingCurrency;
      if (next.vscodeModelCache) row.vscodeModelCache = next.vscodeModelCache;
      row.vscode = next.vscode;
      row.inputPerMillion = next.inputPerMillion ?? "";
      row.cachedInputPerMillion = next.cachedInputPerMillion ?? "";
      row.outputPerMillion = next.outputPerMillion ?? "";
      return row;
    });
}
```

- 字段写入集合与 `ModelPricingRow` 的 `onValueChange`（vendor-editor-page.tsx 约 429-455 行）逐项一致：`id` → `pricingMode`（suggest + switch 覆盖）→ `pricingCurrency`/`vscodeModelCache`/`vscode`/三个价格字段。**实现时逐行核对，保证单个选择与批量添加产出相同行。**
- 注意：新行 `row.id` 先置为 `id` 再调 `applyModelSwitch`，oldId === newId，不会触发旧快照逻辑（与空行选择后 id 相同的语义一致）。

### Step 3 — App.tsx 状态与 handler（`gui/src/App.tsx`）

1. `ModalState` 联合类型新增：`| { type: "addVendorModels"; models: string[] }`。
2. `loadVendorModels` 返回值改为 `Promise<string[] | null>`：
   - 各提前 return 分支（无 vendor / 不可拉取 / 未变化 / IPC 缺失）返回 `null`（提示逻辑不变）；
   - 成功分支 `return result.models || []`；竞态过期 return 返回 `null`；
   - catch 分支返回 `null`（错误提示逻辑不变）。
3. 新增 `openAddVendorModelsDialog()`：
   - 无 `vendorEditorDraft` → return；
   - `availableVendorModels.length > 0` → 用现有 state；否则 `await loadVendorModels(vendorEditorDraft, { force: true })` 并消费返回值；
   - 返回 `null` 或空数组 → return（错误已由 loadVendorModels toast）；
   - 候选 = 列表 trim 去重后排除 `getVendorModels(draft)` 已有 ID（trim 匹配）；
   - 候选为空 → `notify("All available models are already added.")`；
   - 否则 `setModal({ type: "addVendorModels", models: 候选 })`。
4. 新增 `confirmAddVendorModels(selectedIds: string[])`：
   - `setVendorEditorDraft` 追加 `buildBulkVendorModels(selectedIds)` 到 `models` 末尾；
   - `setModal(null)`；`notify(\`Added ${n} models.\`)`。
5. 底部 Dialog 区（deleteVendorModel 弹窗附近）渲染：

```tsx
<AddVendorModelsDialog
  open={modal?.type === "addVendorModels"}
  models={modal?.type === "addVendorModels" ? modal.models : []}
  onConfirm={(ids) => confirmAddVendorModels(ids)}
  onCancel={() => setModal(null)}
/>
```

### Step 4 — 弹窗组件（`gui/src/pages/vendor-editor-page.tsx`）

新增导出组件 `AddVendorModelsDialog`（props：`open`、`models: string[]`、`onConfirm(ids: string[])`、`onCancel`）：

- 内部 `const [checked, setChecked] = useState<Set<string>>(() => new Set(models));`——组件始终挂载（`open` 控制 Dialog），需在 `open` 变 true 时重置为全选：用 `useEffect(() => { if (open) setChecked(new Set(models)); }, [open, models]);`
- 布局：`DialogContent`（`sm:max-w-lg` 默认即可）+ `DialogHeader`（标题「Add models」+ 描述「N models available from this vendor」）；
- 列表区：`max-h-80 overflow-y-auto`，表头一行「全选」Checkbox（checked = 全部勾选，indeterminate = 部分勾选，可用 `ref` 设 `indeterminate` 属性），其下每行 Checkbox + mono 字体模型 ID；
- 底部 `DialogFooter`：左侧 `text-xs`「已选 X / 共 N」，右侧 Cancel（outline）+ Add（默认，`checked.size === 0` 时 disabled）；
- Add 点击 → `onConfirm([...checked])`（按候选列表原顺序输出，保持列表顺序稳定）。

### Step 5 — 按钮入口（`gui/src/pages/vendor-editor-page.tsx`）

- props 新增 `onAddAllVendorModels: () => void`；
- Models 区块「Add model」按钮旁新增：

```tsx
<Button variant="outline" size="sm" onClick={onAddAllVendorModels} disabled={busy === "vendorModels"}>
  {busy === "vendorModels" ? <Loader2 className="animate-spin" size={14} /> : <Layers size={14} />}
  Add all models
</Button>
```

（`Layers` 图标已在该文件 import；`busy === "vendorModels"` 期间禁用，防止拉取中重复触发。）

- `App.tsx` 中 `<VendorEditorPage ... onAddAllVendorModels={() => void openAddVendorModelsDialog()} />` 传入。

### Step 6 — 单测（`test/app-model.test.ts`）

按文件现有风格（top-level `assert`，无 describe）为 `buildBulkVendorModels` 补断言：
- 输入含重复 ID / 空白 ID → 输出自去重、无空行；
- 模型 ID 命中 pricing 目录（如 `gpt-4o`）→ 行 `pricingMode` 为推断出的目录 key；
- 模型 ID 未命中任何目录 → 行无 `pricingMode`（留空）；
- 模型 ID 命中 `model-info`（如 `gpt-4o`）→ 行 `vscode` 含 contextWindow 等字段；未命中 → `vscode` 为 undefined；
- 所有行 `enabled: true`、三个价格字段为 `""`。

## 可能破坏的已有功能

| 风险点 | 说明 | 缓解 |
|--------|------|------|
| `loadVendorModels` 签名变更 | 现有 3 个调用方（`refreshVendorModels`、`loadVendorModelsOnSelect`、baseUrl 变化 effect）均不消费返回值，改为返回 `string[] \| null` 对它们是兼容的 | 全量 grep 调用方确认无遗漏；`npm run check` 类型检查兜底 |
| `app-model.ts` 新增 `getModelInfo` value import | 该文件被 `test/app-model.test.ts` 直接 import，会连带加载 `model-info-data.ts`（生成的 TS 常量文件） | 测试环境本就是 node 直跑 TS，`model-info.test.ts` 已验证该链路可跑 |
| 弹窗 `open` 时重置 checked 的 `useEffect` 依赖 `models` | 若 `models` 引用变化会重置勾选——但 modal 打开期间 `models` 来自 modal state 不变，安全 | 依赖数组用 `[open, models]`，modal 关闭时 open=false 不重置 |
| 批量行与单个行字段不一致 | 用户同一模型两种添加方式得到不同行 | Step 2 逐行核对 `onValueStep` 字段集合 + 单测覆盖 |
| 长列表（100+）弹窗性能 | 一次性渲染 100+ Checkbox | 纯 DOM 无 IO，可接受；若实测卡顿再改虚拟滚动（预期不需要） |

## 最容易出问题的步骤

**Step 3 的 `loadVendorModels` 返回值改造 + 自动拉取时序**：这是唯一改动现有链路的步骤。竞态防护（requestId/sourceKey）逻辑必须原样保留，只是各出口补返回值；且 `openAddVendorModelsDialog` 必须消费返回值而非读 state（闭包过期问题）。若此处出错，表现是「点击后弹窗里模型列表是旧的/空的」或「切换 baseUrl 后拉取串台」。

**备选方案**：若不想动 `loadVendorModels` 签名，可在 handler 内直接调 `getDesktopApi().listVendorModels(vendor)` 拿列表、跳过 state 更新——但会绕过 requestId 竞态防护并造成 state 与弹窗数据不同步（下拉选项不刷新），不推荐。

## 验证命令

```powershell
npm install                      # Step 1 后
npm run check                    # tsc --noEmit 全量类型检查（每步后跑）
npm test                         # 全量测试（含新增 buildBulkVendorModels 断言）
```

手动验证（`npm run dev` 起 Electron 开发环境）：
1. 选一个有 `/v1/models` 的 vendor（如 OpenAI），不点 Refresh 直接点「Add all models」→ 应自动拉取后弹窗，列表默认全选；
2. 取消勾选部分模型 → 底部计数变化；全部取消 → Add 禁用；
3. 点 Add → 模型行批量出现在列表末尾，pricingMode 已推断、vscode 元数据已填充（展开行核对）；
4. 再次点「Add all models」→ toast「均已添加」，不弹窗；
5. 单个添加同一模型 vs 批量添加 → 行字段一致；
6. 保存 → config.json 正确；VS Code 同步（若开启）包含新模型。
