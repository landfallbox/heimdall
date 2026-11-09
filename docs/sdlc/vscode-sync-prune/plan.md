# VS Code 同步「模型级完全同步」— 计划

> 轻量档：单一功能点，核心改动集中在 `src/vscode-sync.ts` 的合并逻辑。
> 演进记录：初版方案为「`heimdall: true` 标记 + 自动清理 + url 迁移」。
> 用户指出：Heimdall provider 的请求全部经 Heimdall router，不存在
> "router 里没有但 VS Code Heimdall provider 里有"的合法手动模型，
> 标记是为不存在的场景做的防御。故简化为**模型级完全同步**。

## 问题

VS Code 同步（"Sync now" 按钮 + 保存时自动同步）当前是**只增不删**的合并策略
（[vscode-sync.ts](../../../src/vscode-sync.ts) `mergeVsCodeModelsFile`）：

- 在 Heimdall 里被禁用或删除的模型会永远留在 VS Code `chatLanguageModels.json`
  的 Heimdall provider 里，使用时间越长无用模型越多。

## 方案：模型级完全同步

对 Heimdall provider 的 `models` 数组做**整体替换**：每次同步用当前配置中
"所有已启用 vendor 的已启用模型"重建 `models` 数组，不再与文件里已有条目对账。

### 保留的行为（不变）

- 其他 provider（VS Code 自带的 Copilot 等）原样保留，不触碰。
- Heimdall provider 不存在时创建（`vendor: customendpoint`、`apiType: chat-completions`）。
- provider 级 `apiKey` 写 router key，但**绝不覆盖** `${input:...}` 密钥引用。
- 文件不存在时创建；原子写入（临时文件 + `fsync` + `rename`）。
- 只写用户实际填写过的元数据（name / toolCalling / vision / thinking /
  contextWindow / maxOutputTokens / supportsReasoningEffort）。

### 行为变化

- Heimdall provider 内被禁用/删除的模型在下次同步时从文件移除
  （VS Code 不热加载该文件，需 reload 窗口后生效，toast 提示）。
- 手动加进 Heimdall provider 的模型会被移除（已确认可接受：此类模型
  请求经 router 路由必然失败，不是真实使用场景）。

### 结果反馈

`VsCodeSyncResult` 增加 `removedCount: number`（本次从 Heimdall provider
移除的条目数）。toast（[App.tsx](../../../gui/src/App.tsx) `vsCodeSyncToast`）：

- `removedCount === 0`：`Synced N models to VS Code.`（现有文案）
- `removedCount > 0`：`Synced N models to VS Code. Removed M stale models (visible after reloading VS Code windows).`

## 改动文件

| 文件 | 改动 |
|------|------|
| `src/vscode-sync.ts` | `mergeVsCodeModelsFile`：Heimdall provider 的 `models` 改为整体替换为本次 entries，并统计被移除数量（替换前数组中不在本次 entries 的条目数）；返回值加 `removedCount`；`VsCodeSyncResult` 加 `removedCount`；`syncVsCodeModels` 透传 |
| `test/vscode-sync.test.ts` | 调整"只增不删"相关用例为"完全同步"语义：禁用模型被移除、手动条目被移除、其他 provider 保留、密钥引用不覆盖、`removedCount` 计数 |
| `gui/electron/ipc-contracts.ts` | `vscodeSyncResultSchema` 加 `removedCount`（`.loose()` schema，主进程返回即可） |
| `gui/src/desktop-api.ts` | `VsCodeSyncResult` 接口加 `removedCount` |
| `gui/src/App.tsx` | `vsCodeSyncToast` 处理 `removedCount` 文案 |
| `gui/src/pages/application-page.tsx` | "Sync models to VS Code" 描述文案改为"每次保存/同步时，将启用模型完整同步到 VS Code（禁用/删除的模型会被移除），不触碰其他 provider 与 VS Code 密钥" |
| `gui/src/mock-desktop-api.ts` | mock 的 `vscodeSync()` 返回 `removedCount: 0` |

## 实现顺序

1. `src/vscode-sync.ts`：合并逻辑改为完全同步 + `removedCount`。
2. `test/vscode-sync.test.ts`：改/补测试并跑通。
3. 类型与 IPC：`ipc-contracts.ts`、`desktop-api.ts`、`mock-desktop-api.ts`。
4. UI：`App.tsx` toast、`application-page.tsx` 文案。
5. 全量测试 + 类型检查/构建验证。

## 影响面

- 行为变化：Heimdall provider 的 `models` 数组每次同步后与配置完全一致。
- 不改动：router、config schema、IPC 通道名、同步触发时机、其他 provider。
- 兼容性：升级后第一次同步即自动清掉历史残留，无需迁移逻辑。

## 验证

- `npm test`（重点 `test/vscode-sync.test.ts`）。
- 类型检查/构建（以 package.json 实际脚本为准）。
