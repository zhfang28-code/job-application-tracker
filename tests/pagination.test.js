import test from "node:test";
import assert from "node:assert/strict";
import { paginateItems, paginationPages } from "../src/pagination.js";

test("840 条公司记录逐页查看不重复、不遗漏，也不会修改原数组", () => {
  const records = Array.from({ length: 840 }, (_, id) => ({ id }));
  const shown = [];
  for (let page = 1; page <= 70; page += 1) {
    const result = paginateItems(records, page, 12);
    assert.equal(result.total, 840);
    assert.equal(result.totalPages, 70);
    assert.equal(result.items.length, 12);
    shown.push(...result.items.map((record) => record.id));
  }
  assert.deepEqual(shown, records.map((record) => record.id));
  assert.equal(records.length, 840);
});

test("最后一页记录被删后回到有效页码，空结果不产生无效范围", () => {
  const records = Array.from({ length: 25 }, (_, id) => id);
  assert.deepEqual(paginateItems(records, 3).items, [24]);
  const result = paginateItems(records.slice(0, 24), 3);
  assert.equal(result.page, 2);
  assert.equal(result.start, 13);
  assert.equal(result.end, 24);
  assert.deepEqual(paginateItems([], 8), { items: [], page: 1, pageSize: 12, total: 0, totalPages: 1, start: 0, end: 0 });
});

test("每页数量、无效页码及长页码导航均有边界保护", () => {
  const records = Array.from({ length: 100 }, (_, id) => id);
  assert.equal(paginateItems(records, 2, 24).start, 25);
  assert.equal(paginateItems(records, 2, "48").end, 96);
  assert.equal(paginateItems(records, 999).page, 9);
  for (const page of [0, -1, NaN, Infinity, "abc", 1.5]) assert.equal(paginateItems(records, page).page, 1);
  assert.equal(paginateItems(records, 1, 0).pageSize, 12);
  assert.deepEqual(paginationPages(1, 3), [1, 2, 3]);
  for (const page of [1, 2, 4, 30, 67, 69, 70]) {
    const numbers = paginationPages(page, 70).filter((item) => typeof item === "number");
    assert.ok(numbers.includes(page));
    assert.equal(numbers[0], 1);
    assert.equal(numbers.at(-1), 70);
    assert.equal(new Set(numbers).size, numbers.length);
  }
});
