# 下拉框动画增强 — 计划

## 问题

Select 下拉框点开/收起完全没有动画，很生硬。

根因：`gui/src/components/ui/select.tsx` 中 `SelectContent` 使用了
`animate-in` / `fade-in-0` / `zoom-in-95` 等类，这些类来自 `tw-animate-css`
（Tailwind v4 版的 tailwindcss-animate），项目未安装，属于死代码。

## 机制约束（已读 Radix 源码验证）

- Radix `Presence` 通过读取节点计算样式 `animation-name` 决定是否等待退场：
  - `animation-name: none`（transition 方案）→ 关闭时立即卸载，无退场动画；
  - open / closed 两态 `animation-name` 不同 → 等待 `animationend` 后再卸载。
- 因此必须用 CSS keyframes（两个不同 animation-name），且不能依赖 `forceMount`：
  `SelectContent` 内 `DismissableLayer` 带 `disableOutsidePointerEvents: true`，
  forceMount 会使其永久挂载，导致 `body { pointer-events: none }` 卡死界面。
- 定位 transform 在外层 `[data-radix-popper-content-wrapper]`，动画 transform 加在
  内层 content 元素，二者不冲突。

## 方案

CSS keyframes，沿用仓库既有 popover 动画范式（index.css 自定义 keyframes），零新依赖。

### 改动文件

1. `gui/src/index.css`
   - `[data-slot="select-content"]`：
     `transform-origin: var(--radix-select-content-transform-origin, top center)` +
     `will-change: transform, opacity`
   - `data-state="open"`：`animation: select-in 180ms cubic-bezier(0.16, 1, 0.3, 1)`
   - `data-state="closed"`：`animation: select-out 120ms ease-in forwards`
   - `@keyframes select-in`：opacity 0→1，translateY(-6px)→0，scale(0.96)→1
   - `@keyframes select-out`：opacity 1→0，translateY(0)→-4px，scale(1)→0.98

2. `gui/src/components/ui/select.tsx`
   - `SelectContent`：删除 6 个死类（animate-in/out、fade、zoom），动画交给 CSS；
     保留 side 偏移类
   - `SelectTrigger`：加 `group`；Chevron 加
     `transition-transform duration-200 ease-out group-data-[state=open]:rotate-180`
   - `SelectItem`：加 `transition-colors duration-[120ms] ease-out`

### 参数

| 项目 | 值 |
|---|---|
| 打开 | 180ms，cubic-bezier(0.16, 1, 0.3, 1)，opacity 0→1 + translateY(-6px)→0 + scale(0.96)→1 |
| 收起 | 120ms，ease-in，opacity 1→0 + translateY(0)→-4px + scale(1)→0.98 |
| Chevron | 200ms，rotate(180deg)，跟随 trigger 的 data-state |
| 选项 hover | 120ms 背景色过渡 |
| 变换基点 | `var(--radix-select-content-transform-origin)`（随 popper 方位自动调整，回退 top center） |

暗色阴影/描边：现有 `border-border shadow-float` 已满足（暗色 `--border` 为 10% 白描边、
`--shadow-float` 为大光晕），不额外改动。

## 影响面

- 仅 `gui/src/pages/vendor-editor-page.tsx` 使用 Select（模型 ID、价格来源两个下拉）
- 不引入新依赖；不修改 Radix 组件结构

## 验证

1. `npm run check`（tsc --noEmit）
2. `npm run gui` 起 dev，浏览器实际操作两个下拉框：
   - 开启动画（淡入 + 微移 + 缩放）
   - 收起动画（不立即消失，快速退场）
   - Chevron 同步旋转
   - 选项滑过 hover 过渡
   - 翻转到上方时 transform-origin 正确
   - 连续快速点击不卡死
