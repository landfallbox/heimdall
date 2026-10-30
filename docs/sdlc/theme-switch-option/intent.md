# 主题切换选项 — Intent

## 当前问题

应用没有提供主题切换选项，深色 / 浅色界面完全直接读系统设置：

- GUI 渲染层：`gui/src/main.tsx` 在 React 挂载前同步读取 `prefers-color-scheme` 并监听变化，据此切换 `<html>` 的 `.dark` 类。
- Electron 外壳：`gui/electron/main.ts` 创建窗口时用 `nativeTheme.shouldUseDarkColors` 决定标题栏图标颜色，Windows 下窗口使用 `mica` 背景材质，均只跟随系统主题。

用户无法固定深色或固定浅色界面（例如系统为深色但希望界面浅色，或反之），只能去改系统设置。

## 期望结果

- 在应用设置页（General 卡片）提供「主题」选项，三个取值：**跟随系统 / 浅色 / 深色**，默认 **跟随系统**（与现状行为一致）。
- 选择后立即生效并持久化到 `config.json` 的 `app` 节；重启后仍保持所选主题。
- 选择「跟随系统」时继续实时跟随系统主题变化（保留现有行为）；选择固定主题后不再受系统主题变化影响。
- 界面内容区与 Electron 外壳（标题栏图标颜色、Windows mica 背景材质）整体跟随所选主题，观感一致。
- 浏览器（mock API）模式下该选项同样可用并持久化，行为与 Electron 模式一致（渲染层部分）。

## 受影响系统

- **GUI 前端**：`gui/src/main.tsx`（主题应用逻辑从「直接读系统设置」改为「读配置 + 系统设置」）；`gui/src/pages/application-page.tsx`（新增主题选项 UI）；`gui/src/App.tsx`（`setAppSetting` 扩展 theme 字段）；`gui/src/types.ts`、`gui/src/config-draft.ts`（app 配置类型）。
- **Electron 主进程**：`gui/electron/main.ts`（按配置同步 `nativeTheme.themeSource`，主题变化时更新标题栏 overlay）；`gui/electron/ipc-contracts.ts`（视设计需要，可能新增主题相关 IPC）。
- **配置 schema**：`src/config.ts`（`NormalizedAppConfig` 增加 `theme` 字段、zod schema 与 `DEFAULT_CONFIG` 默认值）；GUI 侧 mock（`gui/src/mock-desktop-api.ts`）。
- **下游**：router 服务本身不受影响（主题为纯 GUI 层关注点）；`config.json` 新增一个字段，旧配置通过默认值兼容（无该字段 = 跟随系统）。

## 数据 / 技术约束

- 主题字段存入 `config.json` 的 `app` 节（与 `closeBehavior`、`startAtLogin` 等同级），旧配置缺省该字段时 zod 默认值兜底为「跟随系统」。
- 渲染层需在 React 挂载前应用主题，避免可见的主题闪烁（现有 `applySystemTheme` 是同步的）；启动时如何同步拿到配置值是设计问题（例如由主进程建窗时传入）。
- 主进程 `nativeTheme.themeSource` 需与配置保持同步（`system` / `light` / `dark`）；标题栏 overlay 的 `symbolColor` 在建窗时计算，运行时主题变化需通过 `setTitleBarOverlay` 更新。
- Windows 的 mica 背景材质跟随 `nativeTheme`；macOS 下的材质 / vibrancy 行为需在设计阶段确认。
- 浏览器（mock）模式没有 `nativeTheme`，只有渲染层 `.dark` 类生效。

## 明确不做的事

- 自定义强调色 / 配色方案
- 高对比度等更多主题模式
- 每个窗口独立主题（应用为全局单一主题选项，仅一个主窗口）
- 托盘图标不随主题变化（保持构建期生成的静态位图，不构建亮 / 暗两套图标）

## 已确认决策

1. 选项取值：跟随系统 / 浅色 / 深色，默认「跟随系统」
2. 选项位置：应用设置页 General 卡片
3. Electron 外壳同步：同步 `nativeTheme.themeSource`，标题栏图标颜色与 mica 材质跟随所选主题
4. 浏览器（mock）模式：支持，行为与 Electron 模式一致
5. 托盘图标不随主题变化（保持构建期生成的静态位图）
