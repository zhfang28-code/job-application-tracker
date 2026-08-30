import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PIPELINE,
  applicationProgress,
  completeCurrentStage,
  createApplication,
  isFollowUpDue,
  mergeApplications,
  moveToStage,
  normalizeApplication,
  parseImportPayload,
  setOutcome,
  skipCurrentStage,
  summarize,
  updateApplication,
} from "../src/model.js";

const NOW = new Date("2026-08-30T08:00:00.000Z");

function sample(overrides = {}) {
  return createApplication({
    company: "星河科技",
    position: "前端工程师",
    city: "上海",
    source: "官网",
    appliedAt: "2026-08-28",
    pipeline: DEFAULT_PIPELINE,
    ...overrides,
  }, NOW);
}

test("创建投递会规范流程并写入初始时间线", () => {
  const application = sample({ pipeline: ["ai-interview", "first-interview"] });

  assert.deepEqual(application.pipeline, ["applied", "ai-interview", "first-interview", "offer"]);
  assert.equal(application.currentStageId, "applied");
  assert.equal(application.status, "active");
  assert.equal(application.timeline.length, 1);
  assert.equal(application.timeline[0].type, "entered");
  assert.equal(application.timeline[0].note, "创建投递记录");
});

test("完成阶段会自动进入公司实际存在的下一环节", () => {
  const application = sample({ pipeline: ["applied", "ai-interview", "first-interview", "offer"] });
  const updated = completeCurrentStage(application, { note: "网申已提交" }, NOW);

  assert.equal(updated.currentStageId, "ai-interview");
  assert.equal(updated.timeline.at(-2).type, "completed");
  assert.equal(updated.timeline.at(-2).note, "网申已提交");
  assert.equal(updated.timeline.at(-1).type, "entered");
  assert.equal(updated.timeline.at(-1).stageId, "ai-interview");
});

test("进入 Offer 环节即标记为已收 Offer", () => {
  const application = sample({ pipeline: ["applied", "offer"] });
  const offered = completeCurrentStage(application, { note: "收到口头 Offer" }, NOW);

  assert.equal(offered.currentStageId, "offer");
  assert.equal(offered.status, "offer");
  assert.equal(applicationProgress(offered), 100);
  assert.equal(offered.nextFollowUp, "");
});

test("跳过缺失环节会同时记录跳过与进入事件", () => {
  const atAssessment = moveToStage(sample(), "assessment", {}, NOW);
  const updated = skipCurrentStage(atAssessment, { note: "该岗位免测评" }, NOW);

  assert.equal(updated.currentStageId, "ai-interview");
  assert.equal(updated.timeline.at(-2).type, "skipped");
  assert.equal(updated.timeline.at(-2).note, "该岗位免测评");
  assert.equal(updated.timeline.at(-1).type, "entered");
});

test("跨阶段拖动会自动将中间环节记为跳过", () => {
  const application = sample();
  const updated = moveToStage(application, "second-interview", { note: "收到二面邀请" }, NOW);
  const newEvents = updated.timeline.slice(1);

  assert.equal(updated.currentStageId, "second-interview");
  assert.equal(newEvents[0].type, "completed");
  assert.deepEqual(
    newEvents.filter((event) => event.type === "skipped").map((event) => event.stageId),
    ["assessment", "ai-interview", "first-interview"],
  );
  assert.equal(newEvents.at(-1).type, "entered");
});

test("回退到之前阶段会写入重开记录", () => {
  const later = moveToStage(sample(), "second-interview", {}, NOW);
  const reopened = moveToStage(later, "first-interview", { note: "增加一轮技术面" }, NOW);

  assert.equal(reopened.currentStageId, "first-interview");
  assert.equal(reopened.timeline.at(-2).type, "reopened");
  assert.equal(reopened.timeline.at(-2).note, "增加一轮技术面");
});

test("编辑流程时不会删除已经到达过的环节", () => {
  const later = moveToStage(sample(), "first-interview", {}, NOW);
  const edited = updateApplication(later, {
    company: later.company,
    position: later.position,
    pipeline: ["applied", "offer"],
  }, NOW);

  assert.ok(edited.pipeline.includes("assessment"));
  assert.ok(edited.pipeline.includes("ai-interview"));
  assert.ok(edited.pipeline.includes("first-interview"));
});

test("结束和重新开启流程都会保留当前阶段", () => {
  const application = moveToStage(sample(), "first-interview", {}, NOW);
  const rejected = setOutcome(application, "rejected", { note: "岗位冻结" }, NOW);
  const reopened = setOutcome(rejected, "active", { note: "岗位恢复" }, NOW);

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.currentStageId, "first-interview");
  assert.equal(reopened.status, "active");
  assert.equal(reopened.timeline.at(-1).type, "reopened");
});

test("跟进日期在今天或之前时视为待跟进", () => {
  const today = new Date(2026, 7, 30, 9, 0, 0);
  assert.equal(isFollowUpDue({ ...sample(), nextFollowUp: "2026-08-30" }, today), true);
  assert.equal(isFollowUpDue({ ...sample(), nextFollowUp: "2026-08-31" }, today), false);
  assert.equal(isFollowUpDue({ ...sample(), nextFollowUp: "2026-08-29", status: "rejected" }, today), false);
});

test("统计只把实际面试阶段计入面试中", () => {
  const applied = sample();
  const interviewing = moveToStage(sample({ company: "云帆" }), "ai-interview", {}, NOW);
  const offered = completeCurrentStage(sample({ company: "北辰", pipeline: ["applied", "offer"] }), {}, NOW);
  const summary = summarize([applied, interviewing, offered]);

  assert.deepEqual(summary, { total: 3, active: 2, interviewing: 1, offers: 1, due: 0 });
});

test("导入合并时相同 ID 保留更新时间较新的版本", () => {
  const original = sample();
  const older = { ...original, company: "旧名称", updatedAt: "2026-08-29T00:00:00.000Z" };
  const newer = { ...original, company: "新名称", updatedAt: "2026-08-31T00:00:00.000Z" };
  const merged = mergeApplications([older], parseImportPayload({ applications: [newer] }));

  assert.equal(merged.length, 1);
  assert.equal(merged[0].company, "新名称");
});

test("损坏的导入结构会给出明确错误", () => {
  assert.throws(() => parseImportPayload({ records: [] }), /没有可识别的投递记录/);
});

test("旧数据缺字段时可以安全规范化", () => {
  const normalized = normalizeApplication({ company: "旧公司", position: "旧岗位" });

  assert.equal(normalized.company, "旧公司");
  assert.equal(normalized.status, "active");
  assert.deepEqual(normalized.pipeline, DEFAULT_PIPELINE);
  assert.ok(Array.isArray(normalized.timeline));
});
