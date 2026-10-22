# 模型名复制 — 计划

## 问题

供应商编辑页中，模型名（model id）展示在只读的 Select 下拉框里，文字不可选中，
用户无法通过「全选 + 复制」拿到模型名。

现状（`gui/src/pages/vendor-editor-page.tsx`）：

- 每个模型行头部是 `grid-cols-[32px_minmax(120px,1fr)_auto_30px]` 网格：
  Switch | Select(model id) | [Thinking pill + 删除按钮] | Chevron
- Select trigger 是 Radix 只读控件，文本不可选中
- 项目已有成熟复制模式（`sidebar.tsx` 的 StatusDetailPopover）：
  `getDesktopApi().writeClipboard()` 失败时回退 `navigator.clipboard.writeText`，
  本地 copied 状态 + 1.5s 图标反馈（Copy → Check）

## 方案选型

- **方案 A（推荐）：模型行操作区加复制图标按钮**
  - 在行内既有操作按钮（Thinking pill、删除按钮）旁加一个 `Copy` 图标按钮
  - 点击复制 `model.id`；成功后图标变 `Check`（绿色）1.5 秒，与 sidebar 现有反馈一致
  - `model.id` 为空时禁用
  - 优点：可发现性好、与行内既有按钮风格一致、完全在 `ModelPricingRow` 内实现，无需 prop 透传
- 方案 B：`VendorEditorPage` 新增 `onCopyModelId` prop，由 App.tsx 透传并用 `notify` toast 反馈
  - 优点：通知风格统一；缺点：多两层 prop 透传、高频小操作用 toast 偏吵、改动面更大
- 方案 C：右键 / 双击 Select 复制
  - 无 UI 改动，但可发现性差、易与既有交互冲突，不采用

## 改动

仅一个文件：`gui/src/pages/vendor-editor-page.tsx`

1. 导入：lucide-react 增加 `Copy`、`Check`；从 `../desktop-api.ts` 导入 `getDesktopApi`
2. `ModelPricingRow`：
   - 新增 `const [copied, setCopied] = React.useState(false)`
   - 操作区（删除按钮前）加复制按钮：
     - `Button variant="ghost" size="icon-sm"`，`disabled={!model.id}`
     - `title` / `aria-label` 为 "Copy model id"
     - 点击：先 `getDesktopApi().writeClipboard(model.id)`，失败回退
       `navigator.clipboard.writeText`（与 sidebar 模式一致）；
       成功后 `setCopied(true)`，1500ms 后复位
     - 图标：`copied ? <Check size={15} className="text-success" /> : <Copy size={15} />`
   - 按钮位于已有 `stopPropagation` 的操作容器内，不会触发行展开/收起
3. 不改 Select 组件、不新增依赖（lucide 的 Copy/Check 项目已在用）

## 影响面

- 仅供应商编辑页模型行 UI；不影响后端 / 配置 / IPC
- 剪贴板写入走既有 `writeClipboard` IPC，无新增通道

## 验证

1. `npm run check`（tsc --noEmit）
2. `npm test`（回归，预期无影响）
3. 手动：`npm run gui` → 选中 vendor → 模型行：
   - 点复制按钮 → 剪贴板内容为对应 model id
   - 图标变 Check 1.5 秒后恢复
   - 点击不触发行展开/收起
   - 未选 model 的行按钮禁用
