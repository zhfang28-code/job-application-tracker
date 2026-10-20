import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as model from "../src/model.js";
import * as pagination from "../src/pagination.js";
import { saveApplications } from "../src/storage.js";

const NOW = new Date("2026-10-15T08:00:00Z");
const source = (await readFile(new URL("../src/app.js", import.meta.url), "utf8"))
  .replace(/^import\s[\s\S]*?from\s+"[^"\n]+";\s*/gm, "")
  .replace(/\binitialize\(\);\s*$/, "");

function loadUi(applications, confirmed = true) {
  const nodes = new Map();
  const storage = new Map();
  const confirmations = [];
  const preferences = new Map();
  let renders = 0;
  const element = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: "",
      open: false,
      classList: { toggle() {} },
      close() { this.open = false; },
      append() {},
      replaceChildren() { this.innerHTML = ""; },
      scrollIntoView() {},
      focus() {},
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    ...model,
    ...pagination,
    console,
    loadApplications: () => applications,
    loadPreference: (_key, fallback) => fallback,
    savePreference: (key, value) => preferences.set(key, String(value)),
    saveApplications: (records) => saveApplications(records, { setItem: (key, value) => storage.set(key, value) }),
    document: { querySelector: element, querySelectorAll: () => [], createElement: () => element("toast") },
    window: { confirm: (message) => { confirmations.push(message); return confirmed; }, setTimeout() {} },
    countRender: () => { renders += 1; },
  });
  vm.runInContext(source, context);
  vm.runInContext("renderAll = () => { countRender(); renderList(applications); };", context);
  return { context, nodes, storage, confirmations, preferences, get renders() { return renders; } };
}

function application(company, stage = "assessment") {
  return model.moveToStage(model.createApplication({ company, position: "机械工程师", pipeline: ["applied", stage, "offer"] }, NOW), stage, {}, NOW);
}

test("列表和卡片按当前测评或面试环节显示已完成与未完成，不把暂停误认为完成", () => {
  const assessment = application("待测评公司");
  const completedAssessment = model.markCurrentStageCompleted(application("已测评公司"), {}, NOW);
  const interview = application("待面试公司", "first-interview");
  const completedInterview = model.markCurrentStageCompleted(application("已面试公司", "ai-interview"), {}, NOW);
  const ui = loadUi([assessment, completedAssessment, interview, completedInterview]);
  for (const [record, label] of [[assessment, "未完成"], [completedAssessment, "已完成"], [interview, "未完成"], [completedInterview, "已完成"]]) {
    ui.context.record = record;
    const card = vm.runInContext("cardHtml(record)", ui.context);
    assert.match(card, new RegExp(`${record.currentStageId === "assessment" ? "在线测试" : model.stageById(record.currentStageId).label}：${label}`));
    assert.match(card, new RegExp(`stage-completion-tag ${label === "已完成" ? "completed" : "pending"}-stage-tag`));
  }
  vm.runInContext("renderList(applications)", ui.context);
  const html = ui.nodes.get("#list-view").innerHTML;
  assert.match(html, /本环节完成情况/);
  assert.equal((html.match(/completed-stage-tag/g) ?? []).length, 2);
  assert.equal((html.match(/pending-stage-tag/g) ?? []).length, 2);
  assert.equal((html.match(/data-action="delete"/g) ?? []).length, 4);
  ui.context.record = model.setOutcome(interview, "paused", {}, NOW);
  assert.equal(vm.runInContext("stageCompletionHtml(record)", ui.context), "");
});

test("取消删除会保留所有记录，不写存储或刷新统计", () => {
  const record = application("取消删除公司");
  const ui = loadUi([record], false);
  ui.context.recordId = record.id;
  vm.runInContext("deleteApplicationRecord(recordId)", ui.context);
  assert.equal(vm.runInContext("applications.length", ui.context), 1);
  assert.equal(ui.storage.size, 0);
  assert.equal(ui.renders, 0);
  assert.equal(ui.confirmations.length, 1);
  assert.match(ui.confirmations[0], /取消删除公司/);
});

test("确认删除只移除指定投递，保留同名公司的其他记录并关闭被删记录详情", () => {
  const first = application("同名公司");
  const second = application("同名公司", "first-interview");
  const ui = loadUi([first, second]);
  ui.context.recordId = first.id;
  ui.nodes.get("#detail-dialog").open = true;
  vm.runInContext("activeDetailId = recordId; deleteApplicationRecord(recordId)", ui.context);
  const saved = JSON.parse(ui.storage.get(model.STORAGE_KEY));
  assert.deepEqual(saved.applications.map((record) => record.id), [second.id]);
  assert.equal(vm.runInContext("activeDetailId", ui.context), null);
  assert.equal(ui.nodes.get("#detail-dialog").open, false);
  assert.equal(ui.renders, 1);
  assert.match(ui.nodes.get("#list-view").innerHTML, new RegExp(second.id));
  assert.doesNotMatch(ui.nodes.get("#list-view").innerHTML, new RegExp(first.id));
});

test("看板与列表只渲染本页公司，切换视图保留页码，筛选后回第一页", () => {
  const records = Array.from({ length: 25 }, (_, index) => application(`分页公司${index}`));
  const ui = loadUi(records);
  vm.runInContext("renderWorkspace(); changeCompanyPage(2);", ui.context);
  assert.equal(vm.runInContext("companyPage", ui.context), 2);
  assert.equal(ui.nodes.get("#visible-count").textContent, "25 个机会");
  assert.equal((ui.nodes.get("#pipeline-board").innerHTML.match(/data-application-id=/g) ?? []).length, 12);
  assert.equal((ui.nodes.get("#list-view").innerHTML.match(/<tr data-open-detail=/g) ?? []).length, 12);
  assert.match(ui.nodes.get("#company-pagination-top").innerHTML, /13–24/);
  vm.runInContext("view = 'list'; renderWorkspace();", ui.context);
  assert.equal(vm.runInContext("companyPage", ui.context), 2);
  vm.runInContext("filters.search = '分页公司24'; renderWorkspace();", ui.context);
  assert.equal(vm.runInContext("companyPage", ui.context), 1);
  assert.equal(ui.nodes.get("#visible-count").textContent, "1 个机会");
  vm.runInContext("filters.search = '没有这样的公司'; renderWorkspace();", ui.context);
  assert.equal(ui.nodes.get("#company-pagination-top").hidden, true);
  assert.equal(ui.nodes.get("#company-pagination-bottom").hidden, true);
});

test("删除最后一页唯一公司后自动回上一页，更改每页数量从第一页开始并保存偏好", () => {
  const records = Array.from({ length: 25 }, (_, index) => application(`边界公司${index}`));
  const ui = loadUi(records);
  ui.context.recordId = records.at(-1).id;
  vm.runInContext("renderAll = () => renderWorkspace(); renderWorkspace(); changeCompanyPage(3); deleteApplicationRecord(recordId);", ui.context);
  assert.equal(vm.runInContext("companyPage", ui.context), 2);
  assert.equal(ui.nodes.get("#visible-count").textContent, "24 个机会");
  assert.match(ui.nodes.get("#company-pagination-top").innerHTML, /13–24/);
  assert.match(ui.nodes.get("#pipeline-board").innerHTML, /12 \/ 24/);
  vm.runInContext("changeCompanyPageSize(24)", ui.context);
  assert.equal(vm.runInContext("companyPage", ui.context), 1);
  assert.equal(ui.preferences.get("company-page-size"), "24");
  assert.equal((ui.nodes.get("#list-view").innerHTML.match(/<tr data-open-detail=/g) ?? []).length, 24);
});
