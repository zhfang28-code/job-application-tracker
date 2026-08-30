import {
  createApplication,
  makeId,
  normalizeApplication,
  normalizePipeline,
  stageById,
  toIsoDate,
} from "./model.js?v=20260830-4";

const HEADER_ALIASES = Object.freeze({
  company: ["单位", "公司", "公司名称", "投递公司"],
  position: ["岗位", "岗位名称", "职位", "职位名称"],
  city: ["城市|工作地", "城市/工作地", "城市", "工作地", "工作地点"],
  target: ["投递链接", "链接/邮箱", "链接／邮箱", "岗位链接", "邮箱"],
  status: ["状态", "目前的进度", "目前进度", "当前进度", "进度"],
  assessment: ["测评|笔试", "测评/笔试", "测评", "笔试", "面试轮次"],
  appliedAt: ["投递时间", "投递日期", "申请时间", "申请日期"],
});

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedHeader(value) {
  return cleanText(value)
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-/／|()（）:：]/g, "");
}

function localDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseCsvText(text) {
  const input = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field === "") quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => cleanText(value))) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }

  if (quoted) throw new Error("CSV 中存在未闭合的引号");
  row.push(field);
  if (row.some((value) => cleanText(value))) rows.push(row);
  return rows;
}

function columnIndex(headers, aliases) {
  const normalized = headers.map(normalizedHeader);
  return aliases
    .map((alias) => normalized.indexOf(normalizedHeader(alias)))
    .find((index) => index >= 0) ?? -1;
}

function parseDate(value, fallbackDate) {
  const text = cleanText(value);
  if (!text) return { value: fallbackDate, usedFallback: true };
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split("-");
    return { value: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, usedFallback: false };
  }
  if (/^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split(/[/.]/);
    return { value: `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, usedFallback: false };
  }
  if (/^\d{10,13}$/.test(text)) {
    const timestamp = Number(text) * (text.length === 10 ? 1000 : 1);
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) return { value: localDateString(date), usedFallback: false };
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime())
    ? { value: fallbackDate, usedFallback: true }
    : { value: localDateString(date), usedFallback: false };
}

function stableRecordKey(company, position, target) {
  const identity = [company, position, target]
    .map((value) => cleanText(value).toLocaleLowerCase("zh-CN"))
    .join("\u001f");
  let hash = 0xcbf29ce484222325n;
  for (const character of identity) {
    hash ^= BigInt(character.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `csv_${hash.toString(16).padStart(16, "0")}`;
}

function stageFromText(value) {
  const text = cleanText(value)
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-/／|()（）:：·.。]/g, "");
  const rules = [
    { stageId: "offer", pattern: /offer|录用/ },
    { stageId: "hr-interview", pattern: /hr面|人事面|人力面/ },
    { stageId: "ai-interview", pattern: /ai面|智能面试/ },
    { stageId: "final-interview", pattern: /终面|最终面|三面|第三轮面/ },
    { stageId: "second-interview", pattern: /二面|第二轮面/ },
    { stageId: "first-interview", pattern: /一面|初面|第一轮面|群面/ },
    { stageId: "assessment", pattern: /线上测评|在线测评|测评|笔试|机试|作业|测试/ },
    { stageId: "applied", pattern: /已投递|投递完成|网申|简历筛选|人才库|拒绝|待筛选|已申请/ },
  ];
  return rules.find((rule) => rule.pattern.test(text))?.stageId ?? null;
}

export function mapCsvProgress(statusValue, assessmentValue = "") {
  const statusText = cleanText(statusValue);
  const assessmentText = cleanText(assessmentValue);
  const combined = `${statusText} ${assessmentText}`.trim();
  const normalizedStatus = statusText
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s_\-/／|()（）:：·.。]/g, "");
  const stageId = stageFromText(assessmentText) ?? stageFromText(statusText) ?? "applied";
  const priorStageIds = assessmentText
    && stageId !== "assessment"
    && /已线上测评|已在线测评|测评完成|笔试完成/.test(normalizedStatus)
    ? ["assessment"]
    : [];
  let status = "active";
  if (/人才库|拒绝|未通过|不通过|淘汰|不合适|感谢信/.test(normalizedStatus)) status = "rejected";
  else if (/撤回|放弃|终止申请|不再考虑/.test(normalizedStatus)) status = "withdrawn";
  else if (/暂停|搁置|冻结|延期/.test(normalizedStatus)) status = "paused";
  else if (stageId === "offer") status = "offer";
  return { raw: combined, stageId, status, priorStageIds };
}

export function readJobCsv(text, options = {}) {
  const rows = parseCsvText(text);
  if (rows.length < 2) throw new Error("CSV 中没有可导入的投递记录");
  const headers = rows[0].map(cleanText);
  const indexes = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => [field, columnIndex(headers, aliases)]),
  );
  const missingRequiredColumns = [
    indexes.company < 0 ? "公司（单位）" : "",
    indexes.position < 0 ? "岗位" : "",
  ].filter(Boolean);
  if (missingRequiredColumns.length) {
    throw new Error(`CSV 缺少必需列：${missingRequiredColumns.join("、")}`);
  }

  const fallbackAppliedAt = cleanText(options.fallbackAppliedAt) || localDateString();
  const records = [];
  const seen = new Set();
  let skippedMissingRequired = 0;
  let skippedDuplicates = 0;
  let fallbackDateCount = 0;

  for (const row of rows.slice(1)) {
    const value = (field) => indexes[field] >= 0 ? cleanText(row[indexes[field]]) : "";
    const company = value("company");
    const position = value("position");
    if (!company || !position) {
      skippedMissingRequired += 1;
      continue;
    }
    const target = value("target");
    const recordKey = stableRecordKey(company, position, target);
    if (seen.has(recordKey)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(recordKey);
    const appliedAt = parseDate(value("appliedAt"), fallbackAppliedAt);
    if (appliedAt.usedFallback) fallbackDateCount += 1;
    records.push({
      recordKey,
      company,
      position,
      city: value("city"),
      applicationTarget: target,
      appliedAt: appliedAt.value,
      hasSourceDate: !appliedAt.usedFallback,
      progress: mapCsvProgress(value("status"), value("assessment")),
    });
  }

  return {
    records,
    stats: {
      totalRows: rows.length - 1,
      validRows: records.length,
      skippedMissingRequired,
      skippedDuplicates,
      fallbackDateCount,
    },
  };
}

function importEvent(stageId, type, at, note) {
  return { id: makeId("event"), stageId, type, at, note };
}

function applyImportedProgress(application, progress, at, isNew = false) {
  const app = normalizeApplication(application);
  const targetStageId = progress.stageId ?? app.currentStageId;
  const priorStageIds = Array.isArray(progress.priorStageIds) ? progress.priorStageIds : [];
  const pipeline = normalizePipeline([
    ...app.pipeline.filter((stageId) => stageId !== "offer" && stageId !== targetStageId),
    ...priorStageIds,
    targetStageId,
    "offer",
  ]);
  const timeline = [...app.timeline];
  const stageChanged = targetStageId !== app.currentStageId;
  const statusChanged = progress.status !== app.status;
  const progressLabel = progress.raw || stageById(targetStageId).label;

  if (stageChanged) {
    timeline.push(importEvent(
      app.currentStageId,
      ["rejected", "withdrawn"].includes(app.status) ? "reopened" : "completed",
      at,
      `CSV 导入：进度更新为「${progressLabel}」`,
    ));
    for (const priorStageId of priorStageIds) {
      if (priorStageId === app.currentStageId || priorStageId === targetStageId) continue;
      timeline.push(importEvent(priorStageId, "entered", at, "由 CSV 导入补充此环节"));
      timeline.push(importEvent(priorStageId, "completed", at, "CSV 导入：该环节已完成"));
    }
    timeline.push(importEvent(targetStageId, "entered", at, "由 CSV 导入进入此环节"));
  }
  if (["rejected", "withdrawn", "paused"].includes(progress.status) && (statusChanged || isNew)) {
    const labels = { rejected: "未通过", withdrawn: "已撤回", paused: "暂时搁置" };
    timeline.push(importEvent(
      targetStageId,
      "completed",
      at,
      `CSV 导入：${labels[progress.status]}${progress.raw ? `（${progress.raw}）` : ""}`,
    ));
  } else if (!stageChanged && statusChanged && progress.status === "active") {
    timeline.push(importEvent(targetStageId, "reopened", at, "CSV 导入：流程重新开启"));
  }

  return {
    ...app,
    pipeline,
    currentStageId: targetStageId,
    status: progress.status,
    nextFollowUp: ["offer", "rejected", "withdrawn"].includes(progress.status)
      ? ""
      : app.nextFollowUp,
    timeline,
  };
}

function targetFields(value) {
  const target = cleanText(value).replace(/^mailto:/i, "");
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)
    ? { jobUrl: "", applicationEmail: target }
    : { jobUrl: target, applicationEmail: "" };
}

function recordIdentity(application) {
  const target = application.applicationEmail || application.jobUrl;
  return [application.company, application.position, target]
    .map((value) => cleanText(value).toLocaleLowerCase("zh-CN"))
    .join("\u001f");
}

function comparisonKey(application) {
  return JSON.stringify({
    company: application.company,
    position: application.position,
    city: application.city,
    jobUrl: application.jobUrl,
    applicationEmail: application.applicationEmail,
    appliedAt: application.appliedAt,
    pipeline: application.pipeline,
    currentStageId: application.currentStageId,
    status: application.status,
    progress: application.importSource?.progress ?? "",
  });
}

function createImportedApplication(record, importedAt) {
  const created = createApplication({
    company: record.company,
    position: record.position,
    city: record.city,
    jobUrl: record.applicationTarget,
    appliedAt: record.appliedAt,
    importSource: {
      format: "csv",
      recordKey: record.recordKey,
      progress: record.progress.raw,
      importedAt,
    },
  }, new Date(importedAt));
  created.timeline[0].note = "从 CSV 导入投递记录";
  const withProgress = applyImportedProgress(created, record.progress, importedAt, true);
  return normalizeApplication({
    ...withProgress,
    id: record.recordKey,
    updatedAt: importedAt,
  });
}

function updateImportedApplication(existing, record, importedAt) {
  const before = comparisonKey(existing);
  const target = targetFields(record.applicationTarget);
  const base = normalizeApplication({
    ...existing,
    company: record.company,
    position: record.position,
    city: record.city || existing.city,
    jobUrl: record.applicationTarget ? target.jobUrl : existing.jobUrl,
    applicationEmail: record.applicationTarget ? target.applicationEmail : existing.applicationEmail,
    appliedAt: record.hasSourceDate ? `${record.appliedAt}T12:00:00` : existing.appliedAt,
    importSource: {
      format: "csv",
      recordKey: record.recordKey,
      progress: record.progress.raw,
      importedAt,
    },
  });
  const progressed = applyImportedProgress(base, record.progress, importedAt);
  const changed = before !== comparisonKey(progressed);
  return {
    changed,
    application: normalizeApplication({
      ...progressed,
      updatedAt: changed ? importedAt : existing.updatedAt,
    }),
  };
}

export function mergeCsvApplications(current, records, options = {}) {
  if (!Array.isArray(records)) throw new Error("没有可合并的 CSV 投递记录");
  const importedAt = toIsoDate(options.importedAt ?? new Date());
  const applications = current.map(normalizeApplication);
  const byId = new Map(applications.map((application) => [application.id, application]));
  const byRecordKey = new Map(
    applications
      .filter((application) => application.importSource?.format === "csv")
      .map((application) => [application.importSource.recordKey, application]),
  );
  const byIdentity = new Map(applications.map((application) => [recordIdentity(application), application]));
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const record of records) {
    const identity = [record.company, record.position, record.applicationTarget]
      .map((value) => cleanText(value).toLocaleLowerCase("zh-CN"))
      .join("\u001f");
    const existing = byRecordKey.get(record.recordKey) ?? byIdentity.get(identity);
    if (!existing) {
      const application = createImportedApplication(record, importedAt);
      byId.set(application.id, application);
      byRecordKey.set(record.recordKey, application);
      byIdentity.set(identity, application);
      created += 1;
      continue;
    }
    const result = updateImportedApplication(existing, record, importedAt);
    byId.set(existing.id, result.application);
    byRecordKey.set(record.recordKey, result.application);
    if (result.changed) updated += 1;
    else unchanged += 1;
  }

  return {
    applications: [...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)),
    stats: { received: records.length, created, updated, unchanged },
    importedAt,
  };
}
