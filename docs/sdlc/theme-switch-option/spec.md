# 主题切换选项 — Spec

> 依据已确认的 [intent.md](./intent.md)。本 spec 描述功能如何工作、数据如何流动、影响哪些系统，以及安全 / 合规 / 性能疑点。

## 1. 功能如何工作

### 1.1 主题模式

引入统一的主题模式类型 `ThemeMode = "system" | "light" | "dark"`，默认 `"system"`（跟随系统，与现状一致）。

- **system**：实时跟随系统 `prefers-color-scheme`（保留现有行为）。
- **light / dark**：固定主题，不再受系统主题变化影响。

### 1.2 渲染层（网页内容区）

新增独立模块 `gui/src/theme.ts`，集中管理 `.dark` 类的切换，避免逻辑散落在 `main.tsx`：

- `applyTheme(mode)`：同步设置 `<html>` 的 `.dark` 类。`system` → 读 `matchMedia("(prefers-color-scheme: dark)")`；`light` → 移除；`dark` → 加上。
- `initTheme(mode)`：调用 `applyTheme(mode)` 并挂载一个**常驻**的 `matchMedia` change 监听器；监听器内部仅在 `currentMode === "system"` 时才应用，因此切到固定主题后系统变化不再触发切换。
- 模块内部维护 `currentMode` 状态，`applyTheme` 每次更新它。

**无闪烁的关键**：Electron 主窗口以 `show: false` 创建，只有渲染层在 `loadState()` 完成（其中已 `applyTheme(loadedDraft.app.theme)`）后调用 `rendererReady` IPC，主进程才 `window.show()`。因此主题在窗口可见前已应用到位，**无需通过 URL 传参**传递初始主题（见 §4 决策 D1）。

- `gui/src/main.tsx`：把现有内联的 `applySystemTheme` 逻辑替换为 `initTheme(readInitialThemeFromUrl())`。`readInitialThemeFromUrl()` 读取 `?theme=` 查询参数（若存在）否则回退 `system`——作为**可选的**首帧正确性加固（见 D1），主流程不依赖它。

### 1.3 Electron 外壳（主进程）

主进程是外壳主题的唯一控制方，通过 `nativeTheme.themeSource` 驱动：

- 新增模块级 `currentShellTheme` 缓存与 `applyShellTheme(theme)`：
  - `nativeTheme.themeSource = theme`（`system` / `light` / `dark`）。
  - 调用 `updateTitleBarOverlay()`：按 `nativeTheme.shouldUseDarkColors` 重算 `symbolColor`（深色 `#94A3B8` / 浅色 `#475569`），非 macOS 且窗口存在时 `mainWindow.setTitleBarOverlay({ color: "#00000000", symbolColor, height: 34 })`。
- **启动时**：`app.whenReady()` 中 `loadConfig()` 之后、`createWindow()` 之前调用 `applyShellTheme(config.app.theme)`，保证建窗时 `shouldUseDarkColors` 已反映所选主题（`createWindow` 的 `titleBarOverlay.symbolColor` 直接读它）。
- **运行时**：渲染层改主题时调用新 IPC `app:setTheme`，主进程执行 `applyShellTheme(theme)`， mica 材质与标题栏图标颜色即时跟随。

### 1.4 设置界面

- `gui/src/pages/application-page.tsx` 的 **Window 卡片**（现有 Close button / Start at login 所在卡片，即 intent 所指「General 卡片」）新增一个 `Field`「Theme」，用 `SegmentedControl` 提供 `跟随系统 / 浅色 / 深色` 三选项，`value={app.theme}`，`onChange` 调用 `onSetAppSetting("theme", value)`。
- `onSetAppSetting` 的字段联合类型扩展 `theme`，值类型扩展 `ThemeMode`。

## 2. 数据如何流动

### 2.1 配置持久化（`config.json` 的 `app.theme`）

```
src/config.ts                         gui/src/config-draft.ts
  NormalizedAppConfig.theme             Draft.app.theme
  configSchema.app.theme (zod)          toDraft/toConfig/normalizeTheme
  DEFAULT_CONFIG.app.theme="system"     defaultDraft.app.theme="system"
        │                                       │
        └────────── config:load / config:save IPC ──────────┘
                          │
                 gui/src/App.tsx
                 setAppSetting("theme", value)
```

- 旧配置无 `theme` 字段时，zod `default("system")` 与 `normalizeTheme` 兜底为 `system`，向后兼容。
- `config.example.json` 的 `app` 节补 `"theme": "system"` 作为文档示例。

### 2.2 运行时主题切换（用户改选项）

```
用户点击 SegmentedControl
   │
   ▼
App.setAppSetting("theme", value)
   ├─ applyTheme(value)              // 渲染层 .dark 类即时切换（同步）
   ├─ run("saveApp", async () => {
   │     saveConfig({ ...app.theme=value })   // 持久化
   │     setTheme(value)                          // 新 IPC → 主进程 applyShellTheme
   │  })
   ▼
主进程 app:setTheme handler → applyShellTheme(value)
   ├─ nativeTheme.themeSource = value
   └─ updateTitleBarOverlay()        // symbolColor + mica 跟随
```

- 渲染层 `.dark` 类与主进程 `nativeTheme` 分别即时生效，二者都源自同一个 `value`，保持一致。
- `setAppSetting` 复用现有 `busy === "saveApp"` 早退与 `value === persistedDraft.app[field]` 早退逻辑。

### 2.3 启动加载

```
app.whenReady()
  └─ loadConfig() → config.app.theme
       ├─ applyShellTheme(theme)      // 主进程外壳
       └─ createWindow()              // 建窗时 symbolColor 已正确
渲染层 main.tsx
  └─ initTheme(readInitialThemeFromUrl())   // 首帧（可选 URL 参数，否则 system）
App.tsx useEffect → loadState()
  └─ loadConfig() → draft.app.theme
       ├─ applyTheme(theme)           // 渲染层定稿
       └─ (finally) rendererReady()   // 主进程此时才 show 窗口
```

## 3. 影响哪些系统

| 系统 | 文件 | 改动 |
|------|------|------|
| 配置 schema | `src/config.ts` | `NormalizedAppConfig` 加 `theme`；新增 `themeSchema`；`DEFAULT_CONFIG.app.theme="system"`；`configSchema.app` 加 `theme` |
| GUI 配置映射 | `gui/src/config-draft.ts` | `Draft`/`Config`/`ConfigInput` 的 `app` 加 `theme`；新增 `ThemeMode` 类型与 `normalizeTheme`；`toDraft`/`toConfig`/`defaultDraft` 同步 |
| 渲染层主题模块 | `gui/src/theme.ts`（**新增**） | `ThemeMode`、`applyTheme`、`initTheme`、`readInitialThemeFromUrl` |
| 渲染层入口 | `gui/src/main.tsx` | 内联 `applySystemTheme` 替换为 `initTheme(readInitialThemeFromUrl())` |
| 应用状态 | `gui/src/App.tsx` | `loadState` 中 `applyTheme(loadedDraft.app.theme)`；`setAppSetting` 扩展 `theme` 字段 + 调用 `applyTheme` 与 `setTheme` IPC |
| 设置页 | `gui/src/pages/application-page.tsx` | Window 卡片加 Theme `SegmentedControl`；`onSetAppSetting` 类型扩展 |
| 桌面 API 类型 | `gui/src/desktop-api.ts` | `HeimdallDesktopApi` 加 `setTheme(theme): Promise<{ok:boolean}>` |
| preload 桥 | `gui/electron/preload.cjs` | 加 `setTheme: (theme) => ipcRenderer.invoke("app:setTheme", theme)` |
| IPC 契约 | `gui/electron/ipc-contracts.ts` | 加 `"app:setTheme": contract(z.tuple([z.enum(["system","light","dark"])]), okResponse)` |
| 主进程 | `gui/electron/main.ts` | `currentShellTheme` 缓存、`applyShellTheme`、`updateTitleBarOverlay`；`whenReady` 中 `applyShellTheme`；注册 `app:setTheme` handler |
| 浏览器 mock | `gui/src/mock-desktop-api.ts` | `MockConfig.app` 加 `theme`；默认 `system`；加 `setTheme: async () => ({ ok: true })` |
| 配置示例 | `config.example.json` | `app` 节加 `"theme": "system"` |
| 测试 | `test/config-draft.test.ts`、`test/ipc-contracts.test.ts` | 见 §5 |

**不受影响**：router 服务（`src/server.ts` 等）、VS Code 同步、usage 统计、托盘图标（intent 明确不做）。

## 4. 关键设计决策

- **D1 — 不用 URL 传参做主通道**：窗口 `show:false` 直到 `rendererReady`（在 `loadState` 应用主题之后）才显示，天然无闪烁。`readInitialThemeFromUrl()` 仅作为可选加固（覆盖 4s 兜底超时等极端场景），主流程不依赖，`createWindow` 无需改动。
- **D2 — 新增独立 `app:setTheme` IPC 而非监听 `config:save`**：显式、可测、与配置保存解耦；`config:save` 被所有配置项共用，若在其中判断 theme 变化则每次保存都要比对。
- **D3 — 主题模块集中管理监听器**：`initTheme` 挂载常驻 `matchMedia` 监听器，内部按 `currentMode` 决定是否应用，避免 `main.tsx` 与 `App.tsx` 各自挂监听器造成双重触发。
- **D4 — 主进程是外壳主题唯一控制方**：渲染层只管 `.dark` 类；`nativeTheme` 只由主进程改。二者由同一个 `value` 驱动，保持一致。
- **D5 — 选项落在 Window 卡片**：intent 所指「General 卡片」即现有 Window 卡片（Close button / Start at login 所在），主题属外观类设置，放此处改动最小。

## 5. 测试 / 验证

- `test/config-draft.test.ts`：补 theme 往返断言——缺省 `theme` 归一为 `system`；`toDraft`/`toConfig` 保留 `dark`/`light`。
- `test/ipc-contracts.test.ts`：现有用例已强校验 `main.ts` 的 `registerIpcHandler` 集合与 `ipcContractChannels` 完全一致，新增 `app:setTheme` 后自动覆盖；另补一条 `parseIpcRequest("app:setTheme", ["dark"])` 与非法值抛错的断言。
- `npm run check`（tsc 类型检查）确保 `ThemeMode` 在各层类型一致。
- 手动验证（`npm run gui`）：
  1. 默认跟随系统，切换系统主题界面跟随。
  2. 选「深色」/「浅色」，界面与标题栏图标、Windows mica 材质即时跟随；改回「跟随系统」恢复实时跟随。
  3. 重启应用，所选主题保持。
  4. 浏览器（mock）模式切换主题可用（见 §6 限制）。

## 6. 安全 / 合规 / 性能疑点

- **安全**：`app:setTheme` 走既有 `registerIpcHandler` 的发送方校验（`event.sender === mainWindow.webContents`），且 zod 限定枚举值，无注入面。`?theme=` 参数若启用，`readInitialThemeFromUrl` 仅接受三个合法值，其余回退 `system`。
- **合规**：纯本地 GUI 偏好，无数据外发、无隐私影响。
- **性能**：`applyTheme` 为单次 `classList.toggle`，`applyShellTheme` 为一次 `themeSource` 赋值 + 一次 `setTitleBarOverlay`，均可忽略不计；常驻 `matchMedia` 监听器仅在 `system` 模式下做 DOM 操作。
- **已知限制**：
  1. **外部改 `config.json` 的 theme**：主进程文件监听器只向渲染层发 `config:changed`（用户需手动 Reload），外壳主题在**下次启动**才同步；本次不做运行时的外部变更联动。
  2. **浏览器（mock）模式**：mock 配置为内存态，主题选项可用但**不跨页面刷新持久化**（mock 设计使然）；Electron 模式正常持久化。
  3. **macOS**：`vibrancy: "under-window"` 毛玻璃不随 `themeSource` 变化外观（系统材质本身自适应），本 spec 不额外处理；`symbolColor` 逻辑仅作用于 Windows 的 `titleBarOverlay`。
