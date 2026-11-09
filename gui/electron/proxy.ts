import { spawnSync } from "node:child_process";

export interface ProxyResolutionOptions {
  /** 可注入的系统代理读取器（默认读 Windows WinINET 注册表），便于测试。 */
  systemProxyReader?: () => string | null;
}

const WINDOWS_PROXY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const SYSTEM_PROXY_TTL_MS = 60_000;

function envValue(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

/** 归一化代理地址：补 http:// 前缀，只接受 http/https 代理，非法值返回 null。 */
export function normalizeProxyUrl(value: string): string | null {
  let candidate = value.trim();
  if (!candidate) {
    return null;
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** 目标主机是否命中 NO_PROXY（支持 * 与域名后缀匹配）。 */
export function isNoProxyHost(host: string, noProxy?: string | null): boolean {
  if (!noProxy) {
    return false;
  }
  const normalizedHost = host.toLowerCase().replace(/^\[|\]$/g, "");
  for (const rawEntry of noProxy.split(",")) {
    const entry = rawEntry.trim().toLowerCase().replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
    if (!entry) {
      continue;
    }
    if (entry === "*" || normalizedHost === entry || normalizedHost.endsWith(`.${entry}`)) {
      return true;
    }
  }
  return false;
}

function readWindowsSystemProxy(): string | null {
  try {
    const output = spawnSync("reg", ["query", WINDOWS_PROXY_KEY], {
      encoding: "utf8",
      timeout: 3000,
      windowsHide: true,
    });
    if (output.status !== 0) {
      return null;
    }
    const text = output.stdout || "";
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.exec(text);
    const server = /ProxyServer\s+REG_SZ\s+(.+)/i.exec(text);
    if (!enabled || !server) {
      return null;
    }
    // ProxyServer 可能以分号列出多个代理，取第一个。
    return server[1].trim().split(";")[0].trim() || null;
  } catch {
    return null;
  }
}

let systemProxyCache: { at: number; value: string | null } | null = null;

/** 系统代理带 60s TTL 缓存，避免每次请求都同步 spawn reg query 阻塞主进程。 */
function cachedSystemProxy(): string | null {
  if (systemProxyCache && Date.now() - systemProxyCache.at < SYSTEM_PROXY_TTL_MS) {
    return systemProxyCache.value;
  }
  const value = readWindowsSystemProxy();
  systemProxyCache = { at: Date.now(), value };
  return value;
}

/**
 * 解析目标 URL 应使用的代理：
 * https 目标按 HTTPS_PROXY → HTTP_PROXY 顺序、http 目标按 HTTP_PROXY → HTTPS_PROXY 顺序
 * 读环境变量，均未配置时回退 Windows 系统代理（WinINET）。
 * 无代理或目标主机命中 NO_PROXY 时返回 null（直连）。
 */
export function resolveProxyUrl(targetUrl: string, options: ProxyResolutionOptions = {}): string | null {
  let host = "";
  let isHttps = false;
  try {
    const parsed = new URL(targetUrl);
    host = parsed.hostname;
    isHttps = parsed.protocol === "https:";
  } catch {
    return null;
  }

  if (isNoProxyHost(host, envValue(["NO_PROXY", "no_proxy"]))) {
    return null;
  }

  const envProxy = isHttps
    ? envValue(["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"])
    : envValue(["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"]);
  if (envProxy) {
    return normalizeProxyUrl(envProxy);
  }

  // 显式注入的 reader 跨平台生效（测试用）；默认 WinINET 读取器仅 Windows。
  const reader = options.systemProxyReader ?? (process.platform === "win32" ? cachedSystemProxy : null);
  if (reader) {
    const systemProxy = reader();
    if (systemProxy) {
      return normalizeProxyUrl(systemProxy);
    }
  }

  return null;
}
