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

export const SOURCE_OPTIONS = [
  "官网",
  "Boss 直聘",
  "猎聘",
  "LinkedIn",
  "实习僧",
  "牛客",
  "内推",
  "校园招聘",
  "其他",
];

const TERMINAL_STATUSES = new Set(["offer", "rejected", "withdrawn"]);

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

export function createApplication(input = {}, now = new Date()) {
  const timestamp = toIsoDate(now);
  const pipeline = normalizePipeline(input.pipeline ?? INITIAL_PIPELINE);
  const appliedAt = input.appliedAt
    ? toIsoDate(`${input.appliedAt}T12:00:00`)
    : timestamp;

  return {
    id: makeId("application"),
    company: cleanText(input.company),
    position: cleanText(input.position),
    city: cleanText(input.city),
    jobUrl: cleanText(input.jobUrl),
    source: cleanText(input.source),
    salary: cleanText(input.salary),
    contact: cleanText(input.contact),
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

  return {
    id: cleanText(raw?.id) || makeId("application"),
    company: cleanText(raw?.company, "未命名公司"),
    position: cleanText(raw?.position, "未命名岗位"),
    city: cleanText(raw?.city),
    jobUrl: cleanText(raw?.jobUrl),
    source: cleanText(raw?.source),
    salary: cleanText(raw?.salary),
    contact: cleanText(raw?.contact),
    notes: cleanText(raw?.notes),
    tags: Array.isArray(raw?.tags) ? raw.tags.map((tag) => cleanText(tag)).filter(Boolean) : [],
    appliedAt: toIsoDate(raw?.appliedAt ?? timestamp),
    nextFollowUp: cleanText(raw?.nextFollowUp),
    pipeline,
    currentStageId,
    status,
    timeline,
    createdAt: timestamp,
    updatedAt: toIsoDate(raw?.updatedAt ?? timestamp),
  };
}

export function updateApplication(application, input, now = new Date()) {
  const original = normalizeApplication(application);
  const pipeline = normalizePipeline(input.pipeline ?? original.pipeline);

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
    jobUrl: cleanText(input.jobUrl),
    source: cleanText(input.source),
    salary: cleanText(input.salary),
    contact: cleanText(input.contact),
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
