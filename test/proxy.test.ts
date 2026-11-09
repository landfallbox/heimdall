import assert from "node:assert/strict";
import { createServer, get as httpGet, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isNoProxyHost, normalizeProxyUrl, resolveProxyUrl } from "../gui/electron/proxy.ts";
import { fetchWithProxy } from "../gui/electron/updater.ts";

// ---------- normalizeProxyUrl ----------
assert.equal(normalizeProxyUrl("127.0.0.1:7890"), "http://127.0.0.1:7890/");
assert.equal(normalizeProxyUrl("http://proxy.example.com:8080"), "http://proxy.example.com:8080/");
assert.equal(normalizeProxyUrl("https://proxy.example.com:8443"), "https://proxy.example.com:8443/");
assert.equal(normalizeProxyUrl("socks5://proxy.example.com:1080"), null);
assert.equal(normalizeProxyUrl(""), null);
assert.equal(normalizeProxyUrl("not a url"), null);

// ---------- isNoProxyHost ----------
assert.equal(isNoProxyHost("github.com", "localhost,127.0.0.1"), false);
assert.equal(isNoProxyHost("github.com", "github.com"), true);
assert.equal(isNoProxyHost("api.github.com", "github.com"), true);
assert.equal(isNoProxyHost("notgithub.com", "github.com"), false);
assert.equal(isNoProxyHost("anything.com", "*"), true);
assert.equal(isNoProxyHost("github.com", undefined), false);

// ---------- resolveProxyUrl ----------
const PROXY_ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy"];
const savedEnv: Record<string, string | undefined> = {};
for (const key of PROXY_ENV_KEYS) {
  savedEnv[key] = process.env[key];
  delete process.env[key];
}

try {
  // 环境变量优先（https 目标先看 HTTPS_PROXY）
  process.env.HTTPS_PROXY = "127.0.0.1:7890";
  assert.equal(resolveProxyUrl("https://github.com/x"), "http://127.0.0.1:7890/");
  // http 目标优先 HTTP_PROXY
  process.env.HTTP_PROXY = "10.0.0.1:3128";
  assert.equal(resolveProxyUrl("http://github.com/x"), "http://10.0.0.1:3128/");
  assert.equal(resolveProxyUrl("https://github.com/x"), "http://127.0.0.1:7890/");
  // NO_PROXY 命中则直连
  process.env.NO_PROXY = "github.com";
  assert.equal(resolveProxyUrl("https://github.com/x"), null);
  assert.equal(resolveProxyUrl("https://api.github.com/x"), null);
  delete process.env.NO_PROXY;
  assert.equal(resolveProxyUrl("https://github.com/x"), "http://127.0.0.1:7890/");

  // 无环境变量时回退系统代理（注入读取器）
  delete process.env.HTTPS_PROXY;
  delete process.env.HTTP_PROXY;
  assert.equal(
    resolveProxyUrl("https://github.com/x", { systemProxyReader: () => "192.168.1.10:8080" }),
    "http://192.168.1.10:8080/",
  );
  assert.equal(resolveProxyUrl("https://github.com/x", { systemProxyReader: () => null }), null);
  assert.equal(resolveProxyUrl("https://github.com/x", { systemProxyReader: () => "socks5://bad:1080" }), null);

  // 非法 URL 返回 null
  assert.equal(resolveProxyUrl("not a url"), null);
} finally {
  for (const key of PROXY_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
}

// ---------- fetchWithProxy 集成：本地正向代理验证请求确实经代理转发 ----------
const targetServer: Server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`hello-target ${req.url}`);
});
await new Promise<void>((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
const targetPort = (targetServer.address() as AddressInfo).port;

const proxyHits: string[] = [];
const proxyServer: Server = createServer((req, res) => {
  proxyHits.push(req.url || "");
  if (!req.url) {
    res.writeHead(400);
    res.end();
    return;
  }
  httpGet(req.url, (upstream) => {
    res.writeHead(upstream.statusCode || 502, upstream.headers);
    upstream.pipe(res);
  }).on("error", () => {
    res.writeHead(502);
    res.end();
  });
});
await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", resolve));
const proxyPort = (proxyServer.address() as AddressInfo).port;

try {
  // 配置代理后，请求必须经代理转发
  process.env.HTTP_PROXY = `127.0.0.1:${proxyPort}`;
  const viaProxy = await fetchWithProxy(`http://127.0.0.1:${targetPort}/via-proxy`);
  assert.equal(viaProxy.status, 200);
  assert.equal(await viaProxy.text(), "hello-target /via-proxy");
  assert.deepEqual(proxyHits, [`http://127.0.0.1:${targetPort}/via-proxy`]);

  // NO_PROXY 命中时直连，不再经过代理
  process.env.NO_PROXY = "*";
  const direct = await fetchWithProxy(`http://127.0.0.1:${targetPort}/direct`);
  assert.equal(direct.status, 200);
  assert.equal(await direct.text(), "hello-target /direct");
  assert.equal(proxyHits.length, 1);
} finally {
  delete process.env.HTTP_PROXY;
  delete process.env.NO_PROXY;
  targetServer.close();
  proxyServer.close();
}

console.log("proxy tests passed");
