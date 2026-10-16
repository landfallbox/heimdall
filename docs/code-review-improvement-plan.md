# Heimdall 代码审查流程改进计划

来源：[Solving Code Review at Anthropic](https://claude.dev/blog/solving-code-review-at-anthropic/) 的思想对照本项目现状。
本文件是决策清单：每项标记状态，逐项确认"要不要做、怎么做"，确认后更新状态并记录决定。

状态约定：

- `待决策`：未确认
- `做`：已确认要做（在"决定"里补一句怎么做/何时做）
- `不做`：已确认不做（在"决定"里补一句原因）
- `已完成`：已实施并验证

## 总览（2026-10-17 全部决策完成）

- 做并已完成：项 1、2、3、4、5、6、7、8、9、10、11、13、14
- 不做：项 12（已有审查条款覆盖）、项 15（纯习惯，不写文档）
- 待办：① 合并本分支后在仓库 Settings 配置 `SECURITY_REVIEW_API_KEY` secret（项 6 第 1 步）；② 在 github.com/coderabbit.ai 用 GitHub 账号登录并授权 heimdall 仓库（项 6 第 3 步 CodeRabbit，OAuth 需手动）；③ 项 6 第 2 步自研代理式审查待历史 PR 评测后决定。

## 1. 现状对照（文章 7 层检查 vs 本项目）

| 文章的层 | 本项目现状 |
| --- | --- |
| 1. PR 前自验证 | `CONTRIBUTING.md` 要求 PR 前跑 `check`/`test`/`build`；但没有任何给 agent 的指令文件（无 `CLAUDE.md`/`AGENTS.md`/`REVIEW.md`），而仓库已有 4 个 `agents/*` 分支，agent 写代码已是常态 |
| 2. 每个 PR 有 AI 审查 | 缺失。PR #6 合并时 0 条评论；PR #5（前端全面重构）创建 3 分钟后即合并 |
| 3. 可阻断的安全审查 | 缺失。无自动化安全审查，尽管本项目专门处理 API key |
| 4. 阻断式 CI | 扎实：Win+Mac 双平台、语法检查、18 个测试文件、GUI 构建、Electron 生命周期测试；release 还校验 tag 与版本号一致、校验产物完整性 |
| 5. 按风险分级的人工审批 | 无风险分级，无 PR 模板，main 分支保护情况未确认 |
| 6. 合并队列 + 开关 + 灰度发布 | 无合并队列（单人项目合理）；无特性开关；`updater.ts` 只指向 `releases/latest`，单一渠道、无"内部先用" |
| 7. 快速发现、快速回滚 | 结构化日志 + 脱敏做得好；但发布后无 stable 渠道兜底，README 没有回退路径说明 |

## 2. 改进项清单

### P0 — 低成本，可立即做

#### 项 1：写 `AGENTS.md`（状态：已完成）

- **文章依据**：第一层的核心。`CLAUDE.md` 告诉 agent 项目是什么：技术栈、约定、目标与非目标。每次审查都会加载它，所以在大代码库里保持短，指向其他文档。
- **本项目落点**：`CONTRIBUTING.md` 里已有的 6 条 Architecture Rules（配置归一化放 `src/config.ts`、表单转换放 `gui/src/config-draft.ts`、配置写入必须走 `config-store.ts`、Router 进程所有权、failover 边界 = 响应已提交、IPC 走 guarded helper）正是它该承载的内容。
- **怎么做**：新建根目录 `AGENTS.md`（通用名，考虑跨工具通用性，不用 `CLAUDE.md`），内容 = 项目一句话定位 + 技术栈 + 上述架构规则（精简版）+ 验证命令（`npm run check` / `npm test` / `npm run test:electron` / `npm run gui:build`）+ 指向 `CONTRIBUTING.md` 和 `docs/`。控制在 50 行内。
- **决定**：做。文件名用 `AGENTS.md` 而非 `CLAUDE.md`，保证对各类 agent 工具通用。

#### 项 2：写 `REVIEW.md`（状态：已完成）

- **文章依据**：由代码 owner 写给审查者，说清"这个仓库里失败长什么样"；限制 nit 数量；列出可跳过路径；要求给出文件+行号证据而不是靠名字猜；摘要以数量开头、没有可修的就明说。
- **本项目"失败"的定义**（可直接写进去）：
  - 该回退时没回退 / 不该回退时回退了（状态码、超时、流已开始）
  - API key 或上游响应体泄漏进日志
  - 配置写入产生半份文件 / 覆盖外部并发修改
  - 响应头或 body 已发给客户端后仍切换供应商
  - IPC 契约绕过 schema 校验
- **怎么做**：新建根目录 `REVIEW.md`，按上面格式写，20 行以内。
- **决定**：做。已实施，并在 `AGENTS.md` 文档指引中加了 `REVIEW.md` 条目。

#### 项 3：加 PR 模板（状态：已完成）

- **文章依据**：PR 模板要问"如何测试的、如何回滚"。`CONTRIBUTING.md` 已有这条要求，但模板才能落到每个 PR 上，agent 也能自动填写。
- **怎么做**：新建 `.github/pull_request_template.md`，字段：变更说明 / 如何测试（附命令与结果）/ 风险与回滚方式（如何 undo）/ 是否影响 `config.json` 结构。
- **决定**：做。已实施。

#### 项 4：合并前"新上下文 agent 审 diff"（状态：已完成）

- **文章依据**：PR 前由一个全新上下文的子代理审查 diff；每条发现必须被回应——要么修复，要么说明理由关闭线程。这是文章里性价比最高的实践，零基础设施。
- **怎么做**：写入 `CONTRIBUTING.md` 的 PR 流程：合并任何 agent PR 前，跑一次 `/code-review`（或开新会话让 agent 审 diff）；输出逐条回应（修复或注明理由），回应记录在 PR 评论区。
- **决定**：做。已实施。同时收敛了 CONTRIBUTING.md 与 AGENTS.md 的重复（架构规则只留 AGENTS.md 一份，CONTRIBUTING.md 改为指向），并修正了过期的 `test/electron-lifecycle.test.js` → `.ts` 文件名。

#### 项 5：main 分支保护（状态：✅ 已完成）

- **文章依据**：阻断式检查 + 走 PR。
- **怎么做**：对 `main` 加保护：require status checks（CI 绿）、require PR、允许管理员绕过。
- **决定**：做（2026-10-17 用 `gh` CLI 直接配置完成）。最终参数：
  - 要求 4 个 status check 通过：`test (windows-latest)`、`test (macos-latest)`、`electron-lifecycle (windows-latest)`、`electron-lifecycle (macos-latest)`（`strict: false`，不要求分支最新）。
  - 要求 PR 且 **1 个批准**（`required_approving_review_count: 1`）。
  - **允许管理员绕过**（`enforce_admins: false`）：自己 merge 时绕过全部要求，不受"1 个批准"限制；该要求仅对未来非 admin 协作者生效。
  - 禁止强推、禁止删除分支。
  - 说明：GitHub 不允许作者批准自己的 PR，配合管理员绕过，单人项目日常合并零摩擦。

### P1 — 中等成本，收益明确

#### 项 6：PR 自动安全审查（状态：diff-only 已完成，CodeRabbit 已接入待 OAuth 授权，自研代理式待评估）

- **文章依据**：安全审查独立成层，有未关闭发现时 PR 不能合并；可用开源的 security review GitHub Action 或 `/security-review` 命令实现。
- **本项目特殊性**：本地 API key 鉴权、上游 vendor key、日志脱敏都在关键路径上，是少见的"个人项目也值得上安全审查"的类型。
- **怎么做**：在 `ci.yml` 加一个 job 跑安全审查，发现贴到 PR 评论；是否设为 required check 可先观察几周再定。审查引擎**不绑定 Claude**，免费开源替代：
  - **静态扫描（非 LLM，免费开源）**：Semgrep（安全规则）、Gitleaks（密钥泄漏，本项目鉴权关键路径尤其适用）、Trivy（漏洞/密钥）、CodeQL（公开仓库免费）。
  - **开源 agent（可指向本地模型，全免费）**：OpenHands、SWE-agent、Aider 等，或自写最小 agent 循环（读文件/grep/列目录 + N 轮）由本地 Qwen 驱动（即第 2 步设想）。
  - **厂商托管代理式（用厂商强模型，非本地 27B，免费覆盖公开仓库）**：CodeRabbit（公开仓库免费，低噪声/高精度，混合 linter+SAST）、Greptile（MIT 开源免费，全仓库代码图、高召回/多噪声）。这类方案跑在厂商基础设施上，绕开"27B 跑多轮不可靠"的问题。
  - **Claude Code GitHub Action**：官方现成方案，但需付费 Claude API key、非开源，仅作为"省事"备选。
  - 现状：第 1 步 diff-only 已用本地 Qwen 端点实现，**完全不依赖 Claude**。
- **决定**：做，分两步。
  - **第 1 步（已完成）**：diff-only 审查。`scripts/security-review.mjs` 拉 PR diff，按 REVIEW.md 失败定义让本地模型（OpenAI 兼容端点，复用 release notes 的 `122.193.22.119:8000/v1` + `Qwen3.8-27B` 模式）输出结构化发现，贴 PR 评论。`ci.yml` 新增 `security-review` job（仅 pull_request 触发，informational，永不阻断）。需要配置仓库 secret `SECURITY_REVIEW_API_KEY`（同 release notes 的 key 即可），可选变量 `SECURITY_REVIEW_BASE_URL` / `SECURITY_REVIEW_MODEL`。
  - **第 2 步（待处理，用户后续处理）**：代理式审查评估。用几个历史 PR 当评测集，对比 diff-only vs 代理式（自写最小 agent 循环：读文件/grep/列目录三工具 + N 轮循环，或开源 agent CLI）的召回/噪声比，代理式明显更好再升级。注意：27B 级模型跑多轮工具调用的可靠性是最大风险，弱模型的幻觉发现可能比单轮 diff 审查噪声更多。
  - **第 3 步（仓库内配置已完成，待用户 OAuth 授权）**：接入 CodeRabbit 作为厂商托管代理式审查（免费覆盖公开仓库，用厂商强模型、非本地 27B）。
    - 选型理由：单人项目 + 低噪声偏好 → CodeRabbit（`profile: quiet`，混合 linter+SAST，公开仓库免费、限流不限总量）优于 Greptile（高召回但多噪声、50 credit/月）。
    - 已落地：仓库根 `.coderabbit.yaml`（`language: zh-CN`、`profile: quiet`、不审草稿、`path_filters` 覆盖 `src/**`+`gui/**`+`.github/**`+`scripts/**` 并排除 `pricing-data.ts`/`gui/dist`/`build`、7 条 `path_instructions` 把 REVIEW.md 6 类失败定义注入 `server.ts`/`vendor-circuit-breaker.ts`/`config.ts`/`logger.ts`/`config-store.ts`/`main.ts`/`updater.ts`）。
    - 自动增益：CodeRabbit 会自动读取 `AGENTS.md` 作为审查准则（无需配置）；`REVIEW.md` 不在自动识别列表，故靠 `path_instructions` 显式注入。
    - 待用户手动：在 github.com/coderabbit.ai 用 GitHub 账号登录 → 授权 heimdall 仓库（OAuth 无法由 agent 代替）→ 在 PR 中 `@coderabbitai` 触发或自动审查。
    - 定位：与第 1 步 diff-only 互补（CodeRabbit 强在跨文件上下文 + linter，diff-only 强在针对 REVIEW.md 失败定义的结构化输出）；观察几周再决定是否把 CodeRabbit 设为 required check。

#### 项 7：双发布渠道 stable/beta（状态：✅ 已完成）

- **文章依据**：`latest` 渠道先走，`stable` 渠道滞后；内部员工先用。
- **本项目落点**：electron-updater 原生支持多 channel（`latest.yml` vs `latest-beta.yml`）。
- **怎么做**：
  1. `release.yml` 增加 beta 发布路径（tag 带 `-beta` 后缀时构建加 `--channel beta`、发布 `latest-beta.yml`/`latest-beta-mac.yml`、发 prerelease 且 `make_latest=false`；stable tag 发布 `latest.yml`/`latest-mac.yml`）。
  2. `updater.ts` 支持渠道选择（配置项 `updateChannel: "stable" | "beta"`，默认 stable）。
  3. 高风险新功能（failover 规则、updater 本身）先发 beta，自己用几天再进 stable。
- **决定**：做，现在实施（2026-10-16）。
- **实施记录**：
  - `src/config.ts`：`UpdateChannel` 类型、schema 默认 stable、normalize、DEFAULT_CONFIG。
  - `gui/electron/updater.ts`：`setUpdateChannel()`（stable→`channel="latest"`+`allowPrerelease=false`；beta→`channel="beta"`+`allowPrerelease=true`），`initializeUpdater` 按当前渠道初始化。
  - `gui/electron/main.ts`：启动时与 `config:save` 后调用 `setUpdateChannel`，渠道变更无需重启即生效。
  - `gui/src/config-draft.ts`：类型/默认值/normalize/toDraft/toConfig。
  - `gui/src/App.tsx`、`application-page.tsx`、`mock-desktop-api.ts`：设置页 Updates 卡片加渠道 SegmentedControl（Stable/Beta）+ 说明文案。
  - `config.example.json`、`test/electron-lifecycle.test.ts`：补字段。
  - 验证：`npm run check`、`npm test`（全通过）、`npm run gui:build`、YAML 校验均通过。
- **发布侧注意**：beta 版本用 `vX.Y.Z-beta.N` tag 触发；stable 用 `vX.Y.Z`。

#### 项 8：发布前 dogfood（状态：✅ 已完成）

- **文章依据**：新功能先给内部员工用，重度使用往往在用户之前暴露回归。
- **怎么做**：`CONTRIBUTING.md` 的 release 检查清单加一条："打包装机版并实际安装使用至少一次（启动、配置、一次真实请求、一次更新检查）"。最低成本版本，不改代码。
- **决定**：做（2026-10-16）。已在 `CONTRIBUTING.md` Pull Requests 一节的 release 条目后加 dogfood 要求。

#### 项 9：回滚路径文档化（状态：✅ 已完成）

- **文章依据**：一切可逆——开关、回滚、分阶段发布让大多数错误在几分钟内可撤销。
- **怎么做**：
  1. `README.md` 加"回退"小节：如何安装旧版本（GitHub Releases 保留所有历史版本）、数据目录不受影响。
  2. 高风险行为变更优先用**配置项**代替 feature flag——本地应用里"开关不用部署就能关"的等价物就是配置热加载（`config-store.ts` 已支持）。
- **决定**：做（2026-10-16）。已在 `README.md` 加 "Updating And Rollback" 小节（渠道切换、回退安装、数据目录不受影响、配置项优先于硬编码）。

#### 项 10：事故 → 评测集（状态：✅ 已完成）

- **文章依据**：审查漏掉什么，就追问"模型当时面前缺什么信息"，把修复沉淀进 `AGENTS.md`、`REVIEW.md` 或新检查；把事故和回滚变成评测集。
- **怎么做**：本文件末尾（或独立文件）维护"逃逸到发布的 bug"清单，每条包含：现象 / 根因 / 回归测试位置 / 沉淀到了哪个文件（AGENTS.md 一行、REVIEW.md 一行、或新测试）。每次 review 漏检或线上问题后追加。
- **决定**：做（2026-10-16）。已在文档第 4 节建"逃逸 bug 清单"骨架（含字段说明 + 表头）。

### P2 — 值得知道，单人项目不紧迫

#### 项 11：书面风险分级表（状态：✅ 已完成）

- **文章依据**：按变更定级而非按作者；不需要分类器，写进文档即可。
- **分级草案**：
  - 低（文档、`data/pricing.json`、GUI 样式）：CI + AI 审查绿即可合并
  - 中（`src/server.ts`、协议转换、配置逻辑）：人读 diff + 测试证据
  - 高（`config-store.ts`、`updater.ts`、鉴权、CI/release workflow）：人深审 + 手动测打包版
- **怎么做**：写进 `CONTRIBUTING.md` 或 `REVIEW.md`。
- **决定**：做（2026-10-16）。已写进 `REVIEW.md` 新增"风险分级"小节（低/中/高三级 + 合并前要求 + 拿不准按更高一级）。

#### 项 12："You land it, you own it" 的 agent 版本（状态：❌ 不做）

- **文章依据**：谁 prompt 了 agent 谁就是 owner；合并前读证据（测试输出、截图、审查发现）；"说不出检查会漏什么，就要一次真正的 review 而不是快速批准"。
- **怎么做**：写进 `CONTRIBUTING.md`：agent PR 合并前，发起者必须贴出关键测试输出/截图作为证据；无法说明检查会漏什么时，做一次完整审查再合并。
- **决定**：不做（2026-10-16）。CONTRIBUTING.md 已有"合并前用新上下文 agent 审 diff、逐条回应发现"条款，覆盖核心意图；额外"贴证据"要求对个人项目偏重，不新增。

#### 项 13：保持 PR 小（状态：✅ 已完成）

- **文章依据**：变更小才容易审查、调试、回滚。
- **本项目反例**：PR #5 "前端界面全面重构"（Tailwind v4 + shadcn/ui 全量重构）是文章的反模式。
- **怎么做**：`CONTRIBUTING.md` 加一条：大重构拆成"可独立回滚的多个 PR"（如：依赖升级 → 组件迁移 → 布局调整各一个）。
- **决定**：做（2026-10-16）。已在 `CONTRIBUTING.md` Pull Requests 一节加"大重构拆成可独立回滚的多个 PR"。

#### 项 14：方向问题提早（状态：✅ 已完成）

- **文章依据**：agent 让开始一件事变得便宜，所以有些工作根本不该落地；在 thread 里提早提出不同方向，而不是在完成的 PR 上提 blocking 评论。
- **怎么做**：个人习惯项，无文件改动；可写进 `AGENTS.md` 的"工作方式"一节：实现前先给计划，计划被否时直接放弃该 PR，不心疼已写的代码。
- **决定**：做（2026-10-16）。已在 `AGENTS.md` 加"工作方式"小节（实现前先给计划、方向被否即放弃、方向问题提早提）。

#### 项 15：按需解释代替完整心智模型（状态：❌ 不做）

- **文章依据**：没人需要完整心智模型；要改哪个模块就让 Claude 现场写一份讲解（几分钟、反映当前代码），比逐行读 diff 划算。
- **与现有资料的关系**：`docs/code-review-learning-plan.md` 是 4 周系统阅读计划（为面试准备，目标不同，保留）；此项是日常 review 手段的补充，两者不冲突。
- **怎么做**：无文件改动；作为工作习惯——改某模块前，先让 agent 基于当前代码写一份该模块的讲解/调用链，再动手。
- **决定**：不做（2026-10-16）。纯工作习惯，个人已按需使用 agent 讲解，不写入文档。

### 明确不需要（记录决策，避免重复讨论）

| 项 | 原因 |
| --- | --- |
| 合并队列 | 单一写作者，无意义 |
| CODEOWNERS | 单一维护者 |
| 遥测 | 本地应用、隐私优先是设计选择；"快速发现"已由结构化日志 + 用户反馈覆盖 |
| 风险分类器 | 一个人用书面分级表（项 11）就够 |

## 3. 决策记录

| 日期 | 项 | 决定 | 备注 |
| --- | --- | --- | --- |
| 2026-10-16 | 项 1 | 做 | 文件名用 `AGENTS.md`（通用），不用 `CLAUDE.md` |
| 2026-10-16 | 项 2 | 做 | 失败定义 6 类，按严重度排序；审查规则 5 条 |
| 2026-10-16 | 项 3 | 做 | 四段式模板：变更说明 / 如何测试（附证据）/ 风险与回滚 / 配置影响 |
| 2026-10-16 | 项 4 | 做 | 流程写入 CONTRIBUTING.md PR 一节；架构规则去重到 AGENTS.md；修正 .js→.ts 过期文件名 |
| 2026-10-17 | 项 5 | 做 | 用 `gh` CLI 配置完成：4 个 CI check 必过 + 1 个批准 + 允许管理员绕过 + 禁止强推/删除 |
| 2026-10-16 | 项 6 | 做（分三步） | 第 1 步 diff-only 已实施（scripts/security-review.mjs + ci.yml job，本地模型）；第 2 步自研代理式待历史 PR 评测后决定；第 3 步 CodeRabbit 仓库内配置已完成（.coderabbit.yaml），待用户 OAuth 授权 |
| 2026-10-17 | 项 6-3 | 做 | 接入 CodeRabbit（公开仓库免费、厂商强模型、非 27B）：.coderabbit.yaml（quiet + zh-CN + 7 条 path_instructions 注入 REVIEW.md 6 类失败定义）；OAuth 授权需用户手动 |
| 2026-10-16 | 项 7 | 做 | 双发布渠道 stable/beta 已实施（config + updater + main + GUI + release.yml）；beta 用 `vX.Y.Z-beta.N` tag 触发 |
| 2026-10-16 | 项 8 | 做 | CONTRIBUTING.md release 条目加 dogfood 要求（纯文档） |
| 2026-10-16 | 项 9 | 做 | README.md 加 "Updating And Rollback" 小节（渠道切换/回退安装/数据目录不受影响/配置项优先） |
| 2026-10-16 | 项 10 | 做 | 建"逃逸 bug 清单"骨架（第 4 节），每次 review 漏检/线上问题后追加 |
| 2026-10-16 | 项 11 | 做 | REVIEW.md 加"风险分级"小节（低/中/高 + 合并前要求） |
| 2026-10-16 | 项 12 | 不做 | CONTRIBUTING.md 已有"新上下文 agent 审 diff"条款，覆盖核心意图；额外贴证据要求对个人项目偏重 |
| 2026-10-16 | 项 13 | 做 | CONTRIBUTING.md 加"大重构拆成可独立回滚的多个 PR" |
| 2026-10-16 | 项 14 | 做 | AGENTS.md 加"工作方式"小节（实现前先给计划、方向被否即放弃） |
| 2026-10-16 | 项 15 | 不做 | 纯工作习惯，个人已按需使用 agent 讲解，不写入文档 |

## 4. 逃逸 bug 清单

用途：审查漏掉什么，就追问"模型当时面前缺什么信息"，把修复沉淀进 `AGENTS.md`、`REVIEW.md` 或新检查，让同类问题不再逃逸到发布。每次 review 漏检或线上问题后追加一条。

字段：现象 / 根因 / 回归测试位置 / 沉淀到了哪个文件（AGENTS.md 一行、REVIEW.md 一行、或新测试）。

| 日期 | 现象 | 根因 | 回归测试位置 | 沉淀到 |
| --- | --- | --- | --- | --- |
| — | _（暂无记录；首次追加时替换本行）_ | | | |
