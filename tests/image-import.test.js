import test from "node:test";
import assert from "node:assert/strict";
import { extractRecruitmentFields } from "../src/image-import.js";

test("提取招聘弹窗中的公司、多个工作地点和跨行专业，不混入截止时间或按钮", () => {
  const result = extractRecruitmentFields(`中电建宁夏工程有限公司
27届秋招 国央企 建筑/地产
工作地点 西安、银川
截止时间 12月9日截止
招聘职位
电气工程及其自动化、高压输配电工程、测控技术与仪器、安全工程、
应急技术与管理、工程管理、工程造价、机械设计制造及其自动化、焊
接技术与工程、能源与动力工程、自动化、审计学、会计学、财务管
理、汉语言文学、......
打开官网投递
关闭`);
  assert.equal(result.company, "中电建宁夏工程有限公司");
  assert.deepEqual(result.cities, ["西安", "银川"]);
  assert.equal(result.positions.length, 15);
  assert.ok(result.positions.includes("焊接技术与工程"));
  assert.ok(result.positions.includes("财务管理"));
  assert.equal(result.address, "");
});

test("兼容 OCR 中文字间空格、逐行岗位和完整工作地址", () => {
  const result = extractRecruitmentFields(`公 司 名 称：远 山 科 技 有 限 公 司
工 作 地 点：江苏省苏州市工业园区星湖街88号
招 聘 岗 位：
1. 结构工程师
2. 机械工程师
任职要求：本科及以上
机械相关专业`);
  assert.equal(result.company, "远山科技有限公司");
  assert.deepEqual(result.cities, ["苏州"]);
  assert.deepEqual(result.positions, ["结构工程师", "机械工程师"]);
  assert.equal(result.address, "江苏省苏州市工业园区星湖街88号");
  assert.deepEqual(extractRecruitmentFields("工作地址：上海市黄浦区南京东路88号").cities, ["上海"]);
});

test("同一行标签、英文岗位和重复字段可以解析，未知内容不猜工作地点", () => {
  const result = extractRecruitmentFields("公司名称：星河科技 工作地点：上海/杭州 招聘岗位：C++ Engineer、AI研究员、AI研究员\n薪资：20k");
  assert.equal(result.company, "星河科技");
  assert.deepEqual(result.cities, ["上海", "杭州"]);
  assert.deepEqual(result.positions, ["C++ Engineer", "AI研究员"]);
  assert.deepEqual(extractRecruitmentFields("无法识别的内容\n关闭").cities, []);
});

test("处理截图关闭图标与漏识别的浅色招聘职位标题", () => {
  const result = extractRecruitmentFields(`中电建宁夏工程有限公司               X
27届秋招 国央企 建筑/地产
工作地点“ 西安、银川
截止时间 12月9日截止
电气工程及其自动化、高压输配电工程、
机械设计制造及其自动化、焊
接技术与工程、财务管理、汉语言文学、.….\n打开官网投递关闭`);
  assert.equal(result.company, "中电建宁夏工程有限公司");
  assert.deepEqual(result.cities, ["西安", "银川"]);
  assert.deepEqual(result.positions, ["电气工程及其自动化", "高压输配电工程", "机械设计制造及其自动化", "焊接技术与工程", "财务管理", "汉语言文学"]);
});
