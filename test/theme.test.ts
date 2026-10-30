import assert from "node:assert/strict";

// 渲染层主题模块（gui/src/theme.ts）依赖 window/document，这里 stub 最小 DOM。
// 模块级状态（osDarkFromMain / knownOsDark / currentMode）随模块实例隔离，
// 因此浏览器预览回退路径（无主进程推送）必须在任何 setKnownOsDark 之前验证。
const state = { dark: false };
let mediaMatches = false; // 模拟陈旧的 prefers-color-scheme: light
const listeners: Array<(e: { matches: boolean }) => void> = [];
const docStub = {
  documentElement: {
    classList: {
      toggle: (name: string, force?: boolean) => {
        if (name === "dark") state.dark = Boolean(force);
      },
    },
  },
};
const winStub = {
  matchMedia: () => ({
    matches: mediaMatches,
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
  }),
};
(globalThis as unknown as { document: unknown }).document = docStub;
(globalThis as unknown as { window: unknown }).window = winStub;

const { initTheme, applyTheme, setKnownOsDark } = await import("../gui/src/theme.ts");

// 0) 浏览器预览回退（初始无主进程推送）：matchMedia 是唯一来源。
mediaMatches = false;
initTheme("system");
assert.equal(state.dark, false, "无主进程推送时 system 应回退 matchMedia(false)");
mediaMatches = true;
initTheme("system");
assert.equal(state.dark, true, "无主进程推送时 matchMedia=true → 深色");

// 1) 首帧：主进程注入 osDark=true，matchMedia 仍陈旧 false。
mediaMatches = false;
initTheme("system", true);
assert.equal(state.dark, true, "首帧 system 应优先采用注入的 osDark，而非陈旧 matchMedia");

// 2) OS 切浅色：主进程权威推送 false，matchMedia 始终不触发。
setKnownOsDark(false);
assert.equal(state.dark, false, "setKnownOsDark(false) 应把 system 翻成浅色");

// 3) OS 切回深色：主进程推送 true。
setKnownOsDark(true);
assert.equal(state.dark, true, "setKnownOsDark(true) 应把 system 翻回深色");

// 4) 固定模式不受 OS 状态影响。
applyTheme("light");
assert.equal(state.dark, false, "light 模式应强制浅色");
applyTheme("dark");
assert.equal(state.dark, true, "dark 模式应强制深色");

// 5) 固定模式后回到 system，采用最近一次主进程值（true）。
applyTheme("system");
assert.equal(state.dark, true, "回到 system 应采用最近主进程 osDark=true");

// 6) Electron 下（主进程已推送权威值）陈旧的 matchMedia 变化不得覆盖它。
mediaMatches = false;
listeners.forEach((cb) => cb({ matches: false }));
assert.equal(state.dark, true, "陈旧 matchMedia 变化应被主进程权威值遮蔽");

// 7) 订阅握手：建窗快照 osDark=true 后 OS 切浅色（推送在监听注册前丢失），
//    渲染进程仍停留在深色；注册监听后回放主进程当前值（false）应纠正。
initTheme("system", true);
assert.equal(state.dark, true, "快照注入后为深色");
// （此处模拟 OS 已切浅色但推送丢失：无 setKnownOsDark 调用）
setKnownOsDark(false);
assert.equal(state.dark, false, "订阅握手回放的当前值应纠正陈旧快照");

console.log("theme tests passed");
