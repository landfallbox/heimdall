import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { createLogger, type Logger } from "./logger.ts";
import { convertRequestBody, convertResponseBody, isProtocolError, normalizeRequestFormat } from "./openai-protocol.ts";
import { loadRuntimeConfig, runtimeRoot, type RuntimeConfig, type RuntimeVendor } from "./runtime-config.ts";
import { createUsageStore, type UsageStore } from "./usage-store.ts";
import { estimateUsageCost, normalizeUsage, resolveModelPricing, type Usage } from "./usage.ts";
import { VendorCircuitBreaker, type CircuitPermission } from "./vendor-circuit-breaker.ts";
import type { NormalizedVendorModel, RequestFormat } from "./config.ts";

type VendorWithModel = RuntimeVendor & { selectedModel: NormalizedVendorModel };

type Runtime = {
  config: RuntimeConfig;
  circuitBreaker: VendorCircuitBreaker;
  configRevision: string;
  restartFields: string[];
};

type VendorFailure = {
  vendor: string;
  elapsedMs: number;
  errorName?: string;
  errorMessage?: string;
  errorType?: string;
  statusCode?: number;
  bodyBytes?: number;
  protocolFailure?: boolean;
};

type ReloadResult = {
  ok: boolean;
  applied: boolean;
  configRevision: string;
  restartRequired: boolean;
  restartFields: string[];
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const RESTART_REQUIRED_FIELDS = ["router.host", "router.port", "router.logFile"];
const CONFIG_WATCH_DEBOUNCE_MS = 200;

function sendParentMessage(message: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== "function" || !process.connected) {
      reject(new Error("Parent IPC channel is disconnected."));
      return;
    }

    try {
      process.send(message, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function runtimeConfigRevision(config: RuntimeConfig): string {
  const runtimeConfig = {
    router: config.router,
    model: config.model,
    vendors: config.vendors,
  };
  return createHash("sha256").update(JSON.stringify(runtimeConfig)).digest("hex");
}

function getConfigValue(config: unknown, path: string): unknown {
  return path.split(".").reduce((value, key) => (value as any)?.[key], config);
}

function prepareReloadedConfig(currentConfig: RuntimeConfig, nextConfig: RuntimeConfig) {
  const restartFields = RESTART_REQUIRED_FIELDS.filter(
    (field) => getConfigValue(currentConfig, field) !== getConfigValue(nextConfig, field),
  );
  const effectiveConfig = structuredClone(nextConfig);

  for (const field of restartFields) {
    const [, key] = field.split(".");
    (effectiveConfig.router as any)[key] = currentConfig.router[key as keyof RuntimeConfig["router"]];
  }

  return { effectiveConfig, restartFields };
}

function getRequestPath(req: http.IncomingMessage): string {
  const url = new URL(req.url ?? "", "http://127.0.0.1");
  return url.pathname.replace(/\/+$/, "") || "/";
}

function isAuthorized(req: http.IncomingMessage, config: RuntimeConfig, path: string): boolean {
  const managementToken = process.env.HEIMDALL_MANAGEMENT_TOKEN;
  if (path === "/health" && managementToken && req.headers["x-router-management-token"] === managementToken) {
    return true;
  }

  const expectedKey = config.router.apiKey;
  if (!expectedKey) {
    return true;
  }

  const authorization = req.headers.authorization || "";
  return authorization === `Bearer ${expectedKey}`;
}

async function readJsonBody(req: http.IncomingMessage, maxBodyBytes: number): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      const error = new Error(`Request body exceeds maxBodyBytes (${maxBodyBytes}).`) as Error & { statusCode?: number };
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
}

function buildUpstreamUrl(vendor: RuntimeVendor, requestFormat: RequestFormat): string {
  const baseUrl = vendor.baseUrl.replace(/\/+$/, "");
  const path = requestFormat === "responses"
    ? vendor.responsesPath || "/responses"
    : vendor.chatCompletionsPath || "/chat/completions";
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function buildUpstreamHeaders(vendor: RuntimeVendor): Record<string, string> {
  const apiKeyHeader = vendor.apiKeyHeader || "authorization";
  const authenticationHeader = apiKeyHeader === "authorization"
    ? `Bearer ${vendor.apiKey}`
    : vendor.apiKey;

  return {
    ...(vendor.apiKey ? { [apiKeyHeader]: authenticationHeader } : {}),
    "content-type": "application/json",
  };
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    cancel: () => clearTimeout(timeout),
  };
}

function linkClientAbort(req: http.IncomingMessage, res: http.ServerResponse, abort: () => void): () => void {
  const abortClosedResponse = () => {
    if (!res.writableEnded) {
      abort();
    }
  };
  req.once("aborted", abort);
  res.once("close", abortClosedResponse);
  return () => {
    req.off("aborted", abort);
    res.off("close", abortClosedResponse);
  };
}

async function callVendor(vendor: VendorWithModel, requestBody: any, inboundFormat: RequestFormat, signal: AbortSignal, logger: Logger) {
  const upstreamFormat = normalizeRequestFormat(vendor.requestFormat);
  const body = convertRequestBody(requestBody, inboundFormat, upstreamFormat, vendor.selectedModel.id);

  if (vendor.selectedModel?.enableThinking === true) {
    body.chat_template_kwargs = { ...(body.chat_template_kwargs || {}), enable_thinking: true };
  }

  logger.debug("upstream_request", {
    vendor: vendor.name,
    url: buildUpstreamUrl(vendor, upstreamFormat),
    body,
  });

  const response = await fetch(buildUpstreamUrl(vendor, upstreamFormat), {
    method: "POST",
    headers: buildUpstreamHeaders(vendor),
    body: JSON.stringify(body),
    signal,
  });
  return { response, upstreamFormat };
}

function shouldFallback(statusCode: number, config: RuntimeConfig): boolean {
  return config.router.fallbackStatusCodes.includes(statusCode) || statusCode >= 500;
}

async function readBoundedText(response: Response, maxBytes = 64 * 1024): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Buffer[] = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total <= maxBytes) {
      chunks.push(Buffer.from(value));
    }

    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
  }

  return Buffer.concat(chunks).toString("utf8");
}

function summarizeUpstreamError(statusCode: number, body: string) {
  const text = String(body || "").trim();
  let errorType = "upstream_error";

  try {
    const parsed = JSON.parse(text);
    if (parsed?.error?.type) {
      errorType = String(parsed.error.type);
    } else if (parsed?.error?.code) {
      errorType = String(parsed.error.code);
    }
  } catch {
    errorType = text ? "upstream_text_error" : "upstream_empty_error";
  }

  return {
    statusCode,
    errorType,
    bodyBytes: Buffer.byteLength(text, "utf8"),
  };
}

function copyUpstreamHeaders(upstream: Response, res: http.ServerResponse, vendorName: string) {
  for (const [key, value] of upstream.headers.entries()) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      res.setHeader(key, value);
    }
  }
  res.setHeader("x-router-vendor", vendorName);
}

async function pipeUpstreamWithUsage(upstream: Response, res: http.ServerResponse, format: RequestFormat, logger: Logger): Promise<Usage | null> {
  if (!upstream.body) {
    res.end();
    return null;
  }

  let usage: Usage | null = null;
  const tracker = createSseUsageTracker(format, (nextUsage) => {
    usage = nextUsage;
  }, logger);
  await pipeline(Readable.fromWeb(upstream.body as unknown as import("node:stream/web").ReadableStream), tracker, res);
  return usage;
}

function createSseUsageTracker(format: RequestFormat, onUsage: (usage: Usage) => void, logger: Logger) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let sseChunkCount = 0;

  function inspectText(text: string, flush = false) {
    pending += text;
    const lines = pending.split(/\r?\n/);
    pending = flush ? "" : lines.pop() || "";
    for (const line of lines) {
      const payload = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!payload || payload === "[DONE]") {
        continue;
      }
      try {
        const event = JSON.parse(payload);
        if (sseChunkCount < 5) {
          sseChunkCount++;
          logger.debug("upstream_sse_chunk", { index: sseChunkCount, payload });
        }
        const usage = normalizeUsage(event, format) || normalizeUsage(event.response, format);
        if (usage) {
          onUsage(usage);
        }
      } catch {
        // Non-JSON SSE events are forwarded unchanged and do not contribute usage.
      }
    }
  }

  return new Transform({
    transform(chunk, _encoding, callback) {
      inspectText(decoder.write(chunk));
      callback(null, chunk);
    },
    flush(callback) {
      inspectText(decoder.end(), true);
      callback();
    },
  });
}

function recordUsage(usageStore: UsageStore, logger: Logger, context: { requestId: string; vendor: string; model: string; format: RequestFormat; stream: boolean }, usage: Usage | null, customPricing: unknown) {
  const pricing = resolveModelPricing(context.model, customPricing);
  const cost = estimateUsageCost(usage, pricing);
  void usageStore.record({ ...context, usage, cost }).catch(() => null);
  logger.info("usage_recorded", {
    requestId: context.requestId,
    vendor: context.vendor,
    model: context.model,
    stream: context.stream,
    usageKnown: Boolean(usage),
    totalTokens: usage?.totalTokens,
    costAmount: cost?.amount,
    costCurrency: cost?.currency,
    pricingSource: pricing?.source,
  });
}

async function handleGeneration(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: RuntimeConfig,
  logger: Logger,
  circuitBreaker: VendorCircuitBreaker,
  usageStore: UsageStore,
  inboundFormat: RequestFormat,
) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const requestBody = await readJsonBody(req, config.router.maxBodyBytes);
  logger.debug("inbound_request", { requestId, body: requestBody });
  const requestedModel = String(requestBody.model || config.model.id).trim() || config.model.id;
  const vendors = getVendorsForModel(config.vendors, requestedModel);
  const failures: VendorFailure[] = [];

  if (!vendors.length) {
    sendJson(res, 404, {
      error: {
        message: `No enabled vendor supports model: ${requestedModel}`,
        type: "model_not_found",
        model: requestedModel,
      },
    });
    return;
  }

  const candidates = circuitBreaker.candidates(vendors, requestedModel);
  for (const { vendor, forced } of candidates) {
    const circuitPermission = circuitBreaker.acquire(vendor, requestedModel, { forced });
    if (!circuitPermission) {
      continue;
    }

    const vendorStartedAt = Date.now();
    const timeout = createTimeoutSignal(vendor.timeoutMs);
    const unlinkClientAbort = linkClientAbort(req, res, timeout.abort);

    try {
      logger.info("vendor_request_started", {
        requestId,
        vendor: vendor.name,
        model: requestedModel,
        inboundFormat,
        upstreamFormat: normalizeRequestFormat(vendor.requestFormat),
        stream: requestBody.stream === true,
        circuitProbe: circuitPermission.probe,
        circuitForcedProbe: circuitPermission.forced,
      });

      const { response: upstream, upstreamFormat } = await callVendor(vendor, requestBody, inboundFormat, timeout.signal, logger);
      // requestTimeoutMs limits connection and response-header wait time. Once a
      // vendor responds, long-running streams may continue until completion or
      // until the client disconnects.
      timeout.cancel();
      const elapsedMs = Date.now() - vendorStartedAt;

      if (!upstream.ok) {
        const errorText = await readBoundedText(upstream);
        const failure: VendorFailure = {
          vendor: vendor.name,
          elapsedMs,
          ...summarizeUpstreamError(upstream.status, errorText),
        };
        failures.push(failure);

        logger.warn("vendor_request_failed_status", {
          requestId,
          ...failure,
        });

        if (shouldFallback(upstream.status, config)) {
          recordCircuitFailure(circuitBreaker, circuitPermission, logger, {
            requestId,
            vendor: vendor.name,
            model: requestedModel,
            reason: `http_${upstream.status}`,
          });
          continue;
        }

        recordCircuitSuccess(circuitBreaker, circuitPermission, logger, {
          requestId,
          vendor: vendor.name,
          model: requestedModel,
        });
        res.statusCode = upstream.status;
        res.setHeader("content-type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
        res.setHeader("x-router-vendor", vendor.name);
        res.end(errorText);
        return;
      }

      logger.info("vendor_request_selected", {
        requestId,
        vendor: vendor.name,
        model: requestedModel,
        statusCode: upstream.status,
        elapsedMs,
        totalElapsedMs: Date.now() - startedAt,
      });

      recordCircuitSuccess(circuitBreaker, circuitPermission, logger, {
        requestId,
        vendor: vendor.name,
        model: requestedModel,
      });
      res.statusCode = upstream.status;
      const responseIsStream = Boolean(upstreamFormat === inboundFormat && (
        requestBody.stream === true || upstream.headers.get("content-type")?.includes("text/event-stream")
      ));
      const usageContext = {
        requestId,
        vendor: vendor.name,
        model: requestedModel,
        format: upstreamFormat,
        stream: responseIsStream,
      };
      if (responseIsStream) {
        copyUpstreamHeaders(upstream, res, vendor.name);
        const usage = await pipeUpstreamWithUsage(upstream, res, upstreamFormat, logger);
        recordUsage(usageStore, logger, usageContext, usage, vendor.selectedModel.pricing);
      } else {
        const upstreamText = await upstream.text();
        let upstreamBody: any = null;
        try {
          upstreamBody = JSON.parse(upstreamText);
        } catch (error) {
          if (upstreamFormat !== inboundFormat) {
            throw error;
          }
        }
        const usage = normalizeUsage(upstreamBody, upstreamFormat);
        if (upstreamFormat === inboundFormat) {
          copyUpstreamHeaders(upstream, res, vendor.name);
          res.end(upstreamText);
        } else {
          const convertedBody = convertResponseBody(upstreamBody, upstreamFormat, inboundFormat);
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.setHeader("x-router-vendor", vendor.name);
          res.end(JSON.stringify(convertedBody));
        }
        recordUsage(usageStore, logger, usageContext, usage, vendor.selectedModel.pricing);
      }
      return;
    } catch (error) {
      const protocolError = isProtocolError(error) ? error : null;
      const isProtocolFailure = protocolError !== null && protocolError.statusCode === 400 && Boolean(protocolError.errorType);
      const failure: VendorFailure = {
        vendor: vendor.name,
        elapsedMs: Date.now() - vendorStartedAt,
        errorName: (error as Error).name,
        errorMessage: (error as Error).message,
        errorType: protocolError?.errorType,
        ...(isProtocolFailure ? { protocolFailure: true } : {}),
      };
      failures.push(failure);

      logger.warn("vendor_request_failed_error", {
        requestId,
        ...failure,
      });

      if (req.aborted || res.destroyed) {
        circuitBreaker.release(circuitPermission);
        return;
      }

      // Once response bytes are committed, another vendor would corrupt the stream
      // and may duplicate a billable upstream request.
      if (res.headersSent) {
        circuitBreaker.release(circuitPermission);
        res.destroy(error as Error);
        return;
      }

      if (isProtocolFailure) {
        circuitBreaker.release(circuitPermission);
        continue;
      }

      recordCircuitFailure(circuitBreaker, circuitPermission, logger, {
        requestId,
        vendor: vendor.name,
        model: requestedModel,
        reason: (error as Error).name === "AbortError" ? "timeout" : "network_error",
      });
    } finally {
      unlinkClientAbort();
      timeout.cancel();
    }
  }

  logger.error("all_vendors_failed", {
    requestId,
    totalElapsedMs: Date.now() - startedAt,
    failures,
  });

  const protocolFailures = failures.filter((failure) => failure.protocolFailure);
  if (protocolFailures.length === failures.length && protocolFailures.length) {
    sendJson(res, 400, {
      error: {
        message: protocolFailures[0].errorMessage,
        type: protocolFailures[0].errorType,
      },
    });
    return;
  }

  sendJson(res, 502, {
    error: {
      message: "All configured vendors failed before a response could be returned.",
      type: "router_error",
      request_id: requestId,
      failures,
    },
  });
}

function recordCircuitFailure(circuitBreaker: VendorCircuitBreaker, permission: CircuitPermission, logger: Logger, context: Record<string, unknown>) {
  const transition = circuitBreaker.recordFailure(permission);
  if (transition.opened) {
    logger.warn("vendor_circuit_opened", {
      ...context,
      durationMs: transition.durationMs,
      ejectionCount: transition.ejectionCount,
      retryAt: transition.retryAt,
    });
  }
}

function recordCircuitSuccess(circuitBreaker: VendorCircuitBreaker, permission: CircuitPermission, logger: Logger, context: Record<string, unknown>) {
  const transition = circuitBreaker.recordSuccess(permission);
  if (transition.closed) {
    logger.info("vendor_circuit_closed", {
      ...context,
      ejectionCount: transition.ejectionCount,
    });
  }
}

function getVendorsForModel(vendors: RuntimeVendor[], requestedModel: string): VendorWithModel[] {
  return vendors.flatMap((vendor) => {
    const selectedModel = vendor.models.find((model) => model.enabled !== false && model.id === requestedModel);
    return selectedModel ? [{ ...vendor, selectedModel }] : [];
  });
}

function handleModels(_req: http.IncomingMessage, res: http.ServerResponse, config: RuntimeConfig) {
  const modelIds = [...new Set(config.vendors.flatMap((vendor) => vendor.models
    .filter((model) => model.enabled !== false)
    .map((model) => model.id)))];

  sendJson(res, 200, {
    object: "list",
    data: modelIds.map((id) => ({
      id,
      object: "model",
      owned_by: config.model.ownedBy,
    })),
  });
}

function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse, runtime: Runtime) {
  const { config, circuitBreaker } = runtime;
  sendJson(res, 200, {
    ok: true,
    instanceId: process.env.HEIMDALL_INSTANCE_ID || "",
    configRevision: runtime.configRevision,
    restartRequired: runtime.restartFields.length > 0,
    restartFields: runtime.restartFields,
    model: config.model.id,
    vendorCount: config.vendors.length,
    vendors: config.vendors.map((vendor) => ({
      name: vendor.name,
      priority: vendor.priority,
      models: vendor.models.map((model) => ({
        id: model.id,
        enabled: model.enabled !== false,
        circuit: circuitBreaker.snapshot(vendor, model.id),
      })),
      enabled: vendor.enabled !== false,
    })),
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  runtime: Runtime,
  logger: Logger,
  usageStore: UsageStore,
) {
  const { config, circuitBreaker } = runtime;
  const path = getRequestPath(req);

  try {
    if (!isAuthorized(req, config, path)) {
      sendJson(res, 401, {
        error: {
          message: "Invalid router API key.",
          type: "authentication_error",
        },
      });
      return;
    }

    if (req.method === "GET" && path === "/health") {
      handleHealth(req, res, runtime);
      return;
    }

    if (req.method === "GET" && path === "/v1/models") {
      handleModels(req, res, config);
      return;
    }

    if (req.method === "POST" && path === "/v1/chat/completions") {
      await handleGeneration(req, res, config, logger, circuitBreaker, usageStore, "chat-completions");
      return;
    }

    if (req.method === "POST" && path === "/v1/responses") {
      await handleGeneration(req, res, config, logger, circuitBreaker, usageStore, "responses");
      return;
    }

    sendJson(res, 404, {
      error: {
        message: `Unsupported route: ${req.method} ${path}`,
        type: "not_found",
      },
    });
  } catch (error) {
    logger.error("request_failed", {
      path,
      method: req.method,
      errorName: (error as Error).name,
      errorMessage: (error as Error).message,
    });

    if (!res.headersSent) {
      const protocolError = isProtocolError(error) ? error : null;
      sendJson(res, protocolError?.statusCode || 500, {
        error: {
          message: (error as Error).message,
          type: protocolError?.errorType || "router_error",
          ...(protocolError?.parameter ? { param: protocolError.parameter } : {}),
        },
      });
    } else {
      res.destroy(error as Error);
    }
  }
}

function main() {
  const { config, configPath } = loadRuntimeConfig();
  const logger = createLogger(config, runtimeRoot);
  const usageStore = createUsageStore(runtimeRoot, {
    onError: (error, entry) => logger.error("usage_write_failed", {
      requestId: entry.requestId,
      errorName: error.name,
      errorMessage: error.message,
    }),
  });
  let runtime: Runtime = {
    config,
    circuitBreaker: new VendorCircuitBreaker(),
    configRevision: runtimeConfigRevision(config),
    restartFields: [],
  };
  let reloadQueue: Promise<void> = Promise.resolve();
  let configWatcher: FSWatcher | null = null;
  let configWatchTimer: NodeJS.Timeout | null = null;
  let stopping = false;

  const server = http.createServer((req, res) => {
    const snapshot = runtime;
    void handleRequest(req, res, snapshot, logger, usageStore);
  });

  const reloadRuntimeConfig = (source: string): Promise<ReloadResult> => {
    const operation = reloadQueue.then((): ReloadResult => {
      const loaded = loadRuntimeConfig();
      const nextRevision = runtimeConfigRevision(loaded.config);
      if (nextRevision === runtime.configRevision) {
        return {
          ok: true,
          applied: false,
          configRevision: runtime.configRevision,
          restartRequired: runtime.restartFields.length > 0,
          restartFields: runtime.restartFields,
        };
      }

      const { effectiveConfig, restartFields } = prepareReloadedConfig(runtime.config, loaded.config);
      runtime = {
        config: effectiveConfig,
        circuitBreaker: new VendorCircuitBreaker(),
        configRevision: nextRevision,
        restartFields,
      };
      logger.info("config_reloaded", {
        source,
        configRevision: nextRevision,
        restartRequired: restartFields.length > 0,
        restartFields,
      });
      return {
        ok: true,
        applied: true,
        configRevision: nextRevision,
        restartRequired: restartFields.length > 0,
        restartFields,
      };
    });

    reloadQueue = operation.then(
      () => undefined,
      (error) => {
        logger.error("config_reload_failed", {
          source,
          errorName: (error as Error).name,
          errorMessage: (error as Error).message,
        });
      },
    );
    return operation;
  };

  const scheduleWatchedReload = () => {
    if (configWatchTimer) {
      clearTimeout(configWatchTimer);
    }
    configWatchTimer = setTimeout(() => {
      configWatchTimer = null;
      void reloadRuntimeConfig("file-watch").catch(() => null);
    }, CONFIG_WATCH_DEBOUNCE_MS);
  };

  try {
    const configDirectory = realpathSync.native(dirname(configPath));
    configWatcher = watch(configDirectory, (_eventType, filename) => {
      if (!filename || String(filename) === basename(configPath)) {
        scheduleWatchedReload();
      }
    });
    configWatcher.on("error", (error) => {
      logger.error("config_watch_failed", { errorName: error.name, errorMessage: error.message });
    });
  } catch (error) {
    logger.error("config_watch_failed", { errorName: (error as Error).name, errorMessage: (error as Error).message });
  }

  server.listen(config.router.port, config.router.host, () => {
    logger.info("router_started", {
      host: config.router.host,
      port: config.router.port,
      configPath,
      model: config.model.id,
      vendors: config.vendors.map((vendor) => vendor.name),
    });
  });

  const stopRouter = (reason: string) => {
    if (stopping) {
      return;
    }

    stopping = true;
    if (configWatchTimer) {
      clearTimeout(configWatchTimer);
    }
    configWatcher?.close();
    logger.info("router_stopping", { reason });
    server.close(() => {
      void usageStore.close().finally(() => logger.close(() => process.exit(0)));
    });
    server.closeIdleConnections();
    if (reason === "parent_disconnect") {
      server.closeAllConnections();
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => stopRouter(signal));
  }

  if (typeof process.send === "function") {
    process.on("message", (message: any) => {
      if (message?.type === "shutdown") {
        stopRouter("parent_request");
        return;
      }
      if (message?.type === "reload-config" && message.requestId) {
        void (async () => {
          let response: any;
          try {
            const result = await reloadRuntimeConfig("parent-request");
            response = {
              type: "config-reloaded",
              requestId: message.requestId,
              ...result,
            };
          } catch (error) {
            response = {
              type: "config-reload-failed",
              requestId: message.requestId,
              ok: false,
              error: (error as Error).message || String(error),
            };
          }

          try {
            await sendParentMessage(response);
          } catch (error) {
            logger.error("config_reload_response_failed", {
              requestId: message.requestId,
              responseType: response.type,
              errorName: (error as Error).name,
              errorMessage: (error as Error).message,
            });
          }
        })();
      }
    });
    process.on("disconnect", () => stopRouter("parent_disconnect"));
  }
}

main();
