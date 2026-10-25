# 价格表自动刷新（pricing auto-refresh）

- 日期：2026-10-24
- 档位：单个功能点（轻量版，intent/spec 合并入本文件）

## 1. 背景与问题

`data/pricing.json` 是模型价格的唯一事实来源，运行时已全自动同步（24h 拉 main 分支 + 内置兜底）。痛点在**仓库侧保鲜**：厂商改价/改名（如 DeepSeek `deepseek-v4-flash` → `deepseek-flash`、新发 `gemini-4-argon`、`kimi-k3.1-pro`）都需要人工盯官方页面、手改 JSON、重新生成 `src/pricing-data.ts`，容易漏、更新慢。

## 2. 目标 / 非目标

**目标**
- 一条命令 `npm run pricing:refresh` 自动抓取官方定价页 → 解析 → 更新 `data/pricing.json` → 重新生成 `src/pricing-data.ts`。
- 阶段二：GitHub Actions 每日定时跑，有变化时自动开 PR（人工在 PR 上审核合入，**不自动合并**）。
- 覆盖 11 个厂商：现有 7 家（`deepseek`、`google`、`kimi`、`openai`、`anthropic`、`glm`、`mimo`）+ 新增 4 家（`minimax`、`xai`、`stepfun`、`qwen`）。
- 价格 schema 扩展支持**阶梯计价**（qwen 按上下文长度分档，与 deepseek 峰谷价同类），含运行时按 token 数选档与 GUI 展示。

**非目标（本期不做）**
- 自动合并 PR、价格历史追踪、告警通知。
- 豆包（volcengine）：文档为纯 JS SPA，无 markdown 端点、无 llms.txt、无可用内容 API，本期保持手动维护，待找到数据源再纳入。
- 运行时改动仅限阶梯计价 schema + GUI 展示（见 3.3），其余运行时行为不变。

## 3. 方案设计

### 3.1 架构

```
scripts/pricing-refresh/
  refresh-pricing.mjs        # CLI 入口：fetch → parse → diff → write → regenerate
  lib.mjs                    # 公共：fetch（超时/UA）、diff、写 JSON、bump updatedAt、报告
  parsers/
    deepseek.mjs             # 服务端渲染 HTML，两张表（峰时/非峰时）→ RateCard
    google.mjs               # devsite 服务端渲染，注意限时价（"through X / starting Y" 取当前价）
    kimi.mjs                 # 客户端渲染，价格行嵌在 HTML 的 RSC payload 里（反引号字符串）
    openai.mjs               # 服务端渲染 HTML（16 张表），取标准 API 价（非 batch）
    anthropic.mjs            # 服务端渲染 HTML（13 张表），注意多模型族表格
    glm.mjs                  # .md 端点直接返回 Markdown 管道表格，最易解析
    mimo.mjs                 # 静态 markdown 端点（内嵌 HTML 表格），只取 Real-time API 段
    minimax.mjs              # 服务端渲染 HTML（24 张表），CNY
    xai.mjs                  # 服务端渲染 HTML（11 张表），USD
    stepfun.mjs              # 服务端渲染 HTML（7 张表，结构干净），CNY
    qwen.mjs                 # 服务端渲染 HTML（大页面 526 张表），阶梯计价 → TieredPricing
```

每个 parser 导出 `async parse(content: string): Promise<{ models, warnings }>`，返回与 `data/pricing.json` 同构的条目（`Pricing`、`{peak, offPeak}` RateCard 或 `{tiers}` TieredPricing，见 3.3）。

**各厂商数据源形态（已探测确认）**

| 厂商 | 数据源 | 形态 | 币种 |
|---|---|---|---|
| deepseek | `api-docs.deepseek.com/quick_start/pricing` | 服务端 HTML，2 张表 | CNY（峰/非峰） |
| google | `ai.google.dev/gemini-api/docs/pricing` | 服务端 HTML，devsite 表格 | USD |
| kimi | `platform.kimi.ai/docs/pricing/chat` | 客户端渲染，价格行嵌 RSC payload | USD |
| openai | `developers.openai.com/api/docs/pricing` | 服务端 HTML，16 张表 | USD |
| anthropic | `platform.claude.com/docs/en/about-claude/pricing` | 服务端 HTML，13 张表 | USD |
| glm | `docs.bigmodel.cn/cn/guide/start/pricing.md` | 纯 Markdown 管道表格 | CNY |
| mimo | `mimo.mi.com/static/docs/price/pay-as-you-go.md` | 静态 markdown 内嵌 HTML 表格 | CNY |
| minimax | `platform.minimaxi.com/document/pricing` | 服务端渲染 HTML，24 张表 | CNY |
| xai | `docs.x.ai/docs/pricing` | 服务端渲染 HTML，11 张表 | USD |
| stepfun | `platform.stepfun.com/docs/zh/guides/pricing/details` | 服务端渲染 HTML，7 张表（Model ID/输入未命中/输入命中/输出） | CNY |
| qwen | `help.aliyun.com/zh/model-studio/model-pricing` | 服务端渲染 HTML，1.3MB/526 张表，含地域列与阶梯计价 | CNY |

### 3.2 关键决策

| 决策点 | 选择 | 理由 |
|---|---|---|
| 合并语义 | **只增改、不删除**；官方页已下架的模型保留在 JSON，但写入报告警告 | 保留既定"旧条目保留"策略（`deepseek-v4-flash`）；删除由人在 PR 里决定 |
| 解析失败策略 | 单厂商解析 0 个模型、或模型数骤降 >50% → **该厂商整体放弃并报错**，不写半份数据 | 页面改版时宁缺毋滥 |
| 限时价 | Google 页 "$2.00 through 2026-11-30 / $4.00 starting 2026-12-01" → 解析**当前生效价**，报告里附注下次调价日期 | 与人工维护口径一致 |
| qwen 阶梯价 | 解析为 `TieredPricing`（见 3.3）；成本计算按请求实际 `inputTokens` 选档；GUI 展示全部分档 | 与 deepseek 峰谷价同类问题，选档依据是上下文长度而非时间 |
| qwen 解析口径 | 取"中国"地域、非思考模式输出价（当前页思考/非思考同价）；限时折扣取折后（当前生效）价；上下文缓存无固定单价 → `cachedInputPerMillion: null` | 避免把 batch/地域变体带进 JSON |
| `updatedAt` | 目录内容变化 → bump 该目录 `updatedAt`；任一目录变化 → bump 顶层 `updatedAt` | 顶层是运行时缓存失效闸门，必须联动 |
| 测试 | parser 对**存档 HTML fixture** 跑单测（`test/fixtures/pricing/`），测试不触网 | 可重复、离线、能锁住页面改版回归 |
| CLI | `--only deepseek,google,kimi`（默认全部已适配厂商）、`--dry-run`（只报告不写）、`--commit`（CI 用：提交+推分支+`gh pr create`） | 本地调试与 CI 复用同一套代码 |

### 3.3 阶梯计价 schema 扩展（qwen）

qwen 按输入上下文长度分档计价（如 `qwen3.7-plus`：0<Token≤256K 输入 2 元/输出 8 元；256K<Token≤1M 输入 6 元/输出 24 元）。**展示导向设计**：`tiers` 供 GUI 完整展示所有分档，成本计算用顶层 `pricing`（基准档），不做按请求 token 数选档。

> 类型与 GUI 展示已在 main 分支实现并迁移到本 worktree（`usage.ts` 的 `PricingTier`/`CatalogPriceView.tiers`、`vendor-editor-page.tsx` 的 `PricingRulesMatrix` 组件 + 峰谷/阶梯徽章 + 当前时段状态）。

`src/usage.ts` 类型（已实现）：

```ts
export interface PricingTier {
  condition: string;              // 档位标签，如 "0<Token≤256K"
  note?: string;                  // 计费说明
  inputPerMillion: number;
  cachedInputPerMillion?: number | null;
  outputPerMillion: number;
  isBase?: boolean;               // 起步基准档标记
}
// CatalogPriceView 增加 tiers?: PricingTier[] | null
```

`data/pricing.json` 条目形态（顶层 `pricing` 为基准档价格 + `tiers` 展示数组）：

```json
"qwen3.7-plus": {
  "pricing": { "currency": "CNY", "inputPerMillion": 2, "cachedInputPerMillion": null, "outputPerMillion": 8 },
  "tiers": [
    { "condition": "0<Token≤256K", "isBase": true, "inputPerMillion": 2, "cachedInputPerMillion": null, "outputPerMillion": 8 },
    { "condition": "256K<Token≤1M", "inputPerMillion": 6, "cachedInputPerMillion": null, "outputPerMillion": 24 }
  ]
}
```

剩余联动点：
- **成本计算**：`getCatalogPriceView` 已处理（`entry.pricing ?? entry`）；`resolveCatalogPricing` 对含 `pricing` 字段的条目需确认取顶层 `pricing`（基准档）——长上下文请求按基准档计价为已知简化，报告/PR 说明即可。
- **zod 校验**：`pricing-updater.ts` 的 models 值联合类型需加 `tieredSchema`（`{ pricing, tiers }` 形态），否则运行时拉取远端数据时会整包拒收 qwen 条目。**必做**。
- **生成器**：`generate-pricing-data.mjs` 确认对 `{pricing, tiers}` 条目原样透传。
- **qwen parser**：输出上述 `{pricing, tiers}` 形态；`condition` 文案直接取页面分档标签。

### 3.4 阶段二：GitHub Actions

`.github/workflows/pricing-refresh.yml`：
- cron 每日 12:00 UTC（北京 20:00）+ `workflow_dispatch` 手动触发。
- `permissions: contents: write, pull-requests: write`，Node 24，`npm ci`。
- 跑 `refresh-pricing --commit`：无变化 → 静默退出；有变化 → 分支 `pricing-refresh-YYYYMMDD` 提交并开 PR，PR body 附 diff 摘要与警告（如"官方页已下架 X 模型，当前保留"）。
- 与现有 CI 风格一致（`shell: pwsh`、setup-node cache）。

## 4. 改动文件与实现顺序

| # | 文件 | 动作 | 说明 |
|---|---|---|---|
| 1 | `src/usage.ts` | 修改 | 类型与 `getCatalogPriceView` tiers **已迁移**（main 分支实现）；剩 `PricingCatalogKey`/`PRICING_CATALOG_LABELS` +4、`resolveCatalogPricing` 确认取顶层 pricing |
| 2 | `src/pricing-updater.ts` | 修改 | zod 联合加 `tieredSchema`（`{pricing, tiers}` 形态） |
| 3 | `gui/src/pages/vendor-editor-page.tsx` | 修改 | `PricingRulesMatrix` + 徽章 **已迁移**（main 分支实现） |
| 4 | `test/usage.test.ts` | 修改 | tiers 展示/基准档解析单测 |
| 5 | `scripts/generate-pricing-data.mjs` | 修改 | `EXPECTED_CATALOG_KEYS` +4（minimax/xai/stepfun/qwen） |
| 6 | `data/pricing.json` | 修改 | mimo `sourceUrl` 修正；新增 4 个目录（初始条目人工核对官方页） |
| 7 | `src/pricing-data.ts` | 重新生成 | `npm run pricing:generate` |
| 8 | `scripts/pricing-refresh/lib.mjs` | 新增 | fetch/diff/write/bump/报告 |
| 9 | `scripts/pricing-refresh/refresh-pricing.mjs` | 新增 | CLI 骨架（含 fixture 模式 `--from-file`） |
| 10 | `scripts/pricing-refresh/parsers/*.mjs`（11 个） | 新增 | deepseek/google/kimi/openai/anthropic/glm/mimo/minimax/xai/stepfun/qwen |
| 11 | `test/fixtures/pricing/*.html` + `glm.md`（11 份） | 新增 | 当前官方页存档 |
| 12 | `test/pricing-refresh.test.ts` | 新增 | parser 单测 + diff/合并语义测试 |
| 13 | `package.json` | 修改 | 加 `pricing:refresh` 脚本 |
| 14 | `.github/workflows/pricing-refresh.yml` | 新增 | 阶段二 |

顺序：迁移的阶梯展示改动先单独提交（提交 0）→ 2-4 zod/单测 + 5-7 新增目录（提交 1）→ 8-9 骨架跑通（fixture 模式）→ 10 逐个 parser（每完成一个用真实页面 dry-run 验证一次）→ 11-13 测试 + 本地真实 dry-run 全链路 → **提交阶段一（提交 2）** → 14 工作流 + `--commit` 路径 → 本地模拟 CI 跑一遍 → 提交阶段二（提交 3）。

## 5. 影响面

- **仓库侧工具（纯增量）**：新脚本、新测试、新工作流。
- **运行时（仅限阶梯计价）**：`usage.ts` / `pricing-updater.ts` / GUI 展示。`Pricing` / `RateCard` 行为不变，现有厂商不受影响；唯一运行时行为变化是 qwen 模型成本计算按 inputTokens 选档。
- **目录扩展**：`data/pricing.json` 新增 4 个顶层目录 + 目录 key 枚举的三处（`generate-pricing-data.mjs`、`usage.ts`、GUI 下拉因数据驱动自动更新）。
- `data/pricing.json` / `src/pricing-data.ts` 仅在价格真实变化时被脚本改写（本次刚更新过，预期 dry-run 为"无变化"——这本身就是端到端校验）。
- 工作流失败不影响现有 CI/发布。

## 6. 测试与验证

1. `test/usage.test.ts`（补充）：`TieredPricing` 选档（inputTokens 低于/高于档位边界、无 usage 回退第一档）、`getCatalogPriceView` 返回 tiers。
2. `test/pricing-refresh.test.ts`：11 个 parser 对 fixture 解析出正确价格；合并语义（增/改/保留下架模型/警告）；`updatedAt` bump 规则；模型数骤降熔断。
3. `npm run pricing:refresh -- --dry-run`（真实网络，默认 11 家）：预期 11 个目录均"无变化"。
4. `npm run check` + `npm test` + GUI 构建全绿。
5. 阶段二：`workflow_dispatch` 手动触发一次，验证"无变化静默退出"；再临时改 fixture 造一个差异验证 PR 创建路径（本地 `gh` 模拟或 staging 分支）。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 官方页面改版导致 parser 失效 | 熔断（0 模型/骤降）+ 测试锁 fixture + 工作流失败日志明确指向 parser |
| 页面价格格式特殊（限时价、多币种、缓存写入价） | parser 只取"标准输入/缓存命中/输出"三项；其余进 warnings 供人判断 |
| 抓取被风控/限流 | 每日一次频率极低；fetch 带正常 UA 与超时；失败不写数据 |
| 自动 PR 噪音 | 无变化不开 PR；PR 标题带厂商清单 |

## 8. 提交规划

- 提交 0（已迁移待提交）：`feat(gui): 价格来源展示峰谷/阶梯计价明细矩阵`——main 分支迁移的 `usage.ts` + `vendor-editor-page.tsx`
- 提交 1：`feat(pricing): 定价数据支持阶梯条目校验与四个新目录（minimax/xai/stepfun/qwen）`——文件 1-7
- 提交 2（阶段一）：`feat(pricing): 新增价格表自动刷新脚本（11 家）`——文件 8-13
- 提交 3（阶段二）：`ci(pricing): 每日定时刷新价格表并自动开 PR`——文件 14
