import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readProjectFile = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("页面、模块与 Service Worker 使用同一发布版本", async () => {
  const [html, app, csvImport, storage, serviceWorker] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("src/app.js"),
    readProjectFile("src/csv-import.js"),
    readProjectFile("src/storage.js"),
    readProjectFile("sw.js"),
  ]);
  const release = serviceWorker.match(/const RELEASE = "([^"]+)";/)?.[1];
  assert.ok(release, "Service Worker 必须声明发布版本");

  const versionReferences = [html, app, csvImport, storage]
    .flatMap((source) => [...source.matchAll(/\?v=([0-9-]+)/g)].map((match) => match[1]));
  assert.ok(versionReferences.length >= 7);
  assert.deepEqual([...new Set(versionReferences)], [release]);
  assert.ok(html.indexOf("serviceWorker.register") < html.indexOf('script type="module"'));
  assert.match(serviceWorker, /event\.request\.mode === "navigate"/);
  assert.doesNotMatch(serviceWorker, /cached \?\? caches\.match\("\.\/index\.html"\)/);
});

test("新版概览所需的统计节点完整存在", async () => {
  const html = await readProjectFile("index.html");
  for (const id of [
    "stat-total",
    "stat-ongoing",
    "stat-assessment",
    "stat-interviewing",
    "stat-offers",
    "nav-followup",
    "nav-closed",
    "open-job-link-button",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});
