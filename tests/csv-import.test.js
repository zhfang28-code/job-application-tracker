import test from "node:test";
import assert from "node:assert/strict";

import { createApplication } from "../src/model.js";
import {
  mapCsvProgress,
  mergeCsvApplications,
  parseCsvText,
  readJobCsv,
} from "../src/csv-import.js";

const IMPORTED_AT = "2026-08-30T08:00:00.000Z";
const FALLBACK_DATE = "2026-08-30";

test("CSV 解析支持 BOM、逗号、换行和转义引号", () => {
  const rows = parseCsvText('\uFEFF单位,岗位,备注\r\n"星河,科技",工程师,"第一行\n第二行"\r\n远山科技,产品经理,"含""引号"""');
  assert.deepEqual(rows, [
    ["单位", "岗位", "备注"],
    ["星河,科技", "工程师", "第一行\n第二行"],
    ["远山科技", "产品经理", '含"引号"'],
  ]);
});

test("按用户表格列名提取重点字段并忽略简历等无关列", () => {
  const csv = [
    "单位,岗位,城市|工作地,投递链接,状态,测评|笔试,简历附件",
    "新奥集团,结构工程师,廊坊,https://jobs.example.com/1,已投递,,resume.pdf",
    "长鑫科技,研发工程师,北京,jobs@example.com,已线上测评,AI面,private.docx",
    ",缺少公司,上海,https://jobs.example.com/3,已投递,,secret.pdf",
  ].join("\r\n");
  const result = readJobCsv(csv, { fallbackAppliedAt: FALLBACK_DATE });

  assert.deepEqual(result.stats, {
    totalRows: 3,
    validRows: 2,
    skippedMissingRequired: 1,
    skippedDuplicates: 0,
    fallbackDateCount: 2,
  });
  assert.equal(result.records[0].company, "新奥集团");
  assert.equal(result.records[0].city, "廊坊");
  assert.equal(result.records[1].applicationTarget, "jobs@example.com");
  assert.equal(result.records[1].progress.stageId, "ai-interview");
  assert.equal("resume" in result.records[0], false);
});

test("状态与测评列会合并为当前阶段和结果", () => {
  assert.deepEqual(mapCsvProgress("已投递", ""), {
    raw: "已投递",
    stageId: "applied",
    status: "active",
    priorStageIds: [],
  });
  assert.equal(mapCsvProgress("已线上测评", "AI面").stageId, "ai-interview");
  assert.equal(mapCsvProgress("已线上测评", "一面").stageId, "first-interview");
  assert.equal(mapCsvProgress("拒绝", "AI面").status, "rejected");
  assert.equal(mapCsvProgress("人才库", "").status, "paused");
  assert.equal(mapCsvProgress("需线上测评", "").stageId, "assessment");
});

test("首次导入会创建动态流程并识别链接或邮箱", () => {
  const parsed = readJobCsv([
    "单位,岗位,城市|工作地,投递链接,状态,测评|笔试",
    "星河科技,前端工程师,上海,jobs@example.com,已线上测评,一面",
    "远山科技,后端工程师,北京,https://jobs.example.com/2,拒绝,",
  ].join("\n"), { fallbackAppliedAt: FALLBACK_DATE });
  const result = mergeCsvApplications([], parsed.records, { importedAt: IMPORTED_AT });

  assert.deepEqual(result.stats, { received: 2, created: 2, updated: 0, unchanged: 0 });
  const interviewing = result.applications.find((application) => application.company === "星河科技");
  const rejected = result.applications.find((application) => application.company === "远山科技");
  assert.equal(interviewing.applicationEmail, "jobs@example.com");
  assert.deepEqual(interviewing.pipeline, ["applied", "assessment", "first-interview", "offer"]);
  assert.equal(interviewing.currentStageId, "first-interview");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.jobUrl, "https://jobs.example.com/2");
  assert.equal(interviewing.importSource.format, "csv");
});

test("重复导入不会产生重复记录或时间线", () => {
  const parsed = readJobCsv([
    "单位,岗位,投递链接,状态",
    "星河科技,前端工程师,https://jobs.example.com/1,已投递",
  ].join("\n"), { fallbackAppliedAt: FALLBACK_DATE });
  const first = mergeCsvApplications([], parsed.records, { importedAt: IMPORTED_AT });
  const timelineLength = first.applications[0].timeline.length;
  const second = mergeCsvApplications(first.applications, parsed.records, {
    importedAt: "2026-08-31T08:00:00.000Z",
  });

  assert.equal(second.applications.length, 1);
  assert.deepEqual(second.stats, { received: 1, created: 0, updated: 0, unchanged: 1 });
  assert.equal(second.applications[0].timeline.length, timelineLength);
  assert.equal(second.applications[0].appliedAt.slice(0, 10), FALLBACK_DATE);
});

test("CSV 无日期时不会覆盖已有记录的真实投递日期和本地备注", () => {
  const existing = createApplication({
    company: "星河科技",
    position: "前端工程师",
    city: "杭州",
    jobUrl: "https://jobs.example.com/1",
    appliedAt: "2026-08-01",
    notes: "保留这条本地备注",
  }, new Date(IMPORTED_AT));
  const parsed = readJobCsv([
    "单位,岗位,城市|工作地,投递链接,状态",
    "星河科技,前端工程师,上海,https://jobs.example.com/1,需线上测评",
  ].join("\n"), { fallbackAppliedAt: FALLBACK_DATE });
  const result = mergeCsvApplications([existing], parsed.records, { importedAt: IMPORTED_AT });

  assert.equal(result.applications.length, 1);
  assert.equal(result.applications[0].appliedAt.slice(0, 10), "2026-08-01");
  assert.equal(result.applications[0].notes, "保留这条本地备注");
  assert.equal(result.applications[0].city, "上海");
  assert.equal(result.applications[0].currentStageId, "assessment");
});

test("缺少公司或岗位列时给出明确错误", () => {
  assert.throws(
    () => readJobCsv("城市,状态\n上海,已投递", { fallbackAppliedAt: FALLBACK_DATE }),
    /公司（单位）、岗位/,
  );
});
