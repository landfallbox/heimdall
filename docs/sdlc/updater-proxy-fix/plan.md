# 更新器代理支持与日志盲区修复

档位：轻量版（单个功能点，影响面可控）
状态：已完成并验证（2026-11-08）

## 问题

v0.23.0 自动更新下载 v0.24.0 安装包失败（"Update download failed"），用户网络正常。

根因：
- 更新器使用 Node 全局 fetch（undici），既不读取系统代理（WinINET），也不读取代理环境变量。
- 本网络直连 GitHub 极慢（Node fetch 实测 ~33KB/s，curl 直连 ~250KB/s），经本地 Clash 代理（127.0.0.1:7890）可达 MB/s 级。
- 下载 30 秒空闲超时（`DOWNLOAD_IDLE_TIMEOUT_MS`）被触发后中止，且 Temp 目录无残留部分文件，说明卡死在 fetch 阶段。
- 更新器错误仅 `console.error` 到主进程控制台（打包后丢弃），`autoUpdater.logger = null`，日志页完全看不到更新器信息。

## 方案（用户已确认 A + C）

A. 更新器的网络请求走已解析的代理：
- 新增 `gui/electron/proxy.ts`：`resolveProxyUrl(targetUrl)` 按 环境变量（HTTPS_PROXY/HTTP_PROXY）→ Windows WinINET 注册表（`reg query`，60s TTL 缓存）顺序解析；支持 NO_PROXY；仅处理 http/https 代理。
- `gui/electron/updater.ts` 改用 undici 的 `fetch` + `ProxyAgent`（dispatcher 按代理 URL 缓存），两处 fetch 调用点（latest release API、安装包下载）统一走 `fetchWithProxy`。
- 新增依赖 `undici@^8.12.4`（Electron 42 内置 Node 24.18.0，满足 engines >=22.19.0；纯 JS 实现，electron-builder 正常打包）。

C. 更新器生命周期日志：
- 复用 `src/logger.ts` 的 `createLogger`，写入既有 `logs/router-YYYY-MM-DD.log`（日志页可直接看到）。
- 事件：`updater_check_started/completed/failed`、`updater_download_started/completed/failed`（含代理地址与错误链）、`updater_install_started/failed`。
- `main.ts`：`initializeUpdater()` 前 `configureUpdaterLogging(getPaths().dataDir)`；`before-quit` 时 `disposeUpdaterLogging()`。

## 改动文件

- 新增 `gui/electron/proxy.ts`
- 修改 `gui/electron/updater.ts`（undici fetch + ProxyAgent、日志、`fetchWithProxy` 导出）
- 修改 `gui/electron/main.ts`（日志接线）
- 修改 `package.json` / `package-lock.json`（undici 依赖；test 脚本加入 proxy 测试）
- 新增 `test/proxy.test.ts`（单元 + 本地正向代理集成测试）

## 验证结果

- `npx tsc --noEmit`：通过
- `npm test`（含新增 proxy 测试、既有 updater 场景测试）：全部通过
- `npm run test:electron`（真实启动 app 的生命周期测试）：通过
- 端到端（tsx 直接跑 updater 模块）：
  - `resolveProxyUrl("https://github.com")` → `http://127.0.0.1:7890/`（WinINET 注册表路径生效）
  - `fetchWithProxy` 真实请求 0.24.0 安装包：HTTP 200，10s abort 正常触发（AbortError）
  - 速度对比：直连 Node fetch ~33KB/s → 走代理 ~96-107KB/s（当日代理节点吞吐波动，curl 经同一代理同窗口 ~107KB/s，与 undici 一致，证明链路正确）

## 备注

- 已安装的 v0.23.0 仍是旧代码，修复随下一版本发布生效；期间可手动下载安装包。
- 代理解析失败时回退直连（`fetchWithProxy` 无代理时即普通 undici fetch），不引入新的失败模式。
