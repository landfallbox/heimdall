import type { ThemeMode } from "./config-draft.ts";

const DARK_MEDIA = "(prefers-color-scheme: dark)";

let currentMode: ThemeMode = "system";

/**
 * 已知的系统深色状态。首帧由主进程注入（URL osDark 参数），
 * 之后由 matchMedia change 事件持续刷新。
 *
 * 背景：Electron 渲染进程首帧的 matchMedia(prefers-color-scheme) 可能尚未
 * 同步 OS 深色（恒 false），导致首启"跟随系统"在深色系统下显示浅色。
 * 主进程 nativeTheme.shouldUseDarkColors 是可靠的，通过 URL 注入首帧值，
 * 缓存在这里供后续 applyTheme 调用使用（config 加载后 App 会再次 applyTheme）。
 */
let knownOsDark: boolean | null = null;

/**
 * 主进程 nativeTheme 权威推送的 OS 深色状态。
 * 渲染进程 matchMedia 在 Electron 下可能不触发 change 事件（尤其主进程已注入
 * osDark 而 matchMedia 仍为 false 时），因此 system 模式优先采用主进程推送值，
 * 保证 OS 主题变化能可靠地刷新主题。
 */
let osDarkFromMain: boolean | null = null;

/**
 * 主进程权威推送的 OS 深色状态更新。system 模式下立即重应用；
 * 同时刷新 knownOsDark，使后续 applyTheme 跟随真实 OS 偏好。
 */
export function setKnownOsDark(osDark: boolean): void {
  osDarkFromMain = osDark;
  knownOsDark = osDark;
  if (currentMode === "system") applyTheme("system");
}

/**
 * 同步设置 <html> 的 .dark 类。system 读系统偏好，light/dark 固定。
 * 每次调用都会更新模块内的 currentMode，供 initTheme 的常驻监听器判断。
 *
 * osDarkOverride 为主进程注入的系统深色状态；提供时更新 knownOsDark。
 * system 模式优先用 knownOsDark（首帧可靠值），缺省时回退 matchMedia。
 * 这样 config 加载后 App 再次 applyTheme 也不会被首帧不可靠的 matchMedia 覆盖。
 */
export function applyTheme(mode: ThemeMode, osDarkOverride?: boolean): void {
  currentMode = mode;
  if (osDarkOverride !== undefined) knownOsDark = osDarkOverride;
  // system 模式优先级：主进程权威推送 > 首帧注入/knownOsDark > matchMedia 回退。
  const prefersDark =
    mode === "dark" ||
    (mode === "system" &&
      (osDarkFromMain ?? knownOsDark ?? window.matchMedia(DARK_MEDIA).matches));
  document.documentElement.classList.toggle("dark", prefersDark);
}

/**
 * 应用初始主题并挂载唯一的 matchMedia change 监听器。
 * 监听器仅在 currentMode === "system" 时应用，因此切到固定主题后
 * 系统主题变化不再触发切换（spec D3：集中管理，避免双重监听）。
 * change 事件会刷新 knownOsDark，使后续 applyTheme 跟随真实 OS 偏好。
 */
export function initTheme(mode: ThemeMode, osDarkOverride?: boolean): void {
  applyTheme(mode, osDarkOverride);
  window.matchMedia(DARK_MEDIA).addEventListener("change", (e) => {
    knownOsDark = e.matches;
    if (currentMode === "system") applyTheme("system");
  });
}

/**
 * 读取 ?theme= 查询参数作为首帧主题（可选加固，spec D1）。
 * 仅接受三个合法值，其余回退 system。
 */
export function readInitialThemeFromUrl(): ThemeMode {
  try {
    const param = new URLSearchParams(window.location.search).get("theme");
    if (param === "system" || param === "light" || param === "dark") return param;
  } catch {
    // 忽略解析异常，回退 system
  }
  return "system";
}

/**
 * 读取 ?osDark=true|false 查询参数作为首帧系统深色状态（主进程注入）。
 * 仅接受 true/false，其余（含缺省）返回 undefined，让 applyTheme 回退 matchMedia。
 */
export function readInitialOsDarkFromUrl(): boolean | undefined {
  try {
    const param = new URLSearchParams(window.location.search).get("osDark");
    if (param === "true") return true;
    if (param === "false") return false;
  } catch {
    // 忽略解析异常
  }
  return undefined;
}
