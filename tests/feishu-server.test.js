import test from "node:test";
import assert from "node:assert/strict";

import { createFeishuSnapshotFetcher } from "../server/feishu-sync/service.js";

const NOW = new Date("2026-08-30T08:00:00.000Z");

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

test("云函数只请求并返回白名单字段，支持 Wiki Base 与分页", async () => {
  const requests = [];
  const pages = [
    {
      code: 0,
      data: {
        has_more: true,
        page_token: "page-2",
        items: [{
          record_id: "rec001",
          fields: {
            投递公司: "星河科技",
            "链接/邮箱": { link: "https://jobs.example.com/1", text: "岗位" },
            投递时间: 1788076800000,
            岗位: "前端工程师",
            目前的进度: "一面",
            简历附件: { url: "https://private.example.com/resume.pdf" },
          },
        }],
      },
    },
    {
      code: 0,
      data: {
        has_more: false,
        items: [{
          record_id: "rec002",
          fields: {
            投递公司: "远山科技",
            "链接/邮箱": "jobs@example.com",
            投递时间: "2026-08-29",
            岗位: "产品经理",
            目前的进度: "在线测试",
          },
        }],
      },
    },
  ];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ url: parsed, options });
    if (parsed.pathname.endsWith("/auth/v3/tenant_access_token/internal")) {
      return response({ code: 0, tenant_access_token: "tenant-token", expire: 7200 });
    }
    if (parsed.pathname.endsWith("/wiki/v2/spaces/get_node")) {
      return response({ code: 0, data: { node: { obj_type: "bitable", obj_token: "base-token" } } });
    }
    return response(pages.shift());
  };
  const fetchSnapshot = createFeishuSnapshotFetcher({
    environment: {
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret",
      FEISHU_WIKI_TOKEN: "wiki-token",
      FEISHU_TABLE_ID: "table-id",
      FEISHU_VIEW_ID: "view-id",
    },
    fetchImpl,
    now: () => NOW,
  });

  const snapshot = await fetchSnapshot();
  assert.equal(snapshot.source, "feishu");
  assert.equal(snapshot.syncedAt, NOW.toISOString());
  assert.equal(snapshot.records.length, 2);
  assert.deepEqual(snapshot.records[0], {
    recordId: "rec001",
    company: "星河科技",
    applicationTarget: "https://jobs.example.com/1",
    appliedAt: "1788076800000",
    position: "前端工程师",
    progress: "一面",
    sourceUpdatedAt: "",
  });
  assert.equal("resume" in snapshot.records[0], false);

  const recordRequests = requests.filter(({ url }) => url.pathname.includes("/bitable/v1/apps/"));
  assert.equal(recordRequests.length, 2);
  assert.deepEqual(JSON.parse(recordRequests[0].url.searchParams.get("field_names")), [
    "投递公司",
    "链接/邮箱",
    "投递时间",
    "岗位",
    "目前的进度",
  ]);
  assert.equal(recordRequests[0].url.searchParams.get("view_id"), "view-id");
  assert.equal(recordRequests[1].url.searchParams.get("page_token"), "page-2");
  assert.equal(recordRequests[0].options.headers.Authorization, "Bearer tenant-token");
});

test("可直接使用 Base app_token，且缺失环境变量会明确失败", async () => {
  const requests = [];
  const fetchSnapshot = createFeishuSnapshotFetcher({
    environment: {
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret",
      FEISHU_APP_TOKEN: "base-token",
      FEISHU_TABLE_ID: "table-id",
    },
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requests.push(parsed.pathname);
      if (parsed.pathname.endsWith("/auth/v3/tenant_access_token/internal")) {
        return response({ code: 0, tenant_access_token: "tenant-token", expire: 7200 });
      }
      return response({ code: 0, data: { has_more: false, items: [] } });
    },
    now: () => NOW,
  });
  await fetchSnapshot();
  assert.equal(requests.some((path) => path.includes("/wiki/")), false);

  const invalidFetcher = createFeishuSnapshotFetcher({
    environment: {},
    fetchImpl: async () => response({ code: 0 }),
    now: () => NOW,
  });
  await assert.rejects(invalidFetcher(), /FEISHU_APP_ID/);
});
