import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const debugPort = process.env.JOBTRAIL_CDP_PORT ?? "9333";
const baseUrl = `http://127.0.0.1:${debugPort}`;
const appUrl = process.env.JOBTRAIL_URL ?? "http://127.0.0.1:4173/";
const screenshotDir = process.env.JOBTRAIL_SCREENSHOT_DIR ?? join(process.cwd(), "screenshots");

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function findPageTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await fetch(`${baseUrl}/json/list`).then((response) => response.json());
      const target = targets.find((item) => item.type === "page");
      if (target) return target;
    } catch {
      // Chrome may still be starting.
    }
    await sleep(150);
  }
  throw new Error(`Could not connect to Chrome DevTools on port ${debugPort}`);
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.browserExceptions = [];
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        const description = message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text;
        this.browserExceptions.push(description);
        console.error("Browser exception:", description);
      }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
  }
  return result.result.value;
}

async function waitFor(client, expression, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(client, expression)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function saveScreenshot(client, filename) {
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });
  await writeFile(join(screenshotDir, filename), Buffer.from(data, "base64"));
}

const target = await findPageTarget();
const client = new CdpClient(target.webSocketDebuggerUrl);

try {
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send("Page.navigate", { url: appUrl });
  await waitFor(client, "document.readyState === 'complete' && document.documentElement.dataset.appReady === 'true'");

  await evaluate(client, "document.documentElement.dataset.appReady = 'reloading'; localStorage.clear(); location.reload(); true");
  await waitFor(client, "document.readyState === 'complete' && document.documentElement.dataset.appReady === 'true' && document.querySelector('#stat-total')?.textContent === '0'");
  client.browserExceptions.length = 0;
  assert.equal(await evaluate(client, "document.querySelectorAll('.application-card').length"), 0);

  await evaluate(client, "document.querySelector('#add-application-button').click(); true");
  await waitFor(client, "document.querySelector('#application-dialog').open");

  await evaluate(client, `(() => {
    const form = document.querySelector('#application-form');
    form.elements.company.value = '星河科技';
    form.elements.position.value = '前端开发工程师';
    form.elements.city.value = '上海';
    form.elements.salary.value = '25k–35k · 14薪';
    form.elements.source.value = '官网';
    form.elements.jobUrl.value = 'https://example.com/jobs/frontend';
    form.elements.nextFollowUp.value = '2026-08-30';
    form.elements.tags.value = '重点，内推';
    form.elements.notes.value = '重点准备 React 性能优化与项目难点。';
    for (const id of ['assessment', 'ai-interview', 'second-interview', 'final-interview', 'hr-interview']) {
      form.querySelector('[name="pipeline"][value="' + id + '"]').checked = false;
    }
    form.requestSubmit();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('#stat-total')?.textContent === '1'");
  if (await evaluate(client, "document.querySelectorAll('.application-card').length") !== 1) {
    console.error(await evaluate(client, `JSON.stringify({
      board: document.querySelector('#pipeline-board').innerHTML,
      emptyClass: document.querySelector('#empty-state').className,
      storage: localStorage.getItem('jobtrail.applications.v1')
    })`));
  }
  assert.equal(await evaluate(client, "document.querySelectorAll('.application-card').length"), 1);
  assert.equal(await evaluate(client, "document.querySelector('.application-card').textContent.includes('星河科技')"), true);

  await evaluate(client, "document.querySelector('[data-action=\"progress\"]').click(); true");
  await waitFor(client, "document.querySelector('#progress-dialog').open");
  await evaluate(client, `(() => {
    const form = document.querySelector('#progress-form');
    form.elements.note.value = '网申已确认，直接进入一面';
    form.requestSubmit();
    return true;
  })()`);
  await waitFor(client, "!document.querySelector('#progress-dialog').open && document.querySelector('.application-card')?.textContent.includes('一面')");

  const stored = await evaluate(client, `(() => {
    const payload = JSON.parse(localStorage.getItem('jobtrail.applications.v1'));
    const app = payload.applications[0];
    return { currentStageId: app.currentStageId, timelineLength: app.timeline.length };
  })()`);
  assert.deepEqual(stored, { currentStageId: "first-interview", timelineLength: 3 });

  await evaluate(client, "document.querySelector('.application-card').click(); true");
  await waitFor(client, "document.querySelector('#detail-dialog').open && document.querySelector('#detail-content').textContent.includes('网申已确认')");
  assert.equal(await evaluate(client, "document.querySelector('#detail-content').textContent.includes('重点准备 React')"), true);
  await sleep(3300);
  await saveScreenshot(client, "detail-desktop.png");
  await evaluate(client, "document.querySelector('[data-close-dialog=\"detail-dialog\"]').click(); true");

  await saveScreenshot(client, "filled-desktop.png");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(250);
  await saveScreenshot(client, "filled-mobile.png");
  assert.deepEqual(client.browserExceptions, []);

  console.log("Browser smoke test passed: create → customize pipeline → advance → timeline → responsive render");
} finally {
  client.close();
}
