# AGENTS.md

Heimdall 是本地 OpenAI 兼容模型路由器：在多个上游供应商前提供一个稳定的本地端点，处理供应商优先级、故障转移和按供应商+模型隔离的熔断。Electron GUI 负责配置、状态、用量、日志和托盘控制。

## 技术栈

- Node.js >= 22.18（ESM），TypeScript；Router 是纯 Node HTTP 服务（`src/`）
- Electron 主进程 + React 18 + Tailwind v4 + shadcn/ui（`gui/`）
- 测试为原生 Node 测试文件（`test/`），无测试框架

## 架构规则（违反即缺陷）

- 持久化配置归一化放 `src/config.ts`；仅表单的转换放 `gui/src/config-draft.ts`。
- 桌面端配置写入必须走 `gui/electron/config-store.ts`，保留 revision 校验（SHA-256）与原子替换（同目录临时文件 + `sync` + `rename`）。
- Router 进程所有权归 Electron 主进程；桌面启动的 Router 必须挂在 Electron 下、用父子 IPC 优雅退出，禁止 `detached` 或 `unref()`。
- PID 元数据和 Router 实例身份是异常退出恢复数据；终止恢复的 PID 前必须匹配 Router 实例身份，不能只查 PID。
- 下游响应提交是 failover 边界：响应头或 body 字节到达客户端后，禁止再重试其他供应商。
- 特权 renderer 操作必须通过 `gui/electron/main.ts` 的 guarded IPC helper 注册；IPC 请求和返回值都做 schema 校验。

## 验证命令

```powershell
npm run check        # tsc --noEmit + 各脚本语法检查
npm test             # 快速 Node 测试（Router 行为、配置、协议、熔断等）
npm run test:electron  # Electron 真机生命周期测试
npm run gui:build    # GUI 构建
```

行为变更必须加/改 `test/` 下的测试；Electron 生命周期行为放 `test/electron-lifecycle.test.ts`。

## 其他文档

- 贡献流程、PR 要求、密钥管理：`CONTRIBUTING.md`
- 安全漏洞报告：`SECURITY.md`
- 代码结构与行为说明：`README.md`、`docs/`
