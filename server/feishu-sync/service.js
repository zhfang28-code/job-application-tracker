const FEISHU_API_BASE = "https://open.feishu.cn/open-apis";

export class FeishuApiError extends Error {
  constructor(message, code = "") {
    super(message);
    this.name = "FeishuApiError";
    this.code = code;
  }
}

function requiredEnvironment(environment, key) {
  const value = String(environment[key] ?? "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function cellText(cell) {
  if (cell == null) return "";
  if (["string", "number", "boolean"].includes(typeof cell)) return String(cell).trim();
  if (Array.isArray(cell)) return cell.map(cellText).filter(Boolean).join("；");
  if (typeof cell !== "object") return "";
  for (const key of ["link", "url", "href", "email", "text", "name", "value", "label"]) {
    const value = cellText(cell[key]);
    if (value) return value;
  }
  return "";
}

async function readJsonResponse(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new FeishuApiError(`Feishu returned HTTP ${response.status} without JSON`);
  }
  if (!response.ok || (payload.code != null && payload.code !== 0)) {
    throw new FeishuApiError(
      payload.msg || payload.message || `Feishu returned HTTP ${response.status}`,
      payload.code ?? response.status,
    );
  }
  return payload;
}

function fieldConfiguration(environment) {
  return {
    company: String(environment.FEISHU_FIELD_COMPANY || "投递公司").trim(),
    applicationTarget: String(environment.FEISHU_FIELD_TARGET || "链接/邮箱").trim(),
    appliedAt: String(environment.FEISHU_FIELD_APPLIED_AT || "投递时间").trim(),
    position: String(environment.FEISHU_FIELD_POSITION || "岗位").trim(),
    progress: String(environment.FEISHU_FIELD_PROGRESS || "目前的进度").trim(),
  };
}

export function createFeishuSnapshotFetcher({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  let tokenCache = null;
  let appTokenCache = "";

  async function tenantAccessToken() {
    const currentTime = now().getTime();
    if (tokenCache && tokenCache.expiresAt > currentTime + 60_000) return tokenCache.value;
    const response = await fetchImpl(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: requiredEnvironment(environment, "FEISHU_APP_ID"),
        app_secret: requiredEnvironment(environment, "FEISHU_APP_SECRET"),
      }),
    });
    const payload = await readJsonResponse(response);
    const value = String(payload.tenant_access_token ?? "").trim();
    if (!value) throw new FeishuApiError("Feishu did not return tenant_access_token");
    const lifetimeSeconds = Number(payload.expire) || 7200;
    tokenCache = { value, expiresAt: currentTime + lifetimeSeconds * 1000 };
    return value;
  }

  async function appToken(token) {
    const configuredToken = String(environment.FEISHU_APP_TOKEN ?? "").trim();
    if (configuredToken) return configuredToken;
    if (appTokenCache) return appTokenCache;
    const wikiToken = requiredEnvironment(environment, "FEISHU_WIKI_TOKEN");
    const url = new URL(`${FEISHU_API_BASE}/wiki/v2/spaces/get_node`);
    url.searchParams.set("token", wikiToken);
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await readJsonResponse(response);
    const node = payload.data?.node;
    const value = String(node?.obj_token ?? "").trim();
    if (!value) throw new FeishuApiError("Wiki node did not contain a Base app token");
    if (node?.obj_type && node.obj_type !== "bitable") {
      throw new FeishuApiError(`Wiki node is ${node.obj_type}, not bitable`);
    }
    appTokenCache = value;
    return value;
  }

  async function listRecords(token, baseToken, fields) {
    const tableId = requiredEnvironment(environment, "FEISHU_TABLE_ID");
    const viewId = String(environment.FEISHU_VIEW_ID ?? "").trim();
    const requestedFieldNames = Object.values(fields);
    const records = [];
    let pageToken = "";

    do {
      const url = new URL(
        `${FEISHU_API_BASE}/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/records`,
      );
      url.searchParams.set("page_size", "500");
      url.searchParams.set("field_names", JSON.stringify(requestedFieldNames));
      if (viewId) url.searchParams.set("view_id", viewId);
      if (pageToken) url.searchParams.set("page_token", pageToken);
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await readJsonResponse(response);
      const items = Array.isArray(payload.data?.items) ? payload.data.items : [];
      records.push(...items);
      pageToken = payload.data?.has_more ? String(payload.data.page_token ?? "") : "";
      if (payload.data?.has_more && !pageToken) {
        throw new FeishuApiError("Feishu pagination did not return page_token");
      }
    } while (pageToken);

    return records;
  }

  return async function fetchSnapshot() {
    const fields = fieldConfiguration(environment);
    const token = await tenantAccessToken();
    const baseToken = await appToken(token);
    const records = await listRecords(token, baseToken, fields);

    return {
      source: "feishu",
      syncedAt: now().toISOString(),
      records: records.map((record) => ({
        recordId: String(record.record_id ?? record.id ?? "").trim(),
        company: cellText(record.fields?.[fields.company]),
        applicationTarget: cellText(record.fields?.[fields.applicationTarget]),
        appliedAt: cellText(record.fields?.[fields.appliedAt]),
        position: cellText(record.fields?.[fields.position]),
        progress: cellText(record.fields?.[fields.progress]),
        sourceUpdatedAt: cellText(record.last_modified_time ?? record.updated_at),
      })),
    };
  };
}
