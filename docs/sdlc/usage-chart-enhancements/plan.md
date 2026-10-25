# Usage 图表视觉与交互增强 — 计划

## 问题

在 Usage（用量统计）页面的「Last 30 days」用量趋势图表中，存在两个体验缺陷：

1. **极端数据倾斜导致低频/小用量模型颜色完全隐形**：
   - Heimdall 作为模型路由与故障切换网关，主力廉价模型（如 `Qwen3.8-27B`）单日 Token 消耗常达数千万至数亿，而高质量模型（如 `claude-opus-5-5`）或兜底模型（如 `deepseek-flash`）单日可能仅消耗数千至数万 Tokens。
   - 图表 Y 轴为线性刻度（例如自适应最大值拉至 `500M`），绘图区总高度为 `220px`。
   - 当小用量模型 Tokens 为 10,000 时，计算出的物理高度为 `(10,000 / 500,000,000) * 220px = 0.0044px`。在浏览器亚像素渲染中直接被舍入为 0 像素。
   - 图例虽然展示了 4~5 个模型的色块，柱状图一眼看去却完全是主导模型的单色，用户无法直观确认其他模型是否被调用，破坏了多模型路由状态的可观测性。

2. **堆叠柱状体样式分离，缺乏整体感**：
   - `gui/src/components/usage-chart.tsx` 中，每天的柱体内部通过 `flex h-full w-full flex-col-reverse` 堆叠切片，每个切片 `<i>` 均自带 `rounded-[2px]`。
   - 多模型堆叠时，下层顶部圆角收口、上层底部圆角收口，在交界处左右两侧形成明显的三角形内凹缩进，呈现断节的“胶囊/药丸拼接感”。
   - 当某切片被压缩至 1~2px 时，由于 4 个角均为 2px 圆角，直接退化成椭圆形小碎片浮在大柱顶端，视觉十分零碎且脱节。

---

## 方案选型与设计

### 1. 柱状体样式统一：整体容器裁剪法（Container Clipping）

- **弃用切片独立圆角**：移除各个 `<i>` 内部切片的 `rounded-[2px]`，改为 `rounded-none`（平直矩形）。
- **外层单柱整体容器**：
  - 每天的整根柱体由一个总容器包裹，高度由当天所有展示切片的高度总和决定（贴底对齐）。
  - 外层总容器统一设置 `overflow-hidden rounded-t-[3px]`。
- **效果**：
  - 各颜色切片之间无缝咬合，分界线平直利落；
  - 柱顶自然被容器裁剪出统一的平滑圆角；
  - 整根立柱呈现坚实、一体的视觉质感。

### 2. 小模型可见性增强：双轨联动机制

#### 轨道 A：视觉保底最小高度（Min-Height 保底）
- **机制**：凡是当天有调用记录（`totalTokens > 0`）的模型切片，在视觉分配时保证至少占据 **2.5px ~ 3px** 的物理可见高度。
- **效果**：即使大模型达到上亿、小模型仅数千，柱顶也总能清晰露出一道精致平整的色带，鼠标 hover 即可查看精准数据，彻底告别“色块隐形”。

#### 轨道 B：图例交互式快速过滤（Interactive Legend Filtering）
- **机制**：
  - 图例项升级为可点击按钮，组件内维护 `hiddenModels: Set<string>` 过滤集合；
  - **点击图例模型**：切换显示/隐藏状态（隐藏状态文字置灰、颜色点空心化或半透明）；
  - **动态自适应 Y 轴**：隐藏主力大模型（如 Qwen）后，Y 轴 `chartMaximum` 自动根据剩余可见模型的最大用量重新计算（从 500M 缩放到 100K 级别）；
  - **鼠标悬停高亮**：hover 某个图例项时，柱状图中对应模型的切片保持高亮，其余模型切片适当淡化（降低不透明度），便于快速聚焦单个模型的分布走势。
- **效果**：
  - 满足用户对低频昂贵模型的深度探查需求；
  - 零页面刷新，纯前端毫秒级即时响应。

---

## 改动清单

主要改动聚焦在单个前端组件：`gui/src/components/usage-chart.tsx`

1. **状态管理**：
   - 增加 `hiddenModels` 状态（`Set<string>`），用于记录当前被用户隐藏的模型。
   - 增加 `hoveredModel` 状态（`string | null`），用于图例悬停高亮。

2. **数据计算与坐标轴自适应**：
   - 动态计算未隐藏模型在每日的合计用量，基于未隐藏数据重算 `chartMaximum` 与 Y 轴刻度 `ticks`。
   - 分配切片显示高度时，为 `totalTokens > 0` 且未隐藏的切片应用最小保底高度比例。

3. **DOM 结构重构**：
   - 图例渲染：改用 `<button>` 元素，增加点击切换、hover 触发及快捷聚焦交互；隐藏项应用 `.opacity-40` 与样式过渡。
   - 柱体渲染：
     ```tsx
     <div
       className="w-full overflow-hidden rounded-t-[3px] flex flex-col-reverse transition-[filter] group-hover:brightness-110"
       style={{ height: `${totalBarHeightPercent}%` }}
     >
       {activeSegments.map((segment) => (
         <i
           key={segment.name}
           className="w-full shrink-0 transition-opacity duration-150"
           style={{
             height: `${segment.heightPercent}%`,
             background: segment.color,
             opacity: hoveredModel && hoveredModel !== segment.name ? 0.35 : 1,
           }}
         />
       ))}
     </div>
     ```

---

## 影响面

- **范围**：仅限 `gui/src/components/usage-chart.tsx` 的前端展现与交互逻辑。
- **兼容性**：
  - 完全兼容已有的 `metric="tokens"` 和 `metric="cost"` 两类指标；
  - 不改变任何 IPC 契约、不修改数据后端或持久化配置；
  - 无需引入任何新的外部第三方依赖。

---

## 验证步骤

1. **类型与静态检查**：`npm run check`（`tsc --noEmit`），确保无类型错误。
2. **测试回归**：`npm test`，确保现有测试套件全部通过。
3. **UI 与交互验证**（`npm run gui` 进入 Usage 页面）：
   - **接缝检查**：多颜色切片堆叠时接缝平直，无内凹缺口，柱顶呈现完整圆角。
   - **极小用量可见性**：小用量模型切片在柱顶有清晰的彩色薄条，不被 0 像素吞噬。
   - **图例点击过滤**：
     - 点击主导大模型后，该图例置灰，图表 Y 轴立刻从数亿自适应缩放到几十万/数万，小模型起伏细节清晰展现；
     - 再次点击恢复显示；
     - hover 图例项时，柱状图中对应切片高亮，其他切片半透明。
