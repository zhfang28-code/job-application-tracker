import {
  createApplication,
  makeId,
  normalizeApplication,
  normalizePipeline,
  stageById,
  toIsoDate,
} from "./model.js";

export const FEISHU_FIELD_ALIASES = Object.freeze({
  company: ["投递公司", "公司", "公司名称"],
  applicationTarget: ["链接/邮箱", "链接／邮箱", "投递链接/邮箱", "投递链接", "岗位链接", "邮箱"],
  appliedAt: ["投递时间", "投递日期", "申请时间", "申请日期"],
  position: ["岗位", "岗位名称", "职位", "职位名称"],
  progress: ["目前的进度", "目前进度", "当前进度", "进度", "状态"],
});

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFieldName(value) {
  return cleanText(String(value ?? ""))
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-/／()（）:：]/g, "");
}

export function feishuCellText(cell) {
  if (cell == null) return "";
  if (["string", "number", "boolean"].includes(typeof cell)) return String(cell).trim();
  if (Array.isArray(cell)) {
    return cell.map(feishuCellText).filter(Boolean).join("；");
  }
  if (typeof cell !== "object") return "";

  for (const key of ["link", "url", "href", "email", "text", "name", "value", "label"]) {
    const value = feishuCellText(cell[key]);
    if (value) return value;
  }
  return "";
}

function pickFeishuField(fields, aliases) {
  if (!fields || typeof fields !== "object") return "";
  const values = new Map(
    Object.entries(fields).map(([name, value]) => [normalizeFieldName(name), value]),
  );
  for (const alias of aliases) {
    const value = values.get(normalizeFieldName(alias));
    if (value != null) return feishuCellText(value);
  }
  return "";
}

function normalizeDateValue(value) {
  const text = cleanText(String(value ?? ""));
  if (!text) return "";
  let candidate = text;
  if (/^\d{10,13}$/.test(text)) {
    const timestamp = Number(text) * (text.length === 10 ? 1000 : 1);
    candidate = new Date(timestamp);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    candidate = `${text}T12:00:00`;
  }
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function splitApplicationTarget(value) {
  const target = cleanText(value).replace(/^mailto:/i, "");
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    return { jobUrl: "", applicationEmail: target };
  }
  return { jobUrl: target, applicationEmail: "" };
}

export function normalizeFeishuRecord(raw = {}) {
  const fields = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
  const recordId = cleanText(raw.recordId ?? raw.record_id ?? raw.id);
  const directTarget = raw.applicationTarget ?? raw.linkOrEmail ?? raw.link_or_email;
  const applicationTarget = feishuCellText(directTarget)
    || pickFeishuField(fields, FEISHU_FIELD_ALIASES.applicationTarget);
  const target = splitApplicationTarget(applicationTarget);
  const directAppliedAt = raw.appliedAt ?? raw.applied_at;

  return {
    recordId,
    company: feishuCellText(raw.company) || pickFeishuField(fields, FEISHU_FIELD_ALIASES.company),
    position: feishuCellText(raw.position) || pickFeishuField(fields, FEISHU_FIELD_ALIASES.position),
    ...target,
    appliedAt: normalizeDateValue(
      directAppliedAt ?? pickFeishuField(fields, FEISHU_FIELD_ALIASES.appliedAt),
    ),
    progress: feishuCellText(raw.progress) || pickFeishuField(fields, FEISHU_FIELD_ALIASES.progress),
    sourceUpdatedAt: normalizeDateValue(
      raw.sourceUpdatedAt ?? raw.updatedAt ?? raw.last_modified_time ?? raw.lastModifiedTime,
    ),
  };
}

export function mapFeishuProgress(value) {
  const raw = cleanText(value);
  const normalized = raw
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-/／()（）:：·.。]/g, "");

  const stageRules = [
    { stageId: "offer", pattern: /offer|录用|已接收/ },
    { stageId: "hr-interview", pattern: /hr面|人事面|人力面/ },
    { stageId: "ai-interview", pattern: /ai面|ai面试|智能面试/ },
    { stageId: "final-interview", pattern: /终面|最终面|三面|第三轮面/ },
    { stageId: "second-interview", pattern: /二面|第二轮面/ },
    { stageId: "first-interview", pattern: /一面|初面|第一轮面|群面/ },
    { stageId: "assessment", pattern: /在线测试|在线测评|测评|笔试|机试|作业|测试/ },
    { stageId: "applied", pattern: /已投递|投递完成|网申|简历筛选|待筛选|已申请/ },
  ];
  const stageId = stageRules.find((rule) => rule.pattern.test(normalized))?.stageId ?? null;

  let status = null;
  if (/未通过|不通过|淘汰|拒绝|不合适|挂了|感谢信/.test(normalized)) status = "rejected";
  else if (/撤回|放弃|终止申请|不再考虑/.test(normalized)) status = "withdrawn";
  else if (/暂停|搁置|冻结|延期/.test(normalized)) status = "paused";
  else if (stageId === "offer") status = "offer";
  else if (stageId) status = "active";

  return { raw, stageId, status, recognized: Boolean(stageId || status) };
}

function syncEvent(stageId, type, at, note) {
  return { id: makeId("event"), stageId, type, at, note };
}

function applySyncedProgress(application, progress, at, isNew = false) {
  const app = normalizeApplication(application);
  const mapping = mapFeishuProgress(progress);
  const targetStageId = mapping.stageId ?? app.currentStageId ?? "applied";
  const targetStatus = mapping.status ?? app.status;
  let pipeline = app.pipeline;
  if (!pipeline.includes(targetStageId)) {
    pipeline = normalizePipeline([
      ...pipeline.filter((stageId) => stageId !== "offer"),
      targetStageId,
      "offer",
    ]);
  }

  const timeline = [...app.timeline];
  const progressLabel = mapping.raw || stageById(targetStageId).label;
  const stageChanged = targetStageId !== app.currentStageId;
  const statusChanged = targetStatus !== app.status;

  if (stageChanged) {
    timeline.push(syncEvent(
      app.currentStageId,
      ["rejected", "withdrawn"].includes(app.status) ? "reopened" : "completed",
      at,
      `飞书同步：进度更新为「${progressLabel}」`,
    ));
    timeline.push(syncEvent(targetStageId, "entered", at, "由飞书同步进入此环节"));
  }

  if (
    ["rejected", "withdrawn", "paused"].includes(targetStatus)
    && (statusChanged || isNew)
  ) {
    const outcomeLabels = { rejected: "未通过", withdrawn: "已撤回", paused: "暂时搁置" };
    timeline.push(syncEvent(
      targetStageId,
      "completed",
      at,
      `飞书同步：${outcomeLabels[targetStatus]}${mapping.raw ? `（${mapping.raw}）` : ""}`,
    ));
  } else if (!stageChanged && statusChanged && targetStatus === "active") {
    timeline.push(syncEvent(targetStageId, "reopened", at, "飞书同步：流程重新开启"));
  }

  return {
    ...app,
    pipeline,
    currentStageId: targetStageId,
    status: targetStatus,
    nextFollowUp: ["offer", "rejected", "withdrawn"].includes(targetStatus)
      ? ""
      : app.nextFollowUp,
    timeline,
  };
}

function comparisonKey(application) {
  return JSON.stringify({
    company: application.company,
    position: application.position,
    jobUrl: application.jobUrl,
    applicationEmail: application.applicationEmail,
    appliedAt: application.appliedAt,
    pipeline: application.pipeline,
    currentStageId: application.currentStageId,
    status: application.status,
    progress: application.sync?.progress ?? "",
  });
}

function createSyncedApplication(record, syncedAt) {
  const appliedAt = record.appliedAt || syncedAt;
  const created = createApplication({
    company: record.company || "未填写公司",
    position: record.position || "未填写岗位",
    jobUrl: record.jobUrl,
    applicationEmail: record.applicationEmail,
    appliedAt: appliedAt.slice(0, 10),
    sync: {
      source: "feishu",
      recordId: record.recordId,
      progress: record.progress,
      sourceUpdatedAt: record.sourceUpdatedAt,
      syncedAt,
    },
  }, new Date(syncedAt));
  const withProgress = applySyncedProgress(created, record.progress, syncedAt, true);
  return normalizeApplication({
    ...withProgress,
    id: `feishu_${record.recordId}`,
    updatedAt: record.sourceUpdatedAt || syncedAt,
  });
}

function updateSyncedApplication(existing, record, syncedAt) {
  const before = comparisonKey(existing);
  const base = normalizeApplication({
    ...existing,
    company: record.company || existing.company,
    position: record.position || existing.position,
    jobUrl: record.jobUrl,
    applicationEmail: record.applicationEmail,
    appliedAt: record.appliedAt || existing.appliedAt,
    sync: {
      source: "feishu",
      recordId: record.recordId,
      progress: record.progress,
      sourceUpdatedAt: record.sourceUpdatedAt,
      syncedAt,
    },
  });
  const updated = applySyncedProgress(base, record.progress, record.sourceUpdatedAt || syncedAt);
  const changed = before !== comparisonKey(updated);
  return {
    changed,
    application: normalizeApplication({
      ...updated,
      updatedAt: changed ? (record.sourceUpdatedAt || syncedAt) : existing.updatedAt,
    }),
  };
}

export function mergeFeishuApplications(current, rawRecords, options = {}) {
  if (!Array.isArray(rawRecords)) throw new Error("同步响应中没有可识别的飞书记录");
  const syncedAt = toIsoDate(options.syncedAt ?? new Date());
  const applications = current.map(normalizeApplication);
  const byRecordId = new Map(
    applications
      .filter((application) => application.sync?.source === "feishu")
      .map((application) => [application.sync.recordId, application]),
  );
  const byId = new Map(applications.map((application) => [application.id, application]));
  const seen = new Set();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const rawRecord of rawRecords) {
    const record = normalizeFeishuRecord(rawRecord);
    if (!record.recordId || seen.has(record.recordId)) {
      skipped += 1;
      continue;
    }
    seen.add(record.recordId);
    const existing = byRecordId.get(record.recordId);
    if (!existing) {
      const application = createSyncedApplication(record, syncedAt);
      byId.set(application.id, application);
      byRecordId.set(record.recordId, application);
      created += 1;
      continue;
    }

    const result = updateSyncedApplication(existing, record, syncedAt);
    byId.set(existing.id, result.application);
    if (result.changed) updated += 1;
    else unchanged += 1;
  }

  return {
    applications: [...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    stats: { received: rawRecords.length, created, updated, unchanged, skipped },
    syncedAt,
  };
}

function validateEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("同步服务地址无效");
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocal) {
    throw new Error("同步服务必须使用 HTTPS");
  }
  return url.href;
}

export async function fetchFeishuSnapshot({
  endpoint,
  accessToken = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("当前环境不支持网络请求");
  const url = validateEndpoint(endpoint);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error("同步认证失败，请检查访问密钥");
      throw new Error(`同步服务请求失败（HTTP ${response.status}）`);
    }
    const payload = await response.json();
    const records = Array.isArray(payload)
      ? payload
      : payload.records ?? payload.data?.records;
    if (!Array.isArray(records)) throw new Error("同步服务返回的数据格式不正确");
    return {
      records,
      syncedAt: normalizeDateValue(payload.syncedAt ?? payload.data?.syncedAt) || new Date().toISOString(),
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("同步请求超时，请稍后重试");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
