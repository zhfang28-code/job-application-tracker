export const APP_VERSION = 1;
export const STORAGE_KEY = "jobtrail.applications.v1";

export const STAGES = Object.freeze([
  { id: "applied", label: "已投递", shortLabel: "投递", color: "#5b6cf9" },
  { id: "assessment", label: "在线测试", shortLabel: "测评", color: "#8b5cf6" },
  { id: "ai-interview", label: "AI 面试", shortLabel: "AI 面", color: "#a855f7" },
  { id: "first-interview", label: "一面", shortLabel: "一面", color: "#0ea5e9" },
  { id: "second-interview", label: "二面", shortLabel: "二面", color: "#06b6d4" },
  { id: "final-interview", label: "终面", shortLabel: "终面", color: "#14b8a6" },
  { id: "hr-interview", label: "HR 面", shortLabel: "HR 面", color: "#f59e0b" },
  { id: "offer", label: "Offer", shortLabel: "Offer", color: "#10b981" },
]);

export const DEFAULT_PIPELINE = STAGES.map((stage) => stage.id);
export const INITIAL_PIPELINE = Object.freeze(["applied", "offer"]);
export const STAGE_IDS = new Set(DEFAULT_PIPELINE);
export const INTERVIEW_STAGE_IDS = new Set([
  "ai-interview",
  "first-interview",
  "second-interview",
  "final-interview",
  "hr-interview",
]);

const TERMINAL_STATUSES = new Set(["offer", "rejected", "withdrawn"]);
const COMPANY_QUERY_KEYS = new Set([
  "company",
  "companyname",
  "corp",
  "corpname",
  "employer",
  "employername",
  "organization",
  "organisation",
]);
const COMPANY_ALIASES = new Map([
  ["alibaba", "阿里巴巴"],
  ["ant group", "蚂蚁集团"],
  ["antgroup", "蚂蚁集团"],
  ["apple", "Apple"],
  ["baidu", "百度"],
  ["bilibili", "哔哩哔哩"],
  ["byte dance", "字节跳动"],
  ["bytedance", "字节跳动"],
  ["ctrip", "携程"],
  ["didi", "滴滴"],
  ["google", "Google"],
  ["huawei", "华为"],
  ["jd", "京东"],
  ["jingdong", "京东"],
  ["kuaishou", "快手"],
  ["meituan", "美团"],
  ["meta", "Meta"],
  ["microsoft", "Microsoft"],
  ["mihoyo", "米哈游"],
  ["netease", "网易"],
  ["nvidia", "NVIDIA"],
  ["openai", "OpenAI"],
  ["pdd", "拼多多"],
  ["pinduoduo", "拼多多"],
  ["tencent", "腾讯"],
  ["trip", "携程"],
  ["xiaomi", "小米"],
]);
const COMPANY_HOST_RULES = [
  { company: "字节跳动", matches: (host) => host === "job.toutiao.com" || host === "jobs.bytedance.com" || host.endsWith(".bytedance.com") },
  { company: "腾讯", matches: (host) => host === "join.qq.com" || host === "hr.tencent.com" || host.endsWith(".tencent.com") },
  { company: "阿里巴巴", matches: (host) => host === "talent.alibaba.com" || host.endsWith("-talent.alibaba.com") },
  { company: "华为", matches: (host) => host === "career.huawei.com" || host.endsWith(".career.huawei.com") },
  { company: "百度", matches: (host) => host === "talent.baidu.com" || host === "zhaopin.baidu.com" },
  { company: "美团", matches: (host) => host === "zhaopin.meituan.com" || host === "campus.meituan.com" },
  { company: "京东", matches: (host) => host === "zhaopin.jd.com" || host === "campus.jd.com" },
  { company: "小米", matches: (host) => host === "hr.xiaomi.com" || host === "career.xiaomi.com" },
  { company: "拼多多", matches: (host) => host === "career.pinduoduo.com" || host === "career.pddglobal.com" },
  { company: "快手", matches: (host) => host === "zhaopin.kuaishou.cn" || host === "career.kuaishou.cn" },
];
const RECRUITMENT_SUBDOMAINS = new Set([
  "career",
  "careers",
  "campus",
  "hr",
  "job",
  "jobs",
  "join",
  "recruit",
  "recruiting",
  "recruitment",
  "talent",
  "zhaopin",
]);
const GENERIC_COMPANY_SLUGS = new Set([
  "apply",
  "campus",
  "campus recruitment",
  "career",
  "careers",
  "company",
  "job",
  "jobs",
  "position",
  "recruit",
  "recruitment",
  "social recruitment",
  "talent",
]);

export function makeId(prefix = "app") {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function toIsoDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

export function stageById(stageId) {
  return STAGES.find((stage) => stage.id === stageId) ?? STAGES[0];
}

function decodeLinkPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function companyFromSlug(value) {
  const decoded = decodeLinkPart(String(value ?? ""));
  const normalized = decoded
    .replace(/[+_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliasKey = normalized.toLocaleLowerCase("en-US");

  if (
    normalized.length < 2
    || normalized.length > 80
    || GENERIC_COMPANY_SLUGS.has(aliasKey)
    || /^\d+$/.test(normalized)
    || /^[a-f\d]{16,}$/i.test(normalized)
    || /https?:\/\//i.test(normalized)
  ) return "";

  const alias = COMPANY_ALIASES.get(aliasKey);
  if (alias) return alias;
  if (/\p{Script=Han}/u.test(normalized)) return normalized;

  return normalized
    .split(" ")
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : "")
    .join(" ");
}

function companyFromParameters(url) {
  const parameterGroups = [url.searchParams];
  const hashQueryIndex = url.hash.indexOf("?");
  if (hashQueryIndex >= 0) {
    parameterGroups.push(new URLSearchParams(url.hash.slice(hashQueryIndex + 1)));
  }

  for (const parameters of parameterGroups) {
    for (const [key, value] of parameters) {
      const normalizedKey = key.toLocaleLowerCase("en-US").replace(/[-_]/g, "");
      if (!COMPANY_QUERY_KEYS.has(normalizedKey)) continue;
      const company = companyFromSlug(value);
      if (company) return company;
    }
  }
  return "";
}

function companyFromAtsPath(url) {
  const host = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  const firstSegmentHosts = new Set([
    "apply.workable.com",
    "boards.greenhouse.io",
    "careers.smartrecruiters.com",
    "job-boards.greenhouse.io",
    "jobs.ashbyhq.com",
    "jobs.lever.co",
  ]);

  if (firstSegmentHosts.has(host)) return companyFromSlug(segments[0]);
  if (host === "app.mokahr.com") {
    const recruitmentIndex = segments.findIndex((segment) => /recruitment$/i.test(segment));
    return companyFromSlug(segments[recruitmentIndex + 1]);
  }
  const feishuMatch = host.match(/^([a-z\d-]+)\.jobs\.feishu\.cn$/i);
  return feishuMatch ? companyFromSlug(feishuMatch[1]) : "";
}

function registrableBrandLabel(host) {
  const labels = host.split(".").filter(Boolean);
  if (labels.length < 3 || !RECRUITMENT_SUBDOMAINS.has(labels[0])) return "";
  const pairedSuffix = `${labels.at(-2)}.${labels.at(-1)}`;
  const multiPartSuffixes = new Set(["co.jp", "co.uk", "com.au", "com.cn", "net.cn", "org.cn"]);
  return multiPartSuffixes.has(pairedSuffix) ? labels.at(-3) : labels.at(-2);
}

export function inferCompanyFromUrl(value) {
  const rawValue = cleanText(value);
  if (!rawValue) return { company: "", confidence: "none", method: "" };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`);
  } catch {
    return { company: "", confidence: "none", method: "" };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { company: "", confidence: "none", method: "" };
  }

  const parameterCompany = companyFromParameters(url);
  if (parameterCompany) {
    return { company: parameterCompany, confidence: "high", method: "parameter" };
  }

  const host = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
  const hostRule = COMPANY_HOST_RULES.find((rule) => rule.matches(host));
  if (hostRule) {
    return { company: hostRule.company, confidence: "high", method: "official-domain" };
  }

  const atsCompany = companyFromAtsPath(url);
  if (atsCompany) {
    return { company: atsCompany, confidence: "medium", method: "ats-path" };
  }

  const linkedInSlug = decodeLinkPart(url.pathname.split("/").filter(Boolean).at(-1) ?? "");
  const linkedInMatch = host.endsWith("linkedin.com")
    ? linkedInSlug.match(/-at-(.+?)-\d+(?:-[a-z\d]+)?$/i)
    : null;
  const linkedInCompany = companyFromSlug(linkedInMatch?.[1]);
  if (linkedInCompany) {
    return { company: linkedInCompany, confidence: "medium", method: "path" };
  }

  const domainCompany = companyFromSlug(registrableBrandLabel(host));
  if (domainCompany) {
    return { company: domainCompany, confidence: "medium", method: "recruitment-domain" };
  }

  return { company: "", confidence: "none", method: "" };
}

export function normalizePipeline(pipeline = DEFAULT_PIPELINE) {
  const requested = Array.isArray(pipeline) ? pipeline : DEFAULT_PIPELINE;
  const seen = new Set(["applied", "offer"]);
  const orderedStages = [];

  for (const stageId of requested) {
    if (!STAGE_IDS.has(stageId) || seen.has(stageId)) continue;
    orderedStages.push(stageId);
    seen.add(stageId);
  }

  // The actual middle stages keep the order in which the company arranged them.
  return ["applied", ...orderedStages, "offer"];
}

function cleanText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeApplicationTarget(input = {}) {
  const explicitEmail = cleanText(input.applicationEmail).replace(/^mailto:/i, "");
  const rawTarget = cleanText(input.applicationTarget)
    || explicitEmail
    || cleanText(input.jobUrl);
  const emailMatch = rawTarget.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  const applicationEmail = explicitEmail || (emailMatch ? rawTarget : "");
  const jobUrl = applicationEmail && rawTarget === applicationEmail
    ? ""
    : cleanText(input.jobUrl) || rawTarget;

  return { jobUrl, applicationEmail };
}

function normalizeImportSource(source) {
  if (!source || typeof source !== "object") return null;
  const format = cleanText(source.format);
  const recordKey = cleanText(source.recordKey);
  if (format !== "csv" || !recordKey) return null;
  return {
    format,
    recordKey,
    progress: cleanText(source.progress),
    importedAt: source.importedAt ? toIsoDate(source.importedAt) : "",
  };
}

export function createApplication(input = {}, now = new Date()) {
  const timestamp = toIsoDate(now);
  const pipeline = normalizePipeline(input.pipeline ?? INITIAL_PIPELINE);
  const appliedAt = input.appliedAt
    ? toIsoDate(`${input.appliedAt}T12:00:00`)
    : timestamp;
  const target = normalizeApplicationTarget(input);

  return {
    id: makeId("application"),
    company: cleanText(input.company),
    position: cleanText(input.position),
    city: cleanText(input.city),
    jobUrl: target.jobUrl,
    applicationEmail: target.applicationEmail,
    salary: cleanText(input.salary),
    notes: cleanText(input.notes),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => cleanText(tag)).filter(Boolean)
      : cleanText(input.tags)
          .split(/[，,]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
    appliedAt,
    nextFollowUp: cleanText(input.nextFollowUp),
    pipeline,
    currentStageId: pipeline[0],
    status: "active",
    timeline: [
      {
        id: makeId("event"),
        stageId: pipeline[0],
        type: "entered",
        at: appliedAt,
        note: "创建投递记录",
      },
    ],
    importSource: normalizeImportSource(input.importSource),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeApplication(raw) {
  const pipeline = normalizePipeline(raw?.pipeline);
  const timeline = Array.isArray(raw?.timeline)
    ? raw.timeline
        .filter((event) => event && STAGE_IDS.has(event.stageId))
        .map((event) => ({
          id: cleanText(event.id) || makeId("event"),
          stageId: event.stageId,
          type: ["entered", "completed", "skipped", "reopened"].includes(event.type)
            ? event.type
            : "completed",
          at: toIsoDate(event.at),
          note: cleanText(event.note),
        }))
    : [];

  const currentStageId = pipeline.includes(raw?.currentStageId)
    ? raw.currentStageId
    : pipeline[0];
  const status = ["active", "paused", "offer", "rejected", "withdrawn"].includes(raw?.status)
    ? raw.status
    : "active";
  const timestamp = toIsoDate(raw?.createdAt);
  const target = normalizeApplicationTarget(raw);

  return {
    id: cleanText(raw?.id) || makeId("application"),
    company: cleanText(raw?.company, "未命名公司"),
    position: cleanText(raw?.position, "未命名岗位"),
    city: cleanText(raw?.city),
    jobUrl: target.jobUrl,
    applicationEmail: target.applicationEmail,
    salary: cleanText(raw?.salary),
    notes: cleanText(raw?.notes),
    tags: Array.isArray(raw?.tags) ? raw.tags.map((tag) => cleanText(tag)).filter(Boolean) : [],
    appliedAt: toIsoDate(raw?.appliedAt ?? timestamp),
    nextFollowUp: cleanText(raw?.nextFollowUp),
    pipeline,
    currentStageId,
    status,
    timeline,
    importSource: normalizeImportSource(raw?.importSource),
    createdAt: timestamp,
    updatedAt: toIsoDate(raw?.updatedAt ?? timestamp),
  };
}

export function updateApplication(application, input, now = new Date()) {
  const original = normalizeApplication(application);
  const pipeline = normalizePipeline(input.pipeline ?? original.pipeline);
  const target = normalizeApplicationTarget({
    jobUrl: input.jobUrl,
    applicationTarget: input.applicationTarget,
    applicationEmail: input.applicationEmail,
  });

  // A stage already reached must stay in the route so history never disappears.
  const reachedStages = new Set(original.timeline.map((event) => event.stageId));
  reachedStages.add(original.currentStageId);
  const reachedInOrder = original.pipeline.filter((stageId) => reachedStages.has(stageId));
  const safePipeline = input.pipeline == null
    ? original.pipeline
    : normalizePipeline([
        ...reachedInOrder,
        ...pipeline.filter((stageId) => !reachedStages.has(stageId)),
      ]);

  return {
    ...original,
    company: cleanText(input.company, original.company),
    position: cleanText(input.position, original.position),
    city: cleanText(input.city),
    jobUrl: target.jobUrl,
    applicationEmail: target.applicationEmail,
    salary: cleanText(input.salary),
    notes: cleanText(input.notes),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => cleanText(tag)).filter(Boolean)
      : cleanText(input.tags)
          .split(/[，,]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
    appliedAt: input.appliedAt
      ? toIsoDate(`${input.appliedAt}T12:00:00`)
      : original.appliedAt,
    nextFollowUp: cleanText(input.nextFollowUp),
    pipeline: safePipeline,
    updatedAt: toIsoDate(now),
  };
}

export function completeCurrentStage(application, details = {}, now = new Date()) {
  const app = normalizeApplication(application);
  if (TERMINAL_STATUSES.has(app.status)) return app;

  const timestamp = toIsoDate(details.at ?? now);
  let pipeline = [...app.pipeline];
  const currentIndex = pipeline.indexOf(app.currentStageId);
  const requestedNextStageId = cleanText(details.nextStageId);
  let nextStageId = pipeline[currentIndex + 1];

  if (
    STAGE_IDS.has(requestedNextStageId)
    && requestedNextStageId !== "applied"
    && requestedNextStageId !== app.currentStageId
  ) {
    const requestedIndex = pipeline.indexOf(requestedNextStageId);
    if (requestedIndex > currentIndex) {
      // Choosing a later known stage removes speculative stages that never happened.
      pipeline = normalizePipeline([
        ...pipeline.slice(0, currentIndex + 1),
        ...pipeline.slice(requestedIndex),
      ]);
      nextStageId = requestedNextStageId;
    } else if (requestedIndex === -1) {
      // A newly announced stage is inserted directly after the current real stage.
      pipeline = normalizePipeline([
        ...pipeline.slice(0, currentIndex + 1),
        requestedNextStageId,
        ...pipeline.slice(currentIndex + 1),
      ]);
      nextStageId = requestedNextStageId;
    }
  }
  const timeline = [
    ...app.timeline,
    {
      id: makeId("event"),
      stageId: app.currentStageId,
      type: "completed",
      at: timestamp,
      note: cleanText(details.note),
    },
  ];

  if (!nextStageId || app.currentStageId === "offer") {
    return {
      ...app,
      pipeline,
      status: "offer",
      currentStageId: "offer",
      nextFollowUp: "",
      timeline,
      updatedAt: timestamp,
    };
  }

  timeline.push({
    id: makeId("event"),
    stageId: nextStageId,
    type: "entered",
    at: timestamp,
    note: cleanText(details.nextNote),
  });

  return {
    ...app,
    pipeline,
    currentStageId: nextStageId,
    status: nextStageId === "offer" ? "offer" : "active",
    nextFollowUp: cleanText(details.nextFollowUp),
    timeline,
    updatedAt: timestamp,
  };
}

export function skipCurrentStage(application, details = {}, now = new Date()) {
  const app = normalizeApplication(application);
  if (TERMINAL_STATUSES.has(app.status) || app.currentStageId === "offer") return app;

  const timestamp = toIsoDate(details.at ?? now);
  const currentIndex = app.pipeline.indexOf(app.currentStageId);
  const nextStageId = app.pipeline[currentIndex + 1];
  if (!nextStageId) return app;

  return {
    ...app,
    currentStageId: nextStageId,
    status: nextStageId === "offer" ? "offer" : "active",
    nextFollowUp: cleanText(details.nextFollowUp),
    timeline: [
      ...app.timeline,
      {
        id: makeId("event"),
        stageId: app.currentStageId,
        type: "skipped",
        at: timestamp,
        note: cleanText(details.note, "该公司无此环节"),
      },
      {
        id: makeId("event"),
        stageId: nextStageId,
        type: "entered",
        at: timestamp,
        note: "进入下一环节",
      },
    ],
    updatedAt: timestamp,
  };
}

export function setOutcome(application, status, details = {}, now = new Date()) {
  if (!["rejected", "withdrawn", "paused", "active"].includes(status)) {
    throw new Error(`Unsupported application status: ${status}`);
  }
  const app = normalizeApplication(application);
  const timestamp = toIsoDate(details.at ?? now);
  const eventType = status === "active" ? "reopened" : "completed";
  const statusLabels = {
    rejected: "流程结束：未通过",
    withdrawn: "流程结束：已撤回",
    paused: "流程暂停",
    active: "重新开启流程",
  };

  return {
    ...app,
    status,
    nextFollowUp: status === "active" || status === "paused"
      ? cleanText(details.nextFollowUp, app.nextFollowUp)
      : "",
    timeline: [
      ...app.timeline,
      {
        id: makeId("event"),
        stageId: app.currentStageId,
        type: eventType,
        at: timestamp,
        note: cleanText(details.note, statusLabels[status]),
      },
    ],
    updatedAt: timestamp,
  };
}

export function moveToStage(application, targetStageId, details = {}, now = new Date()) {
  const app = normalizeApplication(application);
  const targetIndex = app.pipeline.indexOf(targetStageId);
  const currentIndex = app.pipeline.indexOf(app.currentStageId);
  if (targetIndex < 0 || targetIndex === currentIndex) return app;

  const timestamp = toIsoDate(details.at ?? now);
  const timeline = [...app.timeline];
  if (targetIndex > currentIndex) {
    for (let index = currentIndex; index < targetIndex; index += 1) {
      timeline.push({
        id: makeId("event"),
        stageId: app.pipeline[index],
        type: index === currentIndex ? "completed" : "skipped",
        at: timestamp,
        note: index === currentIndex
          ? cleanText(details.note, "直接更新进展")
          : "跨越未经历的环节",
      });
    }
  } else {
    timeline.push({
      id: makeId("event"),
      stageId: targetStageId,
      type: "reopened",
      at: timestamp,
      note: cleanText(details.note, "回到此环节"),
    });
  }
  timeline.push({
    id: makeId("event"),
    stageId: targetStageId,
    type: "entered",
    at: timestamp,
    note: cleanText(details.nextNote),
  });

  return {
    ...app,
    currentStageId: targetStageId,
    status: targetStageId === "offer" ? "offer" : "active",
    nextFollowUp: cleanText(details.nextFollowUp),
    timeline,
    updatedAt: timestamp,
  };
}

export function completedStageIds(application) {
  return new Set(
    normalizeApplication(application).timeline
      .filter((event) => event.type === "completed")
      .map((event) => event.stageId),
  );
}

export function applicationProgress(application) {
  const app = normalizeApplication(application);
  const currentIndex = app.pipeline.indexOf(app.currentStageId);
  if (app.status === "offer") return 100;
  if (app.status === "rejected" || app.status === "withdrawn") {
    return Math.round((Math.max(0, currentIndex) / Math.max(1, app.pipeline.length - 1)) * 100);
  }
  return Math.round((Math.max(0, currentIndex) / Math.max(1, app.pipeline.length - 1)) * 100);
}

export function daysSince(isoDate, now = new Date()) {
  const start = new Date(isoDate);
  const end = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
}

export function isFollowUpDue(application, today = new Date()) {
  if (!application.nextFollowUp || TERMINAL_STATUSES.has(application.status)) return false;
  const localToday = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return application.nextFollowUp <= localToday;
}

export function summarize(applications) {
  const normalized = applications.map(normalizeApplication);
  return {
    total: normalized.length,
    active: normalized.filter((app) => ["active", "paused"].includes(app.status)).length,
    interviewing: normalized.filter(
      (app) => app.status === "active" && INTERVIEW_STAGE_IDS.has(app.currentStageId),
    ).length,
    offers: normalized.filter((app) => app.status === "offer").length,
    due: normalized.filter((app) => isFollowUpDue(app)).length,
  };
}

export function exportPayload(applications) {
  return {
    app: "JobTrail",
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    applications: applications.map(normalizeApplication),
  };
}

export function parseImportPayload(payload) {
  const items = Array.isArray(payload) ? payload : payload?.applications;
  if (!Array.isArray(items)) {
    throw new Error("备份文件中没有可识别的投递记录");
  }
  return items.map(normalizeApplication);
}

export function mergeApplications(current, imported) {
  const byId = new Map(current.map((application) => [application.id, normalizeApplication(application)]));
  for (const application of imported) {
    const normalized = normalizeApplication(application);
    const existing = byId.get(normalized.id);
    if (!existing || new Date(normalized.updatedAt) >= new Date(existing.updatedAt)) {
      byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}
