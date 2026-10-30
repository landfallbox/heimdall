# 供应商编辑页「价格提示 + VS Code 标签」改造 — 计划

> 轻量偏中：同一页的两处 UI 改动；其中价格提示的「issue/PR」按用户选择做成**可点链接**，
> 需新增一条 `shell.openExternal` IPC（跨 6 个文件）。按 SDLC 档位合并为单一 plan.md（跳过 intent.md / spec.md）。
> 用户已确认：
> - **改动 1**：价格提示不再按目录动态拼，改为**每个有 model id 的模型行都显示一句固定英文提示**
>   （信息已按模型 id 自动匹配，不合适可用 Custom，可提 issue/PR）。语言=en，时机=always。
>   **issue/PR 做成可点链接（方案 B）**，新开 `shell.openExternal` IPC。
> - **改动 2**：模型卡片里 "VS Code" 小节标题改为 **`Model info`**（方案 C），并加一行说明小字，
>   含「不用 VS Code sync 可留空/保持默认，无需核对数据正确性」。

## 问题

### 问题 1：价格提示过时且自相矛盾

供应商编辑页模型卡片底部有一行**动态**提示，按 Price source 与目录命中情况拼出三种文案：

- 当前目录无价 & 其他目录有价：`Not in {catalogLabel} — switch to {otherCatalogLabel}`（带按钮）
- 当前目录无价 & 无其他目录：`Not in {catalogLabel} — use Custom`
- Custom + 非法价格：`Enter valid non-negative prices…`（红色错误）

这行提示诞生于「自动填充价格」能力**之前**，现在已过时，且用户实际踩到的问题：

1. **自相矛盾**：Price source 已选 **Custom** 时仍显示 "…use Custom"（截图：Qwen / Qwen3.8-27B）。
2. **事实错误**：`catalogKey` 在 `pricingMode === "custom"` 时回退为 `"openai"`
   （[vendor-editor-page.tsx:314](/d:/code/projects/heimdall.worktrees/custom-sdlc-plan-issue-fix/gui/src/pages/vendor-editor-page.tsx)），
   提示对着用户根本没选的 "OpenAI" 目录计算，"Not in OpenAI" 是错的。
3. **语义过时**：现在选模型 id 时软件会自动匹配价格目录并自动填充模型信息
   （`suggestCatalogSwitch` + `applyModelSwitch`，见 `docs/sdlc/model-info-auto-fill/plan.md`），
   "use Custom" 的引导已不再是主路径，固定说明「已自动匹配 + 可 Custom 覆盖 + 可提 issue/PR」更准确。

### 问题 2："VS Code" 小节标题误导

模型卡片里有一块标题为 **`VS Code`** 的小节（[vendor-editor-page.tsx:970](/d:/code/projects/heimdall.worktrees/custom-sdlc-plan-issue-fix/gui/src/pages/vendor-editor-page.tsx)），
含 Display name / Context window / Max output tokens / Capabilities / Reasoning effort：

- 数据存在 `model.vscode`（[config-draft.ts:14](/d:/code/projects/heimdall.worktrees/custom-sdlc-plan-issue-fix/gui/src/config-draft.ts)），
  **唯一消费方**是 `vscode-sync.ts`（点 "Sync models to VS Code" 时写进 VS Code 的 `chatLanguageModels.json`）。
- 选模型 id 时这些字段从 `model-info.json` **自动填充**（与价格自动匹配同源）。

标题只写 "VS Code" 不好：① 无说明，用户不知这是"要同步给 VS Code 的模型信息"；
② 字段本质是**模型元数据**，用 "VS Code" 当标题把"模型事实"和"同步目标"混在一起；
③ 不用 VS Code 同步的人会困惑为何每张卡片都有这块；④ 与"自动匹配"叙事脱节。

## 方案

### 改动 1：固定价格提示 + 可点仓库链接（方案 B）

把动态提示块整体替换为**一句固定英文提示**，只要该行有 model id 就显示（与 Price source、
是否在目录内无关）。保留 Custom 非法价格的红色错误分支（真正的输入校验，优先级最高）。
其中 `landfallbox/heimdall` 做成**可点链接**，点击用系统浏览器打开仓库页。

固定文案（英文）：

> Prices & details are auto-matched by model ID. If prices don't fit, switch Price source to **Custom** to override. To improve the built-in data (prices, model info, or other config), submit an issue or PR to **landfallbox/heimdall**.（`landfallbox/heimdall` 为可点链接）

链接目标：仓库根 `https://github.com/landfallbox/heimdall`（对 "issue or PR" 最中性的落点，用户可再进 issues/PR）。

结构（替换 L670–691 的三元表达式；`getDesktopApi` 已在 [vendor-editor-page.tsx:43](/d:/code/projects/heimdall.worktrees/custom-sdlc-plan-issue-fix/gui/src/pages/vendor-editor-page.tsx) 导入）：

```tsx
{customPricing && !isValidCustomPricing(model) ? (
  <small className="text-[11px] leading-snug text-destructive">
    Enter valid non-negative prices for {model.id || "this model"}.
  </small>
) : model.id ? (
  <small className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
    <Info size={12} className="mt-0.5 shrink-0" />
    <span>
      Prices & details are auto-matched by model ID. If prices don't fit, switch Price source to Custom to override.
      To improve the built-in data (prices, model info, or other config), submit an issue or PR to{" "}
      <button
        type="button"
        className="bg-none p-0 font-bold text-primary underline-offset-2 hover:underline"
        onClick={() => void getDesktopApi().openRepo()}
      >
        landfallbox/heimdall
      </button>
      .
    </span>
  </small>
) : null}
```

> 样式沿用本文件既有的「链接式按钮」写法（原 "switch to …" 同款 className），不引入 `<a target=_blank>`
> （Electron 下行为不可控）。`text-warning` → `text-muted-foreground`（现在是中性提示，不再是告警）。

#### 新增 IPC：`repo:openRepo`（方案 B 的机制）

完全仿照既有 `update:openReleasePage`（[updater.ts:815](/d:/code/projects/heimdall.worktrees/custom-sdlc-plan-issue-fix/gui/electron/updater.ts)）：
**专用、无参**，URL 由主进程硬编码（不接收渲染层传入的 URL，最安全）。

- 通道名：`repo:openRepo`；请求 `emptyRequest`；响应 `okResponse`（`{ ok: boolean }`）。
- 主进程 handler：`shell.openExternal(REPO_URL)`，`try/catch` 后返回 `{ ok: true }` / `{ ok: false }`
  （无默认浏览器时不抛错到渲染层）。`shell` 已在 [main.ts:1](/d:/code/projects/heimdall.worktrees/custom-sdlc-plan-issue-fix/gui/electron/main.ts) 导入，无需改 import。
- `REPO_URL`：在 `updater.ts` 由既有 `GITHUB_REPO` 派生并 `export`（单一来源），`main.ts` 导入复用。

### 改动 2：小节标题 `VS Code` → `Model info` + 说明小字（方案 C）

只改**显示**，不动数据字段 `model.vscode`（`vscode-sync.ts` / `config-draft.ts` 等一律不变）。

- 标题（L970）：`VS Code` → `Model info`。
- 在标题分隔线下方加一行说明小字：

  > Auto-matched by model ID; synced to VS Code on save. If you don't use VS Code sync, you can leave these blank or keep the defaults — no need to verify them.

结构：

```tsx
<div className="flex items-center gap-3 pt-0.5">
  <span className="shrink-0 text-[11px] font-semibold text-muted-foreground/70">Model info</span>
  <div className="h-px flex-1 bg-border/50" />
</div>
<p className="text-[11px] leading-snug text-muted-foreground/60">
  Auto-matched by model ID; synced to VS Code on save. If you don't use VS Code sync, you can leave these blank or keep the defaults — no need to verify them.
</p>
```

## 改动（按实现顺序）

**改动 1 — IPC 链路（先打通机制，再接 UI）**

1. `gui/electron/updater.ts`：`export const REPO_URL = \`https://github.com/${GITHUB_REPO}\`;`（新增导出）。
2. `gui/electron/ipc-contracts.ts`：在 contracts 对象加 `"repo:openRepo": contract(emptyRequest, okResponse)`。
3. `gui/electron/main.ts`：
   - 从 `./updater.ts` 导入 `REPO_URL`；
   - 新增 `async function openRepo(): Promise<{ ok: boolean }>`（`try { await shell.openExternal(REPO_URL); return { ok: true }; } catch { return { ok: false }; }`）；
   - 注册 `registerIpcHandler("repo:openRepo", openRepo);`（放在 `update:openReleasePage` 附近）。
4. `gui/electron/preload.cjs`：加 `openRepo: () => ipcRenderer.invoke("repo:openRepo"),`（CJS，与 desktop-api 保持同步）。
5. `gui/src/desktop-api.ts`：`HeimdallDesktopApi` 接口加 `openRepo(): Promise<void>;`。
6. `gui/src/mock-desktop-api.ts`：加 `openRepo: async () => { window.open(REPO_URL, "_blank", "noopener"); }`
   （浏览器预览里真开标签页；`REPO_URL` 用字面量即可，mock 不 import electron 侧常量）。
7. `gui/src/pages/vendor-editor-page.tsx`：替换提示块为上面「改动 1」的固定提示 + 可点链接结构；
   删除随之失效的派生变量 `otherCatalogKey`（L316–319）/ `otherCatalogLabel`（L321）/ `catalogLabel`（L320）。
   - `Info` 仍被固定提示使用 → **保留**；`PRICING_CATALOG_KEYS` / `PRICING_CATALOG_LABELS` 仍被
     Price source 下拉（L599–601）使用 → **保留**；`catalogKey`（L314，specialPricingKey）与
     `pricingView`（L315，价格展示）→ **保留**。

**改动 2 — 小节标题**

8. `gui/src/pages/vendor-editor-page.tsx`：L970 标题 `VS Code` → `Model info`；在分隔线下方插入 `<p>` 说明小字。

**测试**

9. `test/ipc-contracts.test.ts`：补一条 `repo:openRepo` 的断言
   （`parseIpcRequest("repo:openRepo", [])` 得 `[]`；`parseIpcResponse("repo:openRepo", { ok: true })` 通过）。
   该测试末尾的 `assert.deepEqual([...ipcContractChannels].sort(), registeredChannels)`
   会**自动**校验 main.ts 与 contracts 的通道一致——漏加任一侧即失败。

> 说明：删除 `otherCatalogKey` 等三处后，`tsc --noEmit` 若报「未使用变量」即证明清理到位；
> 若某变量其实还有别处引用，则保留它（以 tsc 结果为准）。

## 影响面

- 改动 1：新增一条 IPC 通道（`repo:openRepo`）+ 渲染层一个可点链接；不碰配置 / 价格计算 / 路由。
  既有 `update:openReleasePage` 等通道不受影响。
- 改动 2：仅显示（标题 + 小字）；`model.vscode` 数据结构、`vscode-sync.ts` 同步逻辑、
  `config-draft.ts` 序列化**全部不变**。
- 价格输入、price summary、目录自动切换（`applyModelSwitch`）行为均不变。
- Custom + 非法价格的红色提示 `Enter valid non-negative prices…` 不受影响（仍在第一分支，优先级最高）。
- 原先的 "switch to {otherCatalogLabel}" 目录切换按钮**被移除**（与自动切换能力重叠，用户已确认）。

## 最容易出问题的地方

- **IPC 契约测试**：`repo:openRepo` 必须**同时**加进 `main.ts`（`registerIpcHandler`）和
  `ipc-contracts.ts`，否则 [ipc-contracts.test.ts:49](/d:/code/projects/heimdall.worktrees/custom-sdlc-plan-issue-fix/test/ipc-contracts.test.ts)
  的通道一致性断言直接挂。这是本次改动最容易踩的坑。
- **preload.cjs 是 CJS**：新增的 `openRepo` 必须与 `desktop-api.ts` 的 TS 接口**同名同参**，
  否则渲染层调用 `getDesktopApi().openRepo()` 会在真机（非 mock）上报 undefined。
- 改动 1：清理派生变量时误删仍被引用的 `catalogKey` / `pricingView`——以 `tsc --noEmit` 为准，删完必跑 check。
- 改动 1：固定提示**每行一条**，模型多时视觉略密；文案已尽量短，若嫌长可再精简（见下方备选）。
- 改动 2：说明小字别和已有栅格/间距打架（用 `text-[11px]` + `text-muted-foreground/60` 保持弱化），手动看一眼排版即可。

### 备选文案（更短，改动 1）

> Auto-matched by model ID. Switch to Custom to override, or file an issue/PR to landfallbox/heimdall.（仓库名可点）

## 验证

1. `npm run check`（tsc --noEmit + data --check）——确认无未使用变量、类型正确、preload 与接口一致。
2. `npm test`（含 `ipc-contracts.test.ts`，覆盖新通道 + 通道一致性；GUI 组件无单测，预期全绿）。
3. 手动 `npm run gui` → Router → 供应商 → 模型卡片：
   - **改动 1** 逐状态核对：
     - 任意目录 + 目录内 id → 固定提示（新）
     - 任意目录 + 不在目录的 id → 固定提示（新，替代原 "use Custom"）
     - Custom + 任意 id → 固定提示（新，替代原矛盾提示）
     - Custom + 非法价格 → `Enter valid non-negative prices…`（红色，不变）
     - 空 model id 行 → 无提示（不变）
     - 点 `landfallbox/heimdall` → 系统浏览器打开 `https://github.com/landfallbox/heimdall`（新）
   - **改动 2**：小节标题显示 `Model info` + 说明小字；Display name / Context window /
     Capabilities 等字段编辑、保存、"Sync models to VS Code" 行为均不变。
   - 浏览器预览（mock）：点链接应 `window.open` 新标签页（不报错）。
