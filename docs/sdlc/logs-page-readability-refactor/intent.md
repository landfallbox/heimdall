# Logs 页面可读性重构 — 意图

## 当前问题

Logs 页面（Runtime Logs）可读性差，具体表现：

1. **视觉噪音大、信息密度低**：每条日志渲染成一张带边框卡片，元数据用等宽 key:value 平铺，同一屏只能看 5-6 条。
2. **错误/警告不突出**：所有条目都是绿色 info 徽章 + 相同版式，没有视觉层级，扫一眼分不出正常与异常。
3. **找不到特定请求**：requestId 是完整 UUID，无搜索、无过滤、无复制入口。
4. **同一请求链路散落**：`vendor_request_started` / `vendor_request_selected` / `usage_recorded` 等属于同一请求的条目分散在各处，看不到完整链路。
5. **无实时跟随**：只能手动点 Refresh，看不到正在发生的日志。
6. **时间戳/元数据排版难扫读**：完整 `toLocaleString()` 时间 + 等宽 key:value，扫读效率低。

## 期望结果

对 Logs 页面做**完全重构（含日志数据层）**，使其成为可扫读、可检索、可实时跟随的运行时日志视图：

- 高密度、低噪音的列表排版，级别有视觉层级（error/warn 醒目，info 收敛）
- 级别过滤、vendor/model 过滤、时间范围过滤、关键词 / requestId 搜索
- 按 requestId 聚合，同一请求的条目可归组查看完整链路
- 实时跟随：新日志自动出现
- 一键复制 requestId
- 日志文件按日期拆分存放在数据目录下，单文件不无限增长
- **兼容旧格式**：现有单文件 JSONL 日志（`logs/router.log`）重构后仍要能解析展示

## 受影响系统

| 系统 | 影响 |
|---|---|
| `src/logger.ts` | 输出格式 / 写入策略调整（按日期拆分文件、可能新增字段） |
| `src/server.ts` | `router.logFile` 属于 RESTART_REQUIRED_FIELDS，语义变化需评估 |
| `gui/electron/log-store.ts` | 分页读取改为跨多个日期文件读取；可能新增文件监听 |
| `gui/electron/main.ts` | `logs:read` IPC 契约变更；可能新增 IPC（实时推送） |
| `gui/electron/ipc-contracts.ts` | IPC 请求/响应 schema 更新 |
| `gui/src/pages/logs-page.tsx` | 页面整体重做 |
| `gui/src/app-model.ts` | `parseLogRows` / `formatLogTime` 等解析逻辑 |
| `gui/src/types.ts` | `LogEntry` / `LogPage` 类型 |
| `src/config.ts` / `gui/src/config-draft.ts` / `gui/electron/config-store.ts` | `router.logFile` 配置项废弃，固定使用数据目录下 `logs/` 目录 |
| 数据 | 现有 `logs/router.log` 旧文件的兼容读取与（可能的）迁移 |
| 测试 | `test/logger.test.ts`、`test/log-store.test.ts`、`test/fallback-smoke.test.ts`、`test/electron-lifecycle.test.ts` 等 |

## 数据/技术约束

- 日志文件放在用户数据目录（data directory）下固定的 `logs/` 目录，**仅按日期拆分**（`logs/router-YYYY-MM-DD.log`），不叠加按大小轮转
- **自动清理**：历史日志文件默认保留 30 天，超期自动删除
- **性能优先**：尽可能少占用宿主机资源——文件监听/轮询频率、内存中保留的条目数、渲染条目数都要有上限
- **实时跟随**：主进程 `fs.watch` + 防抖推送（空闲零开销），经 IPC 推给渲染进程
- **旧文件兼容**：现有 `logs/router.log` 原样保留，按旧格式解析展示，不迁移
- 兼容旧格式：现有 JSONL 单文件日志重构后仍要能解析展示
- 日志脱敏（api key / token / secret redaction）行为必须保留
- Electron 桌面应用，无后端服务；router 是主进程 spawn 的 Node 子进程，实时跟随通过 IPC 推送实现
- Windows 平台为主，文件监听/文件锁行为需考虑

## 明确不做

- 不做日志的编辑/删除/清空等写操作
- 不实现日志级别配置 UI（沿用 `HEIMDALL_LOG_LEVEL` 环境变量）
- 不保留「打开任意历史日期文件」的独立入口（历史文件通过过滤/分页自然可达）
- Open log / Open config 按钮保留，语义不变（打开当日日志文件 / 打开配置）

## 已确认决策

| 项 | 决策 |
|---|---|
| 拆分粒度 | 仅按日期拆分，不叠加按大小轮转 |
| 保留策略 | 自动清理，默认保留 30 天 |
| 实时跟随机制 | 主进程 `fs.watch` + 防抖推送 |
| 旧文件处理 | `logs/router.log` 原样保留，按旧格式解析，不迁移 |
| 聚合交互 | 默认**平铺**视图；按 requestId 聚合作为可选分组模式 |
| 配置项处理 | `router.logFile` 废弃，固定使用数据目录下 `logs/` 目录 |
