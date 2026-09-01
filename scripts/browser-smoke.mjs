import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const debugPort = process.env.JOBTRAIL_CDP_PORT ?? "9333";
const baseUrl = `http://127.0.0.1:${debugPort}`;
const appUrl = process.env.JOBTRAIL_URL ?? "http://127.0.0.1:4173/";
const screenshotDir = process.env.JOBTRAIL_SCREENSHOT_DIR ?? join(process.cwd(), "screenshots");

await mkdir(screenshotDir, { recursive: true });

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
  await waitFor(client, "navigator.serviceWorker.controller?.scriptURL.includes('v=20260901-2')", 10000);
  await waitFor(client, "caches.keys().then((keys) => keys.filter((key) => key.startsWith('jobtrail-static-')).length === 1 && keys.includes('jobtrail-static-20260901-2'))", 10000);

  const releaseAssets = await evaluate(client, `(() => ({
    stylesheet: document.querySelector('link[rel="stylesheet"]')?.href.includes('v=20260901-2'),
    module: document.querySelector('script[type="module"]')?.src.includes('v=20260901-2'),
    worker: navigator.serviceWorker.controller?.scriptURL.includes('v=20260901-2'),
  }))()`);
  assert.deepEqual(releaseAssets, { stylesheet: true, module: true, worker: true });

  await evaluate(client, "document.documentElement.dataset.appReady = 'reloading'; localStorage.clear(); location.reload(); true");
  await waitFor(client, "document.readyState === 'complete' && document.documentElement.dataset.appReady === 'true' && document.querySelector('#stat-total')?.textContent === '0'");
  client.browserExceptions.length = 0;
  assert.equal(await evaluate(client, "document.querySelectorAll('.application-card').length"), 0);

  await evaluate(client, "document.querySelector('#add-application-button').click(); true");
  await waitFor(client, "document.querySelector('#application-dialog').open");
  assert.deepEqual(await evaluate(client, `(() => {
    const link = document.querySelector('#open-job-link-button');
    return { disabled: link.getAttribute('aria-disabled'), href: link.getAttribute('href') };
  })()`), { disabled: "true", href: null });
  await sleep(250);
  await saveScreenshot(client, "new-application-desktop.png");

  await evaluate(client, `(() => {
    const form = document.querySelector('#application-form');
    if (form.elements.source || form.elements.contact) throw new Error('Removed fields are still present');
    form.elements.position.value = '前端开发工程师';
    form.elements.city.value = '上海';
    form.elements.salary.value = '25k–35k · 14薪';
    form.elements.jobUrl.value = 'https://jobs.example.com/frontend?companyName=%E6%98%9F%E6%B2%B3%E7%A7%91%E6%8A%80';
    form.elements.jobUrl.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#analyze-job-link-button').click();
    if (form.elements.company.value !== '星河科技') throw new Error('Company inference failed');
    const directLink = document.querySelector('#open-job-link-button');
    if (directLink.getAttribute('aria-disabled') !== 'false') throw new Error('Direct link was not enabled');
    if (directLink.href !== form.elements.jobUrl.value) throw new Error('Direct link URL mismatch');
    if (directLink.target !== '_blank' || !directLink.rel.includes('noopener')) throw new Error('Direct link is not safely opened in a new tab');
    form.elements.nextFollowUp.value = '2026-08-30';
    form.elements.tags.value = '重点，内推';
    form.elements.notes.value = '重点准备 React 性能优化与项目难点。';
    return true;
  })()`);
  await sleep(250);
  await saveScreenshot(client, "company-inference-desktop.png");
  await evaluate(client, "document.querySelector('#application-form').requestSubmit(); true");
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
  await sleep(250);
  await saveScreenshot(client, "progress-desktop.png");
  await evaluate(client, `(() => {
    const form = document.querySelector('#progress-form');
    form.elements.nextStageId.value = 'first-interview';
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
  const detailFontSizes = await evaluate(client, `(() => ({
    company: Number.parseFloat(getComputedStyle(document.querySelector('.detail-company-row h2')).fontSize),
    section: Number.parseFloat(getComputedStyle(document.querySelector('.detail-section h3')).fontSize),
    notes: Number.parseFloat(getComputedStyle(document.querySelector('.detail-notes')).fontSize),
    drawerWidth: document.querySelector('#detail-dialog').getBoundingClientRect().width,
  }))()`);
  assert.equal(detailFontSizes.company >= 30, true);
  assert.equal(detailFontSizes.section >= 16, true);
  assert.equal(detailFontSizes.notes >= 14, true);
  assert.equal(detailFontSizes.drawerWidth >= 700, true);
  await sleep(3300);
  await saveScreenshot(client, "detail-desktop.png");
  await evaluate(client, "document.querySelector('[data-close-dialog=\"detail-dialog\"]').click(); true");

  await evaluate(client, `(() => {
    window.confirm = () => true;
    const csv = [
      '单位,岗位,城市|工作地,投递链接,状态,测评|笔试,简历附件',
      '远山科技,后端工程师,北京,jobs@example.com,需线上测评,,resume.pdf',
      '平川机械,工艺工程师,苏州,hr@pingchuan.cn,已投递,,resume.pdf'
    ].join('\\n');
    const transfer = new DataTransfer();
    transfer.items.add(new File([csv], 'applications.csv', { type: 'text/csv' }));
    const input = document.querySelector('#csv-import-file');
    Object.defineProperty(input, 'files', { value: transfer.files, configurable: true });
    input.dispatchEvent(new Event('change'));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('#stat-total')?.textContent === '3' && document.body.textContent.includes('远山科技') && document.body.textContent.includes('平川机械')");
  const csvImported = await evaluate(client, `(() => {
    const payload = JSON.parse(localStorage.getItem('jobtrail.applications.v1'));
    const assessment = payload.applications.find((item) => item.company === '远山科技');
    const ongoing = payload.applications.find((item) => item.company === '平川机械');
    return {
      assessment: { currentStageId: assessment.currentStageId, email: assessment.applicationEmail, source: assessment.importSource?.format },
      ongoing: { currentStageId: ongoing.currentStageId, email: ongoing.applicationEmail, source: ongoing.importSource?.format },
    };
  })()`);
  assert.deepEqual(csvImported, {
    assessment: { currentStageId: "assessment", email: "jobs@example.com", source: "csv" },
    ongoing: { currentStageId: "applied", email: "hr@pingchuan.cn", source: "csv" },
  });

  const mutuallyExclusiveCounts = await evaluate(client, `(() => ({
    total: Number(document.querySelector('#stat-total').textContent),
    ongoing: Number(document.querySelector('#stat-ongoing').textContent),
    assessment: Number(document.querySelector('#stat-assessment').textContent),
    interviewing: Number(document.querySelector('#stat-interviewing').textContent),
    offers: Number(document.querySelector('#stat-offers').textContent),
    due: Number(document.querySelector('#nav-followup').textContent),
    closed: Number(document.querySelector('#nav-closed').textContent),
  }))()`);
  assert.deepEqual(mutuallyExclusiveCounts, {
    total: 3,
    ongoing: 1,
    assessment: 1,
    interviewing: 1,
    offers: 0,
    due: 1,
    closed: 0,
  });
  assert.equal(
    mutuallyExclusiveCounts.ongoing
      + mutuallyExclusiveCounts.assessment
      + mutuallyExclusiveCounts.interviewing
      + mutuallyExclusiveCounts.offers
      + mutuallyExclusiveCounts.closed,
    mutuallyExclusiveCounts.total,
  );

  await evaluate(client, "document.querySelector('[data-quick-filter=\"followup\"]').click(); true");
  await waitFor(client, "document.querySelector('#visible-count')?.textContent === '1 个机会' && document.querySelector('.application-card')?.textContent.includes('星河科技')");
  const followUpFilter = await evaluate(client, `(() => ({
    company: document.querySelector('.application-card .card-title h4')?.textContent,
    date: document.querySelector('.card-follow-up-date')?.textContent.trim(),
    dueStyle: document.querySelector('.card-follow-up-date')?.classList.contains('is-due'),
    column: document.querySelector('.board-column')?.dataset.stageTarget,
    cardGrid: document.querySelector('#pipeline-board').classList.contains('is-card-grid'),
    selected: document.querySelector('[data-quick-filter="followup"]').classList.contains('is-active'),
  }))()`);
  assert.deepEqual(followUpFilter, {
    company: "星河科技",
    date: "跟进 2026/08/30",
    dueStyle: true,
    column: "followup",
    cardGrid: true,
    selected: true,
  });
  await saveScreenshot(client, "follow-up-filter-desktop.png");

  await evaluate(client, "document.querySelector('[data-summary-filter=\"interviewing\"]').click(); true");
  await waitFor(client, "document.querySelector('#visible-count')?.textContent === '1 个机会' && document.querySelectorAll('.application-card').length === 1");
  const interviewFilter = await evaluate(client, `(() => ({
    companies: [...document.querySelectorAll('.application-card .card-title h4')].map((item) => item.textContent),
    columns: [...document.querySelectorAll('.board-column')].map((item) => item.dataset.stageTarget),
    selected: document.querySelector('[data-summary-filter="interviewing"]').classList.contains('is-selected'),
    selectedCount: document.querySelectorAll('[data-summary-filter].is-selected').length,
    pressed: document.querySelector('[data-summary-filter="interviewing"]').getAttribute('aria-pressed'),
    sidebarSynced: document.querySelector('[data-quick-filter="interviewing"]').classList.contains('is-active'),
  }))()`);
  assert.deepEqual(interviewFilter, {
    companies: ["星河科技"],
    columns: ["ai-interview", "first-interview", "second-interview", "final-interview", "hr-interview"],
    selected: true,
    selectedCount: 1,
    pressed: "true",
    sidebarSynced: true,
  });
  await saveScreenshot(client, "summary-filter-interviewing-desktop.png");

  await evaluate(client, "document.querySelector('[data-summary-filter=\"assessment\"]').click(); true");
  await waitFor(client, "document.querySelector('#visible-count')?.textContent === '1 个机会' && document.querySelector('.application-card')?.textContent.includes('远山科技')");
  assert.deepEqual(
    await evaluate(client, "[...document.querySelectorAll('.board-column')].map((item) => item.dataset.stageTarget)"),
    ["assessment"],
  );
  assert.equal(await evaluate(client, "document.querySelector('#pipeline-board').classList.contains('is-card-grid')"), true);
  await saveScreenshot(client, "summary-filter-assessment-desktop.png");

  await evaluate(client, "document.querySelector('[data-summary-filter=\"ongoing\"]').click(); true");
  await waitFor(client, "document.querySelector('#visible-count')?.textContent === '1 个机会' && document.querySelector('.application-card')?.textContent.includes('平川机械')");
  assert.deepEqual(
    await evaluate(client, "[...document.querySelectorAll('.board-column')].map((item) => item.dataset.stageTarget)"),
    ["applied"],
  );
  const boardCardSize = await evaluate(client, `(() => ({
    title: Number.parseFloat(getComputedStyle(document.querySelector('.card-title h4')).fontSize),
    width: document.querySelector('.application-card').getBoundingClientRect().width,
    columnWidth: document.querySelector('.board-column').getBoundingClientRect().width,
    horizontalLayout: (() => {
      const cards = document.querySelector('.column-cards');
      const original = cards.querySelector('.application-card');
      const clone = original.cloneNode(true);
      cards.append(clone);
      const first = original.getBoundingClientRect();
      const second = clone.getBoundingClientRect();
      clone.remove();
      return first.top === second.top && second.left > first.left;
    })(),
    cardGrid: document.querySelector('#pipeline-board').classList.contains('is-card-grid'),
    minBodyWidth: getComputedStyle(document.body).minWidth,
  }))()`);
  assert.equal(boardCardSize.title >= 16, true);
  assert.equal(boardCardSize.columnWidth > 900, true);
  assert.equal(boardCardSize.width >= 300 && boardCardSize.width <= 310, true);
  assert.equal(boardCardSize.horizontalLayout, true);
  assert.equal(boardCardSize.cardGrid, true);
  assert.equal(boardCardSize.minBodyWidth, "1280px");
  await saveScreenshot(client, "summary-filter-ongoing-desktop.png");

  await evaluate(client, "document.querySelector('[data-summary-filter=\"interviewing\"]').click(); true");
  await waitFor(client, "document.querySelector('.application-card')?.textContent.includes('星河科技')");

  await evaluate(client, `(() => {
    const card = [...document.querySelectorAll('.application-card')]
      .find((item) => item.textContent.includes('星河科技'));
    card.querySelector('[data-action="progress"]').click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('#progress-dialog').open");
  await evaluate(client, `(() => {
    const form = document.querySelector('#progress-form');
    form.elements.nextStageId.value = 'offer';
    form.elements.note.value = '已收到正式 Offer';
    form.requestSubmit();
    return true;
  })()`);
  await waitFor(client, "!document.querySelector('#progress-dialog').open && document.querySelector('#stat-offers')?.textContent === '1'");

  await evaluate(client, "document.querySelector('[data-summary-filter=\"offer\"]').click(); true");
  await waitFor(client, "document.querySelector('#visible-count')?.textContent === '1 个机会' && document.querySelectorAll('.application-card').length === 1");
  const offerFilter = await evaluate(client, `(() => ({
    company: document.querySelector('.application-card .card-title h4')?.textContent,
    columns: [...document.querySelectorAll('.board-column')].map((item) => item.dataset.stageTarget),
    selected: document.querySelector('[data-summary-filter="offer"]').classList.contains('is-selected'),
    selectedCount: document.querySelectorAll('[data-summary-filter].is-selected').length,
    sidebarSynced: document.querySelector('[data-quick-filter="offer"]').classList.contains('is-active'),
  }))()`);
  assert.deepEqual(offerFilter, {
    company: "星河科技",
    columns: ["offer"],
    selected: true,
    selectedCount: 1,
    sidebarSynced: true,
  });
  await saveScreenshot(client, "summary-filter-offer-desktop.png");

  await evaluate(client, "document.querySelector('[data-summary-filter=\"ongoing\"]').click(); true");
  await waitFor(client, "document.querySelector('.application-card')?.textContent.includes('平川机械')");
  await evaluate(client, "document.querySelector('.application-card').click(); true");
  await waitFor(client, "document.querySelector('#detail-dialog').open && document.querySelector('#detail-content').textContent.includes('平川机械')");
  await evaluate(client, "document.querySelector('#detail-content [data-detail-action=\"status\"]').click(); true");
  await waitFor(client, "document.querySelector('#outcome-dialog').open");
  const outcomeFontSizes = await evaluate(client, `(() => ({
    title: Number.parseFloat(getComputedStyle(document.querySelector('.outcome-options strong')).fontSize),
    description: Number.parseFloat(getComputedStyle(document.querySelector('.outcome-options small')).fontSize),
    fieldLabel: Number.parseFloat(getComputedStyle(document.querySelector('.outcome-modal .form-field')).fontSize),
  }))()`);
  assert.equal(outcomeFontSizes.title >= 14, true);
  assert.equal(outcomeFontSizes.description >= 12, true);
  assert.equal(outcomeFontSizes.fieldLabel >= 13, true);
  await saveScreenshot(client, "outcome-status-desktop.png");
  await evaluate(client, `(() => {
    const form = document.querySelector('#outcome-form');
    form.querySelector('[name="status"][value="rejected"]').checked = true;
    form.elements.note.value = '流程已结束';
    form.requestSubmit();
    return true;
  })()`);
  await waitFor(client, "!document.querySelector('#outcome-dialog').open && document.querySelector('#nav-closed')?.textContent === '1'");
  await evaluate(client, "document.querySelector('[data-close-dialog=\"detail-dialog\"]').click(); true");
  await evaluate(client, "document.querySelector('[data-quick-filter=\"closed\"]').click(); true");
  await waitFor(client, "document.querySelector('#visible-count')?.textContent === '1 个机会' && document.querySelector('.application-card')?.textContent.includes('平川机械')");
  assert.deepEqual(
    await evaluate(client, "[...document.querySelectorAll('.board-column')].map((item) => item.dataset.stageTarget)"),
    ["closed"],
  );
  assert.equal(await evaluate(client, "document.querySelectorAll('[data-summary-filter].is-selected').length"), 0);
  await saveScreenshot(client, "summary-filter-closed-desktop.png");

  await evaluate(client, "document.querySelector('.overview-total').click(); true");
  await waitFor(client, "document.querySelector('#visible-count')?.textContent === '3 个机会' && document.querySelectorAll('.application-card').length === 3");
  assert.equal(await evaluate(client, "document.querySelectorAll('.board-column').length"), 9);
  assert.equal(await evaluate(client, "document.querySelector('[data-quick-filter=\"all\"]').classList.contains('is-active')"), true);
  assert.equal(await evaluate(client, "document.querySelector('.overview-total').classList.contains('is-selected')"), true);

  await saveScreenshot(client, "filled-desktop.png");

  await evaluate(client, `(() => {
    const payload = JSON.parse(localStorage.getItem('jobtrail.applications.v1'));
    const legacy = payload.applications.find((item) => item.company === '平川机械');
    legacy.status = 'paused';
    legacy.nextFollowUp = '2026-09-01';
    legacy.importSource = { ...legacy.importSource, progress: '人才库' };
    localStorage.setItem('jobtrail.applications.v1', JSON.stringify(payload));
    document.documentElement.dataset.appReady = 'reloading';
    location.reload();
    return true;
  })()`);
  await waitFor(client, "document.documentElement.dataset.appReady === 'true' && document.querySelector('#stat-total')?.textContent === '3' && document.querySelector('#nav-closed')?.textContent === '1'");
  assert.equal(await evaluate(client, "document.querySelector('#stat-ongoing')?.textContent"), "0");
  assert.equal(await evaluate(client, "document.querySelector('#stat-total-copy')?.textContent.includes('仍在推进')"), true);
  await evaluate(client, "document.querySelector('[data-quick-filter=\"closed\"]').click(); true");
  await waitFor(client, "document.querySelector('.application-card')?.textContent.includes('平川机械') && document.querySelector('.application-card')?.textContent.includes('未通过')");
  assert.equal(await evaluate(client, "document.querySelector('.application-card').textContent.includes('已搁置')"), false);
  await saveScreenshot(client, "legacy-talent-pool-migration-desktop.png");
  assert.deepEqual(client.browserExceptions, []);

  console.log("Browser smoke test passed: version upgrade → exclusive filters → talent-pool migration → desktop render");
} finally {
  client.close();
}
