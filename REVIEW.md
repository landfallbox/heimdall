# REVIEW.md

本文件告诉代码审查者（人或 agent）：在这个仓库里，失败长什么样。审查以发现真实缺陷为目标，不是风格点评。

## 什么算失败（按严重度排序）

1. **failover 边界被破坏**：响应头或 body 字节已发给客户端后仍切换供应商；或该回退（可重试状态码、等待响应头超时、熔断内）时没回退；或不该回退（4xx 客户端错误、配置问题）时回退了。
2. **敏感信息泄漏**：API key、Authorization 头、上游响应体出现在日志、错误信息或 IPC 返回值中。
3. **配置一致性破坏**：绕过 `gui/electron/config-store.ts` 直接写配置；丢失 revision 校验或原子替换（同目录临时文件 + `sync` + `rename`）；无效配置破坏最后一份有效配置。
4. **进程身份误判**：终止 Router 前未匹配实例身份、只查 PID；引入 `detached`/`unref()` 破坏父子进程生命周期。
5. **IPC 契约破坏**：特权操作未走 `gui/electron/main.ts` 的 guarded helper；请求或返回值缺 schema 校验。
6. **熔断语义破坏**：状态未按"供应商+模型"隔离；Half-open 放行多个探针；热加载重建熔断器语义错误。

## 审查规则

- 每条发现必须给出**文件和行号**作为证据；不能只凭函数名或文件名猜测。
- 风格、命名、诊断信息、清理类意见最多 2 条，且不得与上述缺陷混排。
- 以下路径默认跳过，除非 diff 明确触碰：`src/pricing-data.ts`（生成文件）、`gui/dist/`、`build/`、图标与静态资源。
- 摘要以数量开头（如"2 个 Important，1 个 Nit"）；没有可修的就明说"没有发现"，不要凑数。
- 区分"本 PR 引入"和"既有问题"；既有问题单独标注，不算作者的缺陷。

## 风险分级（按变更定级，不按作者）

| 级别 | 典型范围 | 合并前要求 |
| --- | --- | --- |
| 低 | 文档、`data/pricing.json`、GUI 样式/文案 | CI + AI 审查绿即可合并 |
| 中 | `src/server.ts`、协议转换、配置逻辑（`src/config.ts`） | 人读 diff + 测试证据（`npm test` 输出） |
| 高 | `gui/electron/config-store.ts`、`gui/electron/updater.ts`、鉴权、`.github/workflows/ci.yml`、`release.yml` | 人深审 + 手动测打包版（`npm run test:electron` + 安装一次） |

拿不准级别时按更高一级处理。
