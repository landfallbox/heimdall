# 实施计划：Runtime Logs 页面重构

> 上游产物：[intent.md](./intent.md)（已确认）· [spec.md](./spec.md)（已确认）
> 本文档批准后开始动代码。每个阶段结束必须跑通验证命令才能进入下一阶段。

## 1. 目标与验收标准

按 spec.md 实现：日志按天分文件写入、跨文件游标分页、主进程服务端过滤、fs.watch 实时跟随、requestId 聚合、UI 重设计、`router.logFile` 配置废弃、30 天自动清理、旧 `router.log` 兼容读取。

**验收标准**：
1. `npm run check`、`npm run test`、`npm run test:electron` 全部通过。
2. `npm run gui` 手动验收（见 §5 清单）全部通过。
3. 旧 `logs/router.log` 内容在 UI 中可见；旧配置含 `router.logFile` 时启动不报错、不触发重启。

## 2. 文件改动清单

### 写侧（router 子进程）
| 文件 | 改动 |
|------|------|
| `src/logger.ts` | `createLogger` 改为写 `<runtimeRoot>/logs/` 目录；文件名 `router-YYYY-MM-DD.log`（本地时区）；写入时惰性按日期换文件；保留 `redact` 与 stderr 输出；`logs/` 目录不存在时自动创建；新增可注入的日期源参数（供测试模拟跨天） |
| `src/config.ts` | `configSchema.router`、`NormalizedRouterConfig`、`DEFAULT_CONFIG`、`normalizeConfig` 移除 `logFile`（`z.object` 非 strict，旧配置残留字段自动剥离） |
| `src/server.ts` | `RESTART_REQUIRED_FIELDS` 移除 `"router.logFile"` |

### 读侧（主进程）
| 文件 | 改动 |
|------|------|
| `gui/electron/log-store.ts` | 核心重写：`resolveLogDirectory`（固定 `<dataDir>/logs`）；日志文件清单（`router-YYYY-MM-DD.log` 按日期倒序 + 遗留 `router.log` 最旧）；不透明游标（base64 编码 `{file, offset}`）；`readLogPage(dir, {limit, cursor, filter})` 跨文件分页 + 服务端过滤；新增 `cleanupOldLogs(dir, days)`（只删 `router-*.log` 且日期 < N 天，逐个校验文件名格式） |
| `gui/electron/main.ts` | `logs:read` 处理器改用新 API（limit 仍 clamp 20-500）；`file:openLog` 改为打开当天文件（不存在则创建）；移除 `relocateLogFileInsideDataDir`（1158-1168 行）及其调用；新增 `logs:appended` 推送 + fs.watch 生命周期（随 router 子进程 start/exit 启停，~200ms 防抖，增量读取当天文件新行）；启动时执行一次 `cleanupOldLogs`（30 天） |
| `gui/electron/ipc-contracts.ts` | `logs:read` 契约：请求 `{limit?, cursor?: string|null, level?, vendor?, model?, keyword?, startTime?, endTime?}`，响应 `{dir, lines[], nextCursor: string|null, hasMore}`；新增 `logs:appended` 事件契约（`{lines: string[], ts: number}`） |
| `gui/electron/preload.cjs` | 暴露 `onLogsAppended(callback)`（沿用 `onConfigChanged` 模式） |

### 渲染端
| 文件 | 改动 |
|------|------|
| `gui/src/types.ts` | `LogEntry` 增加 `vendor?`、`statusCode?`、`elapsedMs?`、`totalElapsedMs?`、`requestId?`；`LogPage` → `{dir, lines[], nextCursor, hasMore}`；新增 `LogFilter`、`LogAppendEvent` 类型 |
| `gui/src/app-model.ts` | `parseLogRows` 解析新字段（旧行缺字段时降级）；`formatLogTime` 紧凑化（HH:mm:ss）；新增客户端过滤助手（供 follow 流复用）与 requestId 聚合助手 |
| `gui/src/desktop-api.ts` | `readLogs` 参数改为 cursor + filter；新增 `onLogsAppended` 类型与桥接 |
| `gui/src/mock-desktop-api.ts` | `readLogs`/`openLog` mock 同步新形状（cursor + filter 内存实现）；`onLogsAppended` 空实现 |
| `gui/src/app-controllers.ts` | `useLogsController` 重写：filter 状态（level/vendor/model/keyword/timeRange）、cursor 分页、follow 订阅（Live 开关、暂停缓冲上限 ~500 行、恢复时 flush）、累积行数硬上限 ~1500 行（丢弃最旧）、聚合模式开关 |
| `gui/src/pages/logs-page.tsx` | 整页重写：过滤栏（级别/厂商/模型/时间/关键词）、Live 开关、聚合/平铺切换、行内 requestId 与消息一键复制、空态/错误态；沿用现有页面布局风格 |
| `gui/src/config-draft.ts` | 移除 `logFile`（draft 类型、默认值、解析、序列化，约 6 处） |

### 测试
| 文件 | 改动 |
|------|------|
| `test/logger.test.ts` | 改为断言 `logs/router-YYYY-MM-DD.log` 路径；新增跨天换文件用例（注入日期源）；redact 用例保留 |
| `test/log-store.test.ts` | 重写：跨文件分页、游标往返、legacy `router.log` 排序、各过滤条件、`hasMore`/`nextCursor`、空目录、`cleanupOldLogs` 不误删 |
| `test/ipc-contracts.test.ts` | `logs:read` 新契约 + `logs:appended` 事件契约 |
| `test/electron-lifecycle.test.ts` | 适配（涉及 logFile 的断言改为目录/当天文件） |
| `test/fallback-smoke.test.ts` | 328/563/1074 行等用 `config.router.logFile` 定位日志处，改为读 `<dataDir>/logs/` 当天文件 |
| `test/desktop-api.test.ts` | 12 行 mock 形状改为 `{dir, lines, nextCursor, hasMore}` |
| `test/app-model.test.ts` | 新字段解析、聚合助手、时间格式化用例 |

### 文档
| 文件 | 改动 |
|------|------|
| `README.md` | 122 行 `router.logFile` 重启说明移除；补充日志按天分文件说明 |

## 3. 实施顺序

每阶段独立可验证，阶段内文件按依赖顺序修改。

### 阶段 1：写侧（logger + config + server + config-draft）✅ 已完成
1. `src/logger.ts`：目录 + 日期命名 + 惰性换文件 + 可注入日期源。
2. `src/config.ts`：移除 `logFile` 四处。
3. `src/server.ts`：`RESTART_REQUIRED_FIELDS` 移除一项。
4. `gui/src/config-draft.ts`：移除 `logFile`（必须与 2 同阶段，否则 `npm run check` 渲染端类型报错）。
5. `test/logger.test.ts`、`test/fallback-smoke.test.ts` 适配。

**验证**：`npm run check` + `npm test`。
**退出标准**：router 启动后在 `<dataDir>/logs/` 生成当天文件；旧配置（含 `logFile`）加载不报错。

### 阶段 2：读侧核心（log-store.ts）✅ 已完成
1. 目录解析 + 文件清单（日期倒序 + legacy）。
2. 游标编解码 + 跨文件 `readLogPage`（复用现有"从文件尾向前按字节偏移读 N 行"算法，跨文件续读）。
3. 服务端过滤（level/vendor/model/keyword/startTime/endTime，过滤在解析行时应用，limit 按命中计数）。
4. `cleanupOldLogs`。
5. `test/log-store.test.ts` 重写。

**验证**：`npm run check` + `npm test`。
**退出标准**：跨文件分页、游标往返、过滤、清理用例全绿。

### 阶段 3：IPC + 主进程（contracts + main + preload）✅ 已完成
1. `ipc-contracts.ts` 新契约 + `logs:appended` 事件。
2. `main.ts`：`logs:read` 处理器改造；`file:openLog` 改当天文件；移除 `relocateLogFileInsideDataDir`；fs.watch 生命周期（挂接点：`trackManagedRouterChild` 663 行启动、`child.once("exit")` 738 行与 `stopManagedRouterChild` 862 行停止、`startRouterForBackgroundStartup` 1266 行启动）；启动清理。
3. `preload.cjs`：`onLogsAppended`。
4. `test/ipc-contracts.test.ts`、`test/electron-lifecycle.test.ts` 适配。

**验证**：`npm run check` + `npm test` + `npm run test:electron`。
**退出标准**：契约测试全绿；router 启停不泄漏 watcher（lifecycle 测试覆盖）。

### 阶段 4：渲染端（types → app-model → desktop-api → mock → controller → page）✅ 已完成
1. `types.ts`：`LogEntry`/`LogPage`/`LogFilter`/`LogAppendEvent`。
2. `app-model.ts`：解析新字段、聚合助手、时间格式化。
3. `desktop-api.ts` + `mock-desktop-api.ts`：API 形状同步。
4. `app-controllers.ts`：`useLogsController` 重写（filter/cursor/follow/硬上限/聚合）。
5. `logs-page.tsx`：整页重写。
6. `test/app-model.test.ts`、`test/desktop-api.test.ts` 适配。

**验证**：`npm run check` + `npm test`。
**退出标准**：类型检查全绿；app-model 用例全绿。

### 阶段 5：集成验证 + 文档 ✅ 自动化部分已完成
1. `README.md` 更新。✅
2. 全量验证（§5）。✅ `npm run check` + `npm run test:ci` 全绿。
3. `npm run gui` 手动验收。⏳ 待执行（清单见下方）。

## 4. 影响面与可能破坏点

| 破坏点 | 说明 | 缓解 |
|--------|------|------|
| `logs:read` 契约破坏性变更 | `before: number` → `cursor: string`，`path` → `dir` | 主进程与渲染端同 PR 内同步改；ipc-contracts.test.ts 兜底 |
| 跨文件游标正确性 | 游标编码"文件名 + 字节偏移"，文件被清理后游标失效 | 游标指向的文件不存在时回退到"从该日期位置继续"或重置到最新文件；测试覆盖 |
| fs.watch 生命周期（Windows） | router 反复启停可能泄漏 watcher 或重复推送 | watcher 句柄与子进程实例绑定，exit/stop 双路径关闭；防抖合并；lifecycle 测试覆盖 |
| `config.router.logFile` 移除 | 旧配置残留字段、fallback-smoke 测试依赖该字段定位文件 | `z.object` 非 strict 自动剥离；fallback-smoke 改读当天文件；README 同步 |
| `file:openLog` 行为变化 | 原来打开 `logFile` 配置指向的文件，现在打开当天文件 | 当天文件不存在时先创建空文件再打开（沿用 `ensureLogFile` 思路） |
| 渲染端累积模型变化 | `before` 数字游标 → 字符串游标；新增 follow 流与硬上限 | controller 全量重写，mock 同步；app-model 测试兜底 |
| 旧 `router.log` 混排 | 旧文件行可能缺新字段（vendor/requestId 等） | `parseLogRows` 对缺字段降级（显示 "—"），不报错 |
| 清理误删 | `cleanupOldLogs` 若 glob 过宽可能删坏文件 | 只匹配 `^router-\d{4}-\d{2}-\d{2}\.log$` 且日期 < 30 天；`router.log` 永不匹配；测试覆盖 |

## 5. 测试与验证

### 自动化
```powershell
npm run check        # tsc --noEmit + preload.cjs 等 node --check
npm run test         # 全部 test/*.test.ts（含 logger/log-store/ipc-contracts/app-model/fallback-smoke/desktop-api）
npm run test:electron # electron-lifecycle.test.ts
npm run test:ci      # 等价于 test + test:electron，最终跑一次
```

### 手动验收（`npm run gui`）
- [ ] 启动后 `<dataDir>/logs/` 生成 `router-<今天>.log`，router 事件实时写入。
- [ ] 日志页：新行实时出现在底部并自动跟随滚动；向上翻看时停止自动滚动，右下角出现「N new」按钮，点击跳回最新；滚回底部恢复跟随；行数多时不卡顿（硬上限生效）。
- [ ] 过滤：级别/厂商/模型/时间范围/关键词各自与组合均生效；"加载更多"跨天文件续读。
- [x] 聚合：已按评审拍板移除（requestId 仍行内展示 + 点击复制）。
- [ ] 一键复制：requestId 与消息复制成功。
- [ ] 旧数据：把一份旧 `router.log` 放进 `logs/`，UI 能读到其内容（作为最旧来源）。
- [ ] 旧配置：config.json 手工加回 `"router": {"logFile": "x.log"}`，启动不报错、不提示重启、日志仍写当天文件。
- [ ] 清理：手工造一个 40 天前的 `router-2026-01-01.log`，重启后消失；`router.log` 不受影响。
- [ ] "打开日志文件"按钮打开当天文件。
- [ ] 修改 router.host/port 保存仍提示重启；logFile 相关重启提示消失。

## 6. 风险与备选方案

| 风险 | 等级 | 备选方案 |
|------|------|----------|
| **跨文件游标分页**（最复杂）：字节偏移游标在"文件被清理/手动删除/跨天新文件插入"场景下语义漂移 | 高 | 备选 A：游标改为"文件名 + 行内从尾偏移"，文件缺失即重置到最新并提示；备选 B：放弃跨文件游标，"加载更多"改为按文件粒度整页加载（实现更简单，但页大小不均）。默认按主方案实现，若测试暴露难缠边界再降级到 A |
| **fs.watch 在 Windows 的可靠性**：目录 watch 偶发漏事件 | 中 | 防抖增量读取本身是"读文件尾 vs 上次偏移"，漏事件只导致延迟一个防抖周期；可再加 2s 定时轮询兜底（默认关，问题复现时开启） |
| **fallback-smoke 是端到端冒烟**，改动面大（多处读 logFile） | 中 | 若当天文件定位在测试环境（时区/日期边界）不稳定，测试内用 `dateProvider` 同款注入固定日期 |
| **config 移除 logFile 的兼容** | 低 | `z.object` 非 strict 已确认自动剥离；若发现 `normalizeConfig` 有显式读取残留，加一行 fallback 到默认值即可 |

## 7. 明确不做（对齐 intent.md 非目标）

- 不做日志级别/格式语义变更（事件名、data 字段不动）。
- 不做日志导出/分享。
- 不做多 router 实例日志合并。
- 不做按大小轮转、压缩归档。
- 不动 usage 统计、config-store 的其它逻辑。
