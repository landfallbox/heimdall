# 下拉框动画增强 — 计划

## 问题

Select 下拉框点开/收起完全没有动画，很硬。

根因：`gui/src/components/ui/select.tsx` 中 `SelectContent` 使用了
`animate-in` / `fade-in-0` / `zoom-in-95` 等类，这些类来自 `tw-animate-css`
（Tailwind v4 版的 tailwindcss-animate），项目未安装，属于死代码。

## 方案选型

- 初版（commit 63e94ce）采用自定义 CSS keyframes（`select-in` / `select-out`），
  零新依赖，但动画定义是手写的私有实现。
- 最终方案（用户拍板）：**安装 `tw-animate-css`**，让 select.tsx 里既有的
  tw-animate-css 工具类直接生效。理由：
  - 这些类本来就是为它写的，装上即活，组件层无需再改动画定义；
  - 与 Tailwind v4 生态对齐（官方推荐的 v4 版 tailwindcss-animate），
    后续其他组件（Dialog、DropdownMenu 等）可直接复用同一套工具类；
  - keyframes 由库维护，不自带私有动画代码。

## 机制约束（已读 Radix / tw-animate-css 源码验证）

- Radix `Presence` 通过读取节点计算样式 `animation-name` 决定是否等待退场：
  - `animation-name: none`（transition 方案）→ 关闭时立即卸载，无退场动画；
  - open / closed 两态 `animation-name` 不同 → 等待 `animationend` 后再卸载。
  tw-animate-css 的 `animate-in` / `animate-out` 分别对应 `enter` / `exit`
  两个不同 animation-name，恰好满足该约束（已实测：收起后浮层播完 120ms
  退场才卸载，不闪退）。
- 不能依赖 `forceMount`：`SelectContent` 内 `DismissableLayer` 带
  `disableOutsidePointerEvents: true`，forceMount 会使其永久挂载，
  导致 `body { pointer-events: none }` 卡死界面。
- 定位 transform 在外层 `[data-radix-popper-content-wrapper]`，动画 transform
  加在内层 content 元素，二者不冲突。
- tw-animate-css 通过 `--tw-duration` / `--tw-ease` 变量读取 Tailwind 的
  `duration-*` / `ease-*` 工具类，因此动画时长与缓动直接由类控制，
  与 Tailwind 生态一致。

## 改动

1. `package.json` / `package-lock.json`：新增依赖 `tw-animate-css`
2. `gui/src/index.css`
   - `@import "tw-animate-css";`（紧跟 `@import "tailwindcss";`）
   - `[data-slot="select-content"]`：
     `transform-origin: var(--radix-select-content-transform-origin, top center)` +
     `will-change: transform, opacity`
     （transform-origin 由 Radix 按 popper 实际方位注入变量：向下展开时锚顶边、
     翻转到上方时自动锚底边；tw-animate-css 不提供该属性，故在此补充）
3. `gui/src/components/ui/select.tsx`
   - `SelectContent`：既有 tw-animate-css 类补全为完整参数——
     `data-[state=open]:animate-in` / `data-[state=closed]:animate-out`、
     `fade-in-0` / `fade-out-0`、`zoom-in-95` / `zoom-out-95`、
     `slide-in-from-top-[6px]` / `slide-out-to-top-[4px]`、
     `duration-180 ease-[cubic-bezier(0.16,1,0.3,1)]`（开）/
     `duration-120 ease-in`（收）。
     注意：`slide-in-from-top-*` 的整数分支只匹配整数，-6px 微移必须用
     任意值 `slide-in-from-top-[6px]`（库内取反为 translateY(-6px)）。
   - `SelectTrigger`：加 `group`；Chevron 加
     `transition-transform duration-200 ease-out group-data-[state=open]:rotate-180`
   - `SelectItem`：`transition-colors duration-[120ms] ease-out`

### 参数

| 项目 | 值 |
|---|---|
| 打开 | 180ms，cubic-bezier(0.16, 1, 0.3, 1)，opacity 0→1 + translateY(-6px)→0 + scale(0.95)→1 |
| 收起 | 120ms，ease-in，opacity 1→0 + translateY(0)→-4px + scale(1)→0.95 |
| Chevron | 200ms，rotate(180deg)，跟随 trigger 的 data-state |
| 选项 hover | 120ms 背景色过渡 |
| 变换基点 | `var(--radix-select-content-transform-origin)`（随 popper 方位自动调整，回退 top center） |

暗色阴影/描边：现有 `border-border shadow-float` 已满足（暗色 `--border` 为 10% 白描边、
`--shadow-float` 为大光晕），不额外改动。

## 影响面

- 仅 `gui/src/pages/vendor-editor-page.tsx` 使用 Select（模型 ID、价格来源等下拉）
- 新增运行时依赖 `tw-animate-css`（纯 CSS，约 10KB，无 JS）
- 不修改 Radix 组件结构

## 验证

1. `npm run check`（tsc --noEmit）
2. `npm run gui` 起 dev，浏览器实际操作下拉框：
   - 开启动画（淡入 + 微移 + 缩放，180ms 减速曲线）
   - 收起动画（不立即消失，120ms 快速退场后卸载）
   - Chevron 同步旋转
   - 选项滑过 hover 过渡
   - 翻转到上方时 transform-origin 锚底边（实测 `0px 265.6px`），向下展开锚顶边
   - 连续快速点击不卡死
