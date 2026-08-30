import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { FeishuApiError, createFeishuSnapshotFetcher } from "./service.js";

const environment = process.env;
const fetchSnapshot = createFeishuSnapshotFetcher({ environment });
const port = Number(environment.PORT || 9000);

function writeJson(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

function isSameSecret(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

function requestToken(request) {
  const match = String(request.headers.authorization ?? "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

createServer(async (request, response) => {
  const configuredOrigin = String(environment.ALLOWED_ORIGIN ?? "").trim();
  const origin = String(request.headers.origin ?? "").trim();
  const allowedOrigin = origin && origin === configuredOrigin ? origin : configuredOrigin;
  const headers = configuredOrigin ? corsHeaders(allowedOrigin) : {};

  if (!configuredOrigin) {
    writeJson(response, 500, { error: "同步服务尚未配置允许的网页来源" });
    return;
  }
  if (origin && origin !== configuredOrigin) {
    writeJson(response, 403, { error: "网页来源不被允许" });
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (request.method !== "GET") {
    writeJson(response, 405, { error: "只允许 GET 请求" }, { ...headers, Allow: "GET, OPTIONS" });
    return;
  }
  if (!["/", "/jobtrail-sync"].includes(new URL(request.url, "http://localhost").pathname)) {
    writeJson(response, 404, { error: "接口不存在" }, headers);
    return;
  }

  const expectedToken = String(environment.JOBTRAIL_SYNC_TOKEN ?? "").trim();
  if (expectedToken.length < 16 || !isSameSecret(requestToken(request), expectedToken)) {
    writeJson(response, 401, { error: "同步认证失败" }, headers);
    return;
  }

  try {
    writeJson(response, 200, await fetchSnapshot(), headers);
  } catch (error) {
    const isConfigurationError = String(error?.message ?? "").startsWith("Missing required environment variable:");
    const code = error instanceof FeishuApiError && error.code ? `（${error.code}）` : "";
    console.error("Feishu sync request failed", {
      name: error?.name,
      code: error?.code,
      message: error?.message,
    });
    writeJson(
      response,
      isConfigurationError ? 500 : 502,
      { error: isConfigurationError ? "同步服务环境变量未配置完整" : `读取飞书失败${code}` },
      headers,
    );
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`JobTrail Feishu sync service listening on port ${port}`);
});
