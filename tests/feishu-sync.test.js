import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "../src/model.js";
import {
  fetchFeishuSnapshot,
  feishuCellText,
  mapFeishuProgress,
  mergeFeishuApplications,
  normalizeFeishuRecord,
} from "../src/feishu-sync.js";

const SYNCED_AT = "2026-08-30T08:00:00.000Z";

test("可读取飞书文本、链接和富文本单元格", () => {
  assert.equal(feishuCellText([{ type: "text", text: "星河" }, { text: "科技" }]), "星河；科技");
  assert.equal(feishuCellText({ text: "岗位详情", link: "https://jobs.example.com/42" }), "https://jobs.example.com/42");
  assert.equal(feishuCellText(null), "");
});

test("按常用中文列名提取允许同步的五个字段和进度", () => {
  const record = normalizeFeishuRecord({
    record_id: "rec001",
    fields: {
      投递公司: [{ text: "星河科技" }],
      "链接/邮箱": { text: "投递邮箱", link: "jobs@example.com" },
      投递时间: 1788076800000,
      岗位: "前端工程师",
      目前的进度: "AI 面试",
      简历附件: { name: "resume.pdf", url: "https://example.com/resume.pdf" },
    },
  });

  assert.equal(record.recordId, "rec001");
  assert.equal(record.company, "星河科技");
  assert.equal(record.position, "前端工程师");
  assert.equal(record.applicationEmail, "jobs@example.com");
  assert.equal(record.jobUrl, "");
  assert.equal(record.progress, "AI 面试");
  assert.equal("resume" in record, false);
});

test("飞书进度可转换为动态流程与终态", () => {
  assert.deepEqual(mapFeishuProgress("在线测评"), {
    raw: "在线测评",
    stageId: "assessment",
    status: "active",
    recognized: true,
  });
  assert.equal(mapFeishuProgress("AI 面试").stageId, "ai-interview");
  assert.equal(mapFeishuProgress("一面未通过").status, "rejected");
  assert.equal(mapFeishuProgress("已收到 Offer").status, "offer");
  assert.equal(mapFeishuProgress("公司流程待确认").recognized, false);
});

test("首次同步按飞书记录 ID 创建，不导入未允许字段", () => {
  const result = mergeFeishuApplications([], [{
    recordId: "rec001",
    company: "星河科技",
    position: "前端工程师",
    applicationTarget: "https://jobs.example.com/42",
    appliedAt: "2026-08-28",
    progress: "一面",
    resume: "private.pdf",
  }], { syncedAt: SYNCED_AT });

  assert.deepEqual(result.stats, { received: 1, created: 1, updated: 0, unchanged: 0, skipped: 0 });
  const [application] = result.applications;
  assert.equal(application.id, "feishu_rec001");
  assert.equal(application.sync.source, "feishu");
  assert.equal(application.sync.recordId, "rec001");
  assert.deepEqual(application.pipeline, ["applied", "first-interview", "offer"]);
  assert.equal(application.currentStageId, "first-interview");
  assert.equal(application.jobUrl, "https://jobs.example.com/42");
  assert.equal("resume" in application, false);
});

test("重复同步不新增记录，进度变化会更新同一条时间线", () => {
  const initial = mergeFeishuApplications([], [{
    recordId: "rec001",
    company: "星河科技",
    position: "前端工程师",
    applicationTarget: "jobs@example.com",
    appliedAt: "2026-08-28",
    progress: "一面",
  }], { syncedAt: SYNCED_AT });
  const firstTimelineLength = initial.applications[0].timeline.length;

  const repeated = mergeFeishuApplications(initial.applications, [{
    recordId: "rec001",
    company: "星河科技",
    position: "前端工程师",
    applicationTarget: "jobs@example.com",
    appliedAt: "2026-08-28",
    progress: "一面",
  }], { syncedAt: "2026-08-30T09:00:00.000Z" });
  assert.equal(repeated.applications.length, 1);
  assert.equal(repeated.stats.unchanged, 1);
  assert.equal(repeated.applications[0].timeline.length, firstTimelineLength);

  const advanced = mergeFeishuApplications(repeated.applications, [{
    recordId: "rec001",
    company: "星河科技",
    position: "前端工程师",
    applicationTarget: "jobs@example.com",
    appliedAt: "2026-08-28",
    progress: "HR 面",
  }], { syncedAt: "2026-08-31T09:00:00.000Z" });
  assert.equal(advanced.stats.updated, 1);
  assert.equal(advanced.applications[0].currentStageId, "hr-interview");
  assert.deepEqual(advanced.applications[0].pipeline, ["applied", "first-interview", "hr-interview", "offer"]);
  assert.ok(advanced.applications[0].timeline.length > firstTimelineLength);
});

test("同步只覆盖六个来源字段，保留本地备注、标签和城市", () => {
  const local = createApplication({
    company: "本地名称",
    position: "旧岗位",
    city: "上海",
    notes: "准备项目复盘",
    tags: ["重点"],
    appliedAt: "2026-08-20",
    sync: { source: "feishu", recordId: "rec001", progress: "已投递", syncedAt: SYNCED_AT },
  }, new Date(SYNCED_AT));
  const result = mergeFeishuApplications([local], [{
    recordId: "rec001",
    company: "飞书名称",
    position: "新岗位",
    applicationTarget: "https://jobs.example.com/new",
    appliedAt: "2026-08-29",
    progress: "在线测试",
  }], { syncedAt: "2026-08-31T09:00:00.000Z" });

  const [application] = result.applications;
  assert.equal(application.company, "飞书名称");
  assert.equal(application.position, "新岗位");
  assert.equal(application.city, "上海");
  assert.equal(application.notes, "准备项目复盘");
  assert.deepEqual(application.tags, ["重点"]);
});

test("飞书中缺失的记录不会自动删除本地内容", () => {
  const local = createApplication({ company: "本地公司", position: "后端工程师" }, new Date(SYNCED_AT));
  const result = mergeFeishuApplications([local], [], { syncedAt: SYNCED_AT });
  assert.equal(result.applications.length, 1);
  assert.equal(result.applications[0].id, local.id);
});

test("同步客户端发送 Bearer 密钥并校验响应", async () => {
  let request;
  const snapshot = await fetchFeishuSnapshot({
    endpoint: "https://sync.example.com/jobtrail",
    accessToken: "local-secret",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ syncedAt: SYNCED_AT, records: [{ recordId: "rec001" }] }),
      };
    },
  });

  assert.equal(request.url, "https://sync.example.com/jobtrail");
  assert.equal(request.options.headers.Authorization, "Bearer local-secret");
  assert.equal(request.options.cache, "no-store");
  assert.equal(snapshot.records.length, 1);
  assert.equal(snapshot.syncedAt, SYNCED_AT);
});
