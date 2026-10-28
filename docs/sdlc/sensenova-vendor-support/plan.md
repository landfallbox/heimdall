# 新增 SenseNova（商汤日日新）厂商支持 — Plan

> 依据用户确认的范围：价格目录（pricing）+ VS Code 模型信息（model-info），覆盖全部 8 个按 token 计费的付费模型，外加用户指定纳入的免费 Preview 模型 `sensenova-6.8-flash-lite`（共 9 个），规格字段尽力而为（best-effort）。计划批准前不修改任何代码。

## 背景与范围

- 新增第 11 个定价厂商 `sensenova`（现有 10 家：openai / deepseek / anthropic / google / kimi / glm / mimo / minimax / stepfun / qwen）。
- 数据来源：官方价格页 `https://www.sensecore.cn/help/docs/model-as-a-service/nova/pricing`（**公开**、服务端渲染，5 张可解析的 HTML 表格；已抓取存档于 `tmp/sensenova-pricing.html`，并与线上 `www.sensecore.cn` 重新抓取逐表比对一致）。
  - 注意：`console.sensecore.cn` 下的同路径需登录（SPA），**不可用作 sourceUrl**；必须用 `www.sensecore.cn` 公开域名，否则自动刷新会失败。
- 官方页价格单位为 **元/千tokens**，而本项目目录统一为 **每百万 tokens**，因此 parser 需 **×1000** 换算。已验证全部换算结果浮点精确（0.003→3、0.0015→1.5、0.0045→4.5、0.004→4、0.016→16、0.01→10、0.06→60、0.015→15、0.012→12），无需额外舍入。
- **有意排除**（非 token 计费，parser 天然跳过）：
  - `SenseNova-V6-Omni`：0.2 元/分钟（按分钟）
  - `SenseNova-Audio-Fusion-0603`：3.5 元/万字符（按字符）
  - `nova-tts-1`：限时免费体验（免费）
- **SenseNova 6.8 Flash Lite Preview**：当前为 Preview 版、限时免费，发布在 SenseNova Token Plan 平台，console.sensecore.cn 价格页不列出它。**按用户决定**：进目录，价格记 0/0（免费），并加入测试 `KNOWN_RETIRED` 排除集（页面不列出 → round-trip 跳过）。

### 纳入的 9 个模型（目录键一律小写）

| 目录键 | 输入 元/M | 输出 元/M | 说明 |
|---|---|---|---|
| `sensenova-v6.5-pro` | 3 | 9 | |
| `sensenova-v6.5-turbo` | 1.5 | 4.5 | |
| `sensenova-v6-pro` | 3 | 9 | |
| `sensenova-v6-turbo` | 1.5 | 4.5 | |
| `sensenova-v6-reasoner` | 4 | 16 | |
| `sensechat-vision` | 10 | 60 | 视觉模型 |
| `sensechat-character-pro` | 15 | 15 | 角色对话，输入输出同价 |
| `sensechat-character` | 12 | 12 | 角色对话，输入输出同价 |
| `sensenova-6.8-flash-lite` | 0 | 0 | 免费 Preview，手写条目，页面不列出 |

8 个付费模型无缓存价格 → `cachedInputPerMillion: null`；6.8 Flash Lite 显式记 `0`（免费，非未知）。

### 关键设计决策

1. **目录键全小写**：`findCatalogPriceModel`（`src/usage.ts`）对 `user_id` 做 `trim().toLowerCase()` 后精确匹配，键必须全小写。parser 捕获模型名后 `.toLowerCase()`。（minimax 现存的大小写混合键是历史遗留问题，不复制该缺陷。）
2. **parser 判别条件**：只处理价格单元格含 `元/千tokens` 的行，天然排除按分钟/按字符/免费行。5 列行（服务|计费项|单价|计费项|单价）→ input=row[2]、output=row[4]；3 列单价格行（服务|计费项|单价）→ input=output=row[2]。
3. **模型名提取**：`/^(SenseNova|SenseChat)[\w.\-]+/` 匹配单元格文本（如 "SenseNova-V6.5-Pro模型调用" → "SenseNova-V6.5-Pro"）。
4. **model-info 不接入自动刷新**：`scripts/model-info-refresh/refresh-model-info.mjs` 的 `VENDORS` 不加 sensenova（无可抓取的规格页）；`mergeModelInfo` 只增改不删除，手写条目会永久保留。

## 实现顺序

### Step 1 — `src/usage.ts`：类型与标签

- `PricingCatalogKey` 联合类型（line 80）追加 `| "sensenova"`：

```ts
export type PricingCatalogKey = "openai" | "deepseek" | "anthropic" | "google" | "kimi" | "glm" | "mimo" | "minimax" | "stepfun" | "qwen" | "sensenova";
```

- `PRICING_CATALOG_LABELS`（line 82-93）追加 `sensenova: "SenseNova"`（`PRICING_CATALOG_KEYS` 由 `Object.keys` 自动派生，无需改）。

### Step 2 — `scripts/generate-pricing-data.mjs`：白名单

line 16 `EXPECTED_CATALOG_KEYS` 追加 `"sensenova"`（必须与 `PRICING_CATALOG_KEYS` 一致，否则 generator 退出码 1）。

### Step 3 — 新建 `scripts/pricing-refresh/parsers/sensenova.mjs`

以 `parsers/minimax.mjs` 为模板（CNY HTML 表格 parser），完整代码：

```js
// Parser for https://www.sensecore.cn/help/docs/model-as-a-service/nova/pricing
// (server-rendered Docusaurus HTML).
//
// Token-priced models live in HTML tables whose price cells contain
// "元/千tokens" (CNY per 1k tokens). Two row layouts appear:
//   服务 | 计费项 | 单价 | 计费项 | 单价   (5 cols: input=row[2], output=row[4])
//   服务 | 计费项 | 单价           (3 cols: single price, input = output = row[2])
// Prices are per 1k tokens and are converted to per-million (×1000).
// Rows priced per minute (元/分钟), per 10k characters (元/万字符), or free
// (限时免费) don't match the discriminator and are skipped by design.
import { parsePrice, splitCells, splitRows, splitTables } from "../lib.mjs";

const TOKEN_PRICE = /元\/千tokens/;

export async function parse(content) {
  const models = {};
  const seen = new Set();

  for (const table of splitTables(content)) {
    for (const row of splitRows(table).map(splitCells)) {
      const idMatch = /^(SenseNova|SenseChat)[\w.\-]+/.exec(row[0]?.text ?? "");
      if (!idMatch) continue;
      const id = idMatch[0].toLowerCase();
      if (seen.has(id)) continue;
      if (!TOKEN_PRICE.test(row[2]?.text ?? "")) continue;

      const input = parsePrice(row[2].html);
      if (input == null) continue;
      const output =
        row.length >= 5 && TOKEN_PRICE.test(row[4].text)
          ? parsePrice(row[4].html)
          : input;
      if (output == null) continue;

      seen.add(id);
      models[id] = {
        currency: "CNY",
        inputPerMillion: input * 1000,
        cachedInputPerMillion: null,
        outputPerMillion: output * 1000,
      };
    }
  }

  if (Object.keys(models).length === 0) {
    throw new Error("sensenova: no models parsed");
  }
  return models;
}
```

注意：
- 价格单元格是纯文本（如 `0.003元/千tokens</td>`），`parsePrice` 取首个数字即可。
- 新厂商 baseline 为空，`mergePricing` 的熔断器（`baseline.size > 0 && ...`）不会触发。

### Step 4 — `scripts/pricing-refresh/refresh-pricing.mjs`：注册厂商

`VENDORS`（line 33-44）追加：

```js
  sensenova: { parser: "./parsers/sensenova.mjs", fixture: "sensenova-pricing.html" },
```

### Step 5 — `data/pricing.json`：新增目录

在 `qwen` 目录之后（line 1654 `    }` 与 line 1655 `  }` 之间）插入：

```json
    "sensenova": {
      "sourceUrl": "https://www.sensecore.cn/help/docs/model-as-a-service/nova/pricing",
      "updatedAt": "2026-10-29",
      "models": {
        "sensenova-v6.5-pro": {
          "currency": "CNY",
          "inputPerMillion": 3,
          "cachedInputPerMillion": null,
          "outputPerMillion": 9
        },
        "sensenova-v6.5-turbo": {
          "currency": "CNY",
          "inputPerMillion": 1.5,
          "cachedInputPerMillion": null,
          "outputPerMillion": 4.5
        },
        "sensenova-v6-pro": {
          "currency": "CNY",
          "inputPerMillion": 3,
          "cachedInputPerMillion": null,
          "outputPerMillion": 9
        },
        "sensenova-v6-turbo": {
          "currency": "CNY",
          "inputPerMillion": 1.5,
          "cachedInputPerMillion": null,
          "outputPerMillion": 4.5
        },
        "sensenova-v6-reasoner": {
          "currency": "CNY",
          "inputPerMillion": 4,
          "cachedInputPerMillion": null,
          "outputPerMillion": 16
        },
        "sensechat-vision": {
          "currency": "CNY",
          "inputPerMillion": 10,
          "cachedInputPerMillion": null,
          "outputPerMillion": 60
        },
        "sensechat-character-pro": {
          "currency": "CNY",
          "inputPerMillion": 15,
          "cachedInputPerMillion": null,
          "outputPerMillion": 15
        },
        "sensechat-character": {
          "currency": "CNY",
          "inputPerMillion": 12,
          "cachedInputPerMillion": null,
          "outputPerMillion": 12
        },
        "sensenova-6.8-flash-lite": {
          "currency": "CNY",
          "inputPerMillion": 0,
          "cachedInputPerMillion": 0,
          "outputPerMillion": 0
        }
      }
    }
```

注意：`sensenova-6.8-flash-lite` 是**手写条目**（页面不列出），价格按免费记 0/0，`cachedInputPerMillion` 显式记 `0`（免费，区别于未公开的 `null`）。

### Step 6 — `data/model-info.json`：VS Code 自动填充条目

在文件末尾最后一个条目（`gemini-2.5-flash-lite`）之后、line 195 `  }` 之前追加 9 个小写键条目（含 6.8 Flash Lite，仅 displayName）。规格为 best-effort（官方无完整规格页；V6.5 上下文窗口存在 128K/256K 两个来源冲突，按保守值 128K 处理）：

```json
    "sensenova-v6.5-pro": {
      "displayName": "SenseNova V6.5 Pro",
      "contextWindow": 131072,
      "maxOutputTokens": 32768,
      "capabilities": {
        "toolCalling": true,
        "vision": true
      }
    },
    "sensenova-v6.5-turbo": {
      "displayName": "SenseNova V6.5 Turbo",
      "contextWindow": 131072,
      "maxOutputTokens": 32768
    },
    "sensenova-v6-pro": {
      "displayName": "SenseNova V6 Pro",
      "contextWindow": 131072,
      "maxOutputTokens": 32768,
      "capabilities": {
        "toolCalling": true,
        "vision": true
      }
    },
    "sensenova-v6-turbo": {
      "displayName": "SenseNova V6 Turbo",
      "contextWindow": 131072,
      "maxOutputTokens": 32768
    },
    "sensenova-v6-reasoner": {
      "displayName": "SenseNova V6 Reasoner",
      "contextWindow": 131072,
      "maxOutputTokens": 32768,
      "capabilities": {
        "thinking": true
      }
    },
    "sensechat-vision": {
      "displayName": "SenseChat Vision",
      "capabilities": {
        "vision": true
      }
    },
    "sensechat-character-pro": {
      "displayName": "SenseChat Character Pro"
    },
    "sensechat-character": {
      "displayName": "SenseChat Character"
    },
    "sensenova-6.8-flash-lite": {
      "displayName": "SenseNova 6.8 Flash Lite"
    }
```

注意：schema（`src/model-info-schema.ts`）所有字段可选，`generate-model-info-data.mjs` 无键白名单，只校验 + 渲染。

### Step 7 — 重新生成产物

```powershell
npm run pricing:generate
npm run modelinfo:generate
```

产出 `src/pricing-data.ts` / `src/model-info-data.ts`（生成文件，不手改）。

### Step 8 — 测试 fixture 与测试注册

1. 新建 `test/fixtures/pricing/sensenova-pricing.html`：复制 `tmp/sensenova-pricing.html` 的真实页面内容（约 168KB）。
2. `test/pricing-refresh.test.ts`：
   - line 34 `REAL_FIXTURE_VENDORS` 追加 `"sensenova"`；
   - fixture 映射（line 64-75）追加 `sensenova: "sensenova-pricing.html"`；
   - `KNOWN_RETIRED` 集合追加 `"sensenova-6.8-flash-lite"`（手写免费条目，页面不列出 → round-trip 跳过）；
   - 货币断言无需改（sensenova 不在 USD 列表，默认 CNY）。

## 可能破坏的已有功能

| 风险点 | 说明 | 缓解 |
|---|---|---|
| 目录键大小写 | 键若含大写，`findCatalogPriceModel` 的 `toLowerCase()` 精确匹配会落空 | parser 与 catalog 全部小写；测试 round-trip 强制一致 |
| ×1000 换算精度 | 元/千tokens → 元/百万 的浮点误差 | 已逐一验证 10 个价格全部精确，无需舍入 |
| catalog / parser / fixture 三方不一致 | round-trip 测试要求目录中每个模型在抓取结果中 `entriesEqual` | fixture 用真实页面；parser 判别条件（元/千tokens）保证恰好产出 8 个模型 |
| `EXPECTED_CATALOG_KEYS` 与 `PRICING_CATALOG_KEYS` 失配 | generator 退出码 1 | Step 1 与 Step 2 同批修改；`npm run check` 含 `generate --check` 会兜底 |
| model-info 自动刷新覆盖手写字段 | `mergeModelInfo` 只增改不删除，但 sensenova 已决定不接入刷新 | 不加入 `refresh-model-info.mjs` 的 `VENDORS` |
| 既有厂商回归 | 仅追加式改动，不改既有 parser/目录 | 全量 `npm test` 覆盖所有厂商 round-trip |
| sourceUrl 域名选错（console vs www） | `console.sensecore.cn/.../pricing/` 需登录（SPA，抓不到价格表）；`www.sensecore.cn/.../pricing` 是公开服务端渲染页 | `sourceUrl` 必须用 `www.sensecore.cn` 公开域名（已验证可抓、价格与存档一致）；用错域名会导致 sensenova 自动刷新失败（但刷新脚本对单厂商失败会 `continue` 跳过，不影响其他厂商） |
| 6.8 Flash Lite 免费条目 | 页面不列出，round-trip 会报"目录有、抓取无" | 加入 `KNOWN_RETIRED` 排除集，跳过该断言 |

## 最容易出问题的步骤

1. **Step 8（fixture + 测试）**：round-trip 断言最严格——目录中除 `KNOWN_RETIRED`（6.8-flash-lite）外的 8 个付费模型必须与 parser 对 fixture 的解析结果逐项 `entriesEqual`（字段缺失按 null 归一化）。若官方页面表结构细节（如某行单元格数）与预期不符，需调整 parser 的列判别逻辑。
2. **Step 3（parser）**：5 列/3 列两种行布局的列索引判别；`row.length >= 5 && TOKEN_PRICE.test(row[4].text)` 条件写错会把单价格模型误读。
3. **Step 1+2（类型/白名单同步）**：`PricingCatalogKey`、`PRICING_CATALOG_LABELS`、`EXPECTED_CATALOG_KEYS` 三处必须同批添加，漏一处 `npm run check` 即失败。
4. **Step 5（sourceUrl 域名）**：必须用 `www.sensecore.cn`（公开、服务端渲染），**不能**用 `console.sensecore.cn`（需登录 SPA）。已用项目 `fetchText` 实测 `www` 域名可抓、价格与存档一致；dry-run 会真实抓取线上页验证。

## 验证命令

```powershell
npm run pricing:generate
npm run modelinfo:generate
npm test
npm run check
# 真实抓取线上 www.sensecore.cn 公开页并解析，确认与目录零 diff（验证可自动更新）
node scripts/pricing-refresh/refresh-pricing.mjs --only sensenova --dry-run
```

人工验证：
- `src/pricing-data.ts` 中出现 `sensenova` 目录且 9 个模型价格与上表一致（6.8-flash-lite 为 0/0）。
- `src/model-info-data.ts` 中出现 9 个 sensenova/sensechat 条目。
- VS Code 场景：选择 `sensenova-v6.5-pro` 等模型时，`applyModelSwitch` 通过 `getModelInfo` 自动填充 name / contextWindow / maxOutputTokens / capabilities。
