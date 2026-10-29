# 主题切换选项 — Plan

> 依据已确认的 [spec.md](./spec.md)。本 plan 列出改哪些文件、实现顺序、影响面、要跑哪些测试。**计划批准前不修改任何代码。**

## 0. 实现顺序总览

自底向上，保证每步类型可独立校验（`npm run check` 随时可跑）：

| # | 文件 | 动作 | 依赖 |
|---|------|------|------|
| 1 | `src/config.ts` | 配置 schema 源头加 `theme` | 无 |
| 2 | `gui/src/config-draft.ts` | GUI 草稿映射加 `theme` + `ThemeMode` | 1 |
| 3 | `gui/src/theme.ts` | **新增** 渲染层主题模块 | 2 |
| 4 | `gui/electron/ipc-contracts.ts` | 加 `app:setTheme` 契约 | 无 |
| 5 | `gui/electron/preload.cjs` | 加 `setTheme` 桥 | 4 |
| 6 | `gui/src/desktop-api.ts` | 接口加 `setTheme` | 2 |
| 7 | `gui/electron/main.ts` | `applyShellTheme` + 注册 handler | 4 |
| 8 | `gui/src/App.tsx` | `loadState` 应用主题 + `setAppSetting` 扩展 | 2,3,6 |
| 9 | `gui/src/main.tsx` | 内联主题逻辑替换为 `initTheme` | 3 |
| 10 | `gui/src/pages/application-page.tsx` | Window 卡片加 Theme 选项 | 2,8 |
| 11 | `gui/src/mock-desktop-api.ts` | mock 加 `theme` + `setTheme` | 2,6 |
| 12 | `config.example.json` | `app` 节加 `"theme": "system"` | 无 |
| 13 | `test/config-draft.test.ts`、`test/ipc-contracts.test.ts` | 补断言 | 1,2,4 |

**类型单一来源**：`ThemeMode` 在 `src/config.ts`（主进程/配置层）与 `gui/src/config-draft.ts`（渲染层）各定义一份，与现有 `CloseBehavior` 的双层定义模式一致。渲染层其余文件（`theme.ts`、`desktop-api.ts`、`application-page.tsx`、`App.tsx`）一律从 `config-draft.ts` 导入，不重复定义。

---

## 1. `src/config.ts`（配置 schema 源头）

- 顶部类型区（`CloseBehavior` 旁，约 L4）加：
  ```ts
  export type ThemeMode = "system" | "light" | "dark";
  ```
- `NormalizedAppConfig`（L66-70）加字段 `theme: ThemeMode;`
- `DEFAULT_CONFIG.app`（L89-93）加 `theme: "system",`
- schema 常量区（`closeBehaviorSchema` 旁，L118）加：
  ```ts
  const themeSchema = z.enum(["system", "light", "dark"]);
  ```
- `configSchema.app`（L212-216）加 `theme: themeSchema.default(DEFAULT_CONFIG.app.theme),`
- `normalizeConfig` 的 `app` 返回（L255-259）加 `theme: normalizeTheme(app.theme),`
- 新增私有函数（`normalizeCloseBehavior` 旁，L273 后）：
  ```ts
  function normalizeTheme(value: unknown): ThemeMode {
    return themeSchema.safeParse(value).success ? (value as ThemeMode) : DEFAULT_CONFIG.app.theme;
  }
  ```

## 2. `gui/src/config-draft.ts`（GUI 草稿映射）

- 顶部（L1 区）加 `export type ThemeMode = "system" | "light" | "dark";`
- `Draft.app`（L85）加 `theme: ThemeMode;`
- `Config.app`（L131）加 `theme: ThemeMode;`
- `ConfigInput.app`（L150）加 `theme?: string;`
- `defaultDraft.app`（L163-164）加 `theme: "system",`
- 常量区（`closeBehaviorValues` 旁，L180）加：
  ```ts
  const themeValues = new Set<ThemeMode>(["system", "light", "dark"]);
  ```
- 新增导出函数（`normalizeCloseBehavior` 旁，L196-198 后）：
  ```ts
  export function normalizeTheme(value: unknown): ThemeMode {
    return themeValues.has(value as ThemeMode) ? (value as ThemeMode) : defaultDraft.app.theme;
  }
  ```
- `toDraft` 的 `app`（L309-312）加 `theme: normalizeTheme(app.theme),`
- `toConfig` 的 `app`（L341-344）加 `theme: normalizeTheme(draft.app?.theme),`

## 3. `gui/src/theme.ts`（**新增** 渲染层主题模块）

集中管理 `.dark` 类与 `matchMedia` 监听器（spec D3）。内容：

```ts
import type { ThemeMode } from "./config-draft.ts";

const DARK_MEDIA = "(prefers-color-scheme: dark)";
let currentMode: ThemeMode = "system";

export function applyTheme(mode: ThemeMode): void {
  currentMode = mode;
  const prefersDark = mode === "dark" || (mode === "system" && window.matchMedia(DARK_MEDIA).matches);
  document.documentElement.classList.toggle("dark", prefersDark);
}

export function initTheme(mode: ThemeMode): void {
  applyTheme(mode);
  window.matchMedia(DARK_MEDIA).addEventListener("change", () => {
    if (currentMode === "system") applyTheme("system");
  });
}

export function readInitialThemeFromUrl(): ThemeMode {
  try {
    const param = new URLSearchParams(window.location.search).get("theme");
    if (param === "system" || param === "light" || param === "dark") return param;
  } catch { /* ignore */ }
  return "system";
}
```

- `initTheme` 只挂**一个**常驻监听器，内部按 `currentMode` 决定是否应用 → 切到固定主题后系统变化不再触发（spec D3）。
- `readInitialThemeFromUrl` 仅接受三合法值，其余回退 `system`（spec §6 安全）。

## 4. `gui/electron/ipc-contracts.ts`（IPC 契约）

- 在 `ipcContracts` 冻结对象内（`"app:rendererReady"` 附近，L142）加：
  ```ts
  "app:setTheme": contract(z.tuple([z.enum(["system", "light", "dark"])]), okResponse),
  ```
- `okResponse` 已存在（L8），直接复用。

## 5. `gui/electron/preload.cjs`（preload 桥）

- 在 `rendererReady` 行（L17）后加：
  ```js
  setTheme: (theme) => ipcRenderer.invoke("app:setTheme", theme),
  ```
- 与 `desktop-api.ts` 的 `setTheme` 保持签名一致（CommonJS 不参与类型检查，需手工同步）。

## 6. `gui/src/desktop-api.ts`（渲染层 API 类型）

- 顶部加 `import type { ThemeMode } from "./config-draft.ts";`
- `HeimdallDesktopApi` 接口（`rendererReady` 旁，L64）加：
  ```ts
  setTheme(theme: ThemeMode): Promise<{ ok: boolean }>;
  ```

## 7. `gui/electron/main.ts`（主进程外壳主题）

- 模块级（`let mainWindow` 附近，L85）加：
  ```ts
  let currentShellTheme: "system" | "light" | "dark" = "system";
  ```
- 新增两个函数（放在 `createWindow` 之前，约 L1370）：
  ```ts
  function updateTitleBarOverlay() {
    if (!mainWindow || mainWindow.isDestroyed() || process.platform === "darwin") return;
    const symbolColor = nativeTheme.shouldUseDarkColors ? "#94A3B8" : "#475569";
    mainWindow.setTitleBarOverlay({ color: "#00000000", symbolColor, height: 34 });
  }

  function applyShellTheme(theme: "system" | "light" | "dark") {
    currentShellTheme = theme;
    nativeTheme.themeSource = theme;
    updateTitleBarOverlay();
  }
  ```
- `app.whenReady()` 内（L1595-1596，`applyPackagedLoginStartup` 之后、同一 try 块内）加：
  ```ts
  applyShellTheme(config.app.theme);
  ```
  必须在 `createWindow()` 之前，保证建窗时 `shouldUseDarkColors` 已反映所选主题（spec §1.3 / D1）。
- 注册 handler（`registerIpcHandler("app:rendererReady", ...)` 附近，L1527 后）：
  ```ts
  registerIpcHandler("app:setTheme", (_event, theme) => {
    applyShellTheme(theme as "system" | "light" | "dark");
    return { ok: true };
  });
  ```
- `createWindow` 本身**不改**：其 `titleBarOverlay.symbolColor`（L1405）读 `nativeTheme.shouldUseDarkColors`，因 `applyShellTheme` 已先执行，取值正确。

## 8. `gui/src/App.tsx`（应用状态）

- 导入区加 `import { applyTheme } from "./theme.ts";`，并在 `config-draft.ts` 的 import 中补 `type ThemeMode`。
- `loadState`（L358-359，`setPersistedDraft(loadedDraft);` 之后）加：
  ```ts
  applyTheme(loadedDraft.app.theme);
  ```
  位于 `finally` 里的 `rendererReady()` 之前 → 窗口可见前主题已定稿（spec §2.3 / D1）。
- `setAppSetting`（L552）签名扩展：
  ```ts
  async function setAppSetting(
    field: "closeBehavior" | "startAtLogin" | "syncVsCodeModels" | "theme",
    value: CloseBehavior | boolean | ThemeMode,
  ) {
  ```
- 早退判断（L553）不变（`persistedDraft.app[field]` 联合类型自动含 `ThemeMode`）。
- 早退之后、`run` 之前加即时渲染层切换：
  ```ts
  if (field === "theme") applyTheme(value as ThemeMode);
  ```
- `run` 回调内 `saveConfig` 成功、`setConfigChanged(false)` 之后加外壳同步：
  ```ts
  if (field === "theme") void getDesktopApi().setTheme(value as ThemeMode);
  ```

## 9. `gui/src/main.tsx`（渲染层入口）

- 删除内联 `applySystemTheme` 函数及其调用 + `addEventListener`（L7-13）。
- 顶部加 `import { initTheme, readInitialThemeFromUrl } from "./theme.ts";`
- 原位置替换为单行：
  ```ts
  initTheme(readInitialThemeFromUrl());
  ```
- 其下的 `electron-shell` / `platform-mac` 类逻辑（L16-21）保持不变。

## 10. `gui/src/pages/application-page.tsx`（设置页 UI）

- 导入区加 `import type { ThemeMode } from "../config-draft.ts";`
- `closeBehaviorOptions` 旁（L14 后）加：
  ```ts
  const themeOptions: Array<{ value: ThemeMode; label: string }> = [
    { value: "system", label: "Follow system" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];
  ```
- `onSetAppSetting` prop 类型（L26）扩展为：
  ```ts
  onSetAppSetting: (field: "closeBehavior" | "startAtLogin" | "syncVsCodeModels" | "theme", value: CloseBehavior | boolean | ThemeMode) => Promise<void>;
  ```
- Window 卡片 `CardContent` 内（`Close button` 的 `Field` 之后、`<Separator />` 之前，L94 附近）加：
  ```tsx
  <Field label="Theme">
    <SegmentedControl
      options={themeOptions}
      value={app.theme}
      onChange={(value) => void onSetAppSetting("theme", value)}
      disabled={saving}
    />
  </Field>
  <Separator />
  ```

## 11. `gui/src/mock-desktop-api.ts`（浏览器 mock）

- `MockConfig.app`（L24）加 `theme: string;`
- 默认 `config.app`（L58）加 `theme: "system",`
- mock 对象（`rendererReady` 旁，L248）加：
  ```ts
  setTheme: async () => ({ ok: true }),
  ```
- `saveConfig`/`loadConfig` 已用 `Object.assign(config, clone(next))` + `clone(config)`，`theme` 自动随 app 节往返，无需额外改动（spec §6 限制 2：内存态，不跨刷新持久化）。

## 12. `config.example.json`（配置示例）

- `app` 节（L2-5）加 `"theme": "system",`（放在 `startAtLogin` 后）。

## 13. 测试

### `test/config-draft.test.ts`
在 `syncVsCodeModels` 往返断言（L295-301）后加：
```ts
assert.equal(toConfig(toDraft(normalizeConfig({
  router: { apiKey: "test-token" },
  app: { theme: "dark" },
}))).app.theme, "dark");
assert.equal(toDraft(normalizeConfig({
  router: { apiKey: "test-token" },
})).app.theme, "system");
assert.equal(toDraft(normalizeConfig({
  router: { apiKey: "test-token" },
  app: { theme: "bogus" },
})).app.theme, "system");
```

### `test/ipc-contracts.test.ts`
在现有 `parseIpcRequest` 断言区加：
```ts
assert.deepEqual(parseIpcRequest("app:setTheme", ["dark"]), ["dark"]);
assert.throws(
  () => parseIpcRequest("app:setTheme", ["bogus"]),
  /Invalid IPC request for app:setTheme: 0/,
);
```
现有 `assert.deepEqual([...ipcContractChannels].sort(), registeredChannels)`（L38）会自动强校验 `app:setTheme` 已在 `main.ts` 注册。

## 14. 首帧系统深色注入（验证阶段新增，修复既有 bug）

实机测试发现：**首启"跟随系统"在深色系统下显示浅色且不自行修正**（既有 bug，非本功能回归——旧代码同样用首帧 `matchMedia`）。根因是 Electron 渲染进程首帧的 `matchMedia(prefers-color-scheme: dark)` 尚未同步 OS 深色（恒 `false`），且之后不触发 `change` 事件。

修复（方案 B：主进程注入可靠值）：

- `main.ts` `createWindow`：新增模块级 `let shellTheme: "system" | "light" | "dark" = "system";`，`applyShellTheme` 内记录 `shellTheme = theme;`。建窗时把主题与主进程可靠深色状态一起注入渲染进程：
  - dev（`loadURL`）：`url.searchParams.set("theme", shellTheme); url.searchParams.set("osDark", String(nativeTheme.shouldUseDarkColors));`
  - 生产（`loadFile`）：`{ query: { theme: shellTheme, osDark: String(nativeTheme.shouldUseDarkColors) } }`
- `theme.ts` 新增 `readInitialOsDarkFromUrl()`（读 `?osDark=`，`"true"`→true / `"false"`→false / 其余 null）。
- `theme.ts` 新增模块级 `let knownOsDark: boolean | null = null;` 缓存：
  - `applyTheme(mode, osDarkOverride?)`：`osDarkOverride !== undefined` 时写入 `knownOsDark`；`system` 模式优先用 `knownOsDark ?? matchMedia`。
  - `initTheme` 的 `change` 监听器刷新 `knownOsDark = e.matches`。
  - **关键**：`App.tsx` `loadState` 里 config 加载后会再次 `applyTheme(loadedDraft.app.theme)`（无 override），若仍用首帧 `matchMedia` 会把首帧正确值覆盖回浅色；用 `knownOsDark` 缓存兜底后，该次调用也取可靠值。
- `main.tsx`：`initTheme(readInitialThemeFromUrl(), readInitialOsDarkFromUrl())`。

**验证**（主进程 `webContents.executeJavaScript` 探针，非 CDP——CDP 会强制 `prefers-color-scheme: light` 造成误判）：
- dev 首启（深色 OS）：`.dark=true`，`matchMedia=true` ✓
- 生产首启（干净数据目录，深色 OS）：`.dark=true`，`matchMedia=true` ✓
- 模块单测：override=true→dark；无 override 保持 knownOsDark；override=false→light ✓

---

## 影响面 / 可能破坏的现有功能

| 风险点 | 说明 | 缓解 |
|--------|------|------|
| `test/ipc-contracts.test.ts` 强校验 | 该测试读 `main.ts` 源码提取所有 `registerIpcHandler("...")`，断言与 `ipcContractChannels` **完全相等** | 步骤 4（契约）与步骤 7（注册 handler）**必须同批完成**，缺一即挂 |
| `ThemeMode` 类型一致性 | 5 处渲染层文件 + 主进程各引用，拼写/取值不一致会 tsc 报错 | 渲染层统一从 `config-draft.ts` 导入；`npm run check` 兜底 |
| `setAppSetting` 联合类型 | 字段/值联合扩展后，`persistedDraft.app[field]` 索引类型需能匹配 | 已核对：4 键联合索引 = `CloseBehavior \| boolean \| ThemeMode`，与 value 类型一致 |
| 主进程 `nativeTheme` 时序 | `applyShellTheme` 必须在 `createWindow` 前，否则建窗 `symbolColor` 取错 | 放在 whenReady 的 try 块内、`createWindow` 之前 |
| preload.cjs 不被类型检查 | `node --check` 只查语法，`setTheme` 与接口不一致仅运行时暴露 | 手工保持与 `desktop-api.ts` 签名一致 |
| 旧配置无 `theme` 字段 | zod `default("system")` + `normalizeTheme` 兜底 | 向后兼容，默认跟随系统 = 现状行为 |
| 首帧 `matchMedia` 竞态 | 渲染进程首帧 `prefers-color-scheme` 可能未同步 OS 深色（恒 false） | 步骤 14：主进程 `nativeTheme.shouldUseDarkColors` 经 URL 注入 + `knownOsDark` 缓存兜底 |
| CDP 媒体模拟陷阱 | 调试时用 CDP 连接会强制 `prefers-color-scheme: light`，导致深色验证误判 | 验证一律走主进程 `executeJavaScript` 探针，不用 CDP 读 `.dark` |

**不受影响**：router 服务、VS Code 同步、usage 统计、托盘图标（intent 明确不做）。

## 最可能出问题的步骤

**步骤 4 + 7（IPC 契约与主进程注册的配对）**。`test/ipc-contracts.test.ts` 是仓库里最强的约束——它把 `main.ts` 里实际注册的 channel 集合和 `ipc-contracts.ts` 声明的集合做 `deepEqual`。只改其一必然失败：
- 只加契约不注册 → 测试报集合不等，且运行时 handler 抛 `Missing IPC request contract`。
- 只注册不加契约 → 测试报集合不等，且 `parseIpcRequest` 抛错。

**应对**：这两步作为同一提交单元完成，改完立即 `npm test` 验证。

## 备选方案（若主方案受阻）

- **A. 外壳主题改走 `config:save` 联动**（放弃独立 `app:setTheme`）：在 `saveConfig` 里比对 `theme` 变化后调 `applyShellTheme`。省一个 IPC，但每次保存都要比对、与配置保存耦合，可测性差。**不推荐**，仅当 IPC 契约测试反复受阻时回退。
- **B. 去掉 `readInitialThemeFromUrl`**：既然窗口 `show:false` 到 `rendererReady` 才显示，URL 参数属冗余加固。若嫌多余可只留 `initTheme("system")`，`main.tsx` 更简单。**可选裁剪**，不影响主流程。
- **C. 主题选项放独立「Appearance」卡片**（而非 Window 卡片）：更符合语义，但要多建一张卡、改动更大。**不推荐**，与 spec D5 已定方案冲突，除非用户改主意。

## 测试 / 验证命令

```powershell
npm run check        # tsc 类型检查 + node --check（preload.cjs 等），每步后可跑
npm test             # 全量 node 单测（含 config-draft、ipc-contracts）
npm run test:electron # Electron 生命周期测试
npm run test:ci      # = npm test && test:electron，CI 等价
```

手动验证（`npm run gui`，spec §5）：
1. 默认跟随系统，切换系统主题界面跟随。
2. 选「深色」/「浅色」，界面 + 标题栏图标 + Windows mica 即时跟随；改回「跟随系统」恢复实时跟随。
3. 重启应用，所选主题保持。
4. 浏览器（mock）模式切换主题可用（不跨刷新持久化）。
