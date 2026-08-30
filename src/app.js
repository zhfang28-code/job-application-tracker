import {
  INTERVIEW_STAGE_IDS,
  STAGES,
  applicationProgress,
  completeCurrentStage,
  completedStageIds,
  createApplication,
  daysSince,
  exportPayload,
  isFollowUpDue,
  mergeApplications,
  moveToStage,
  parseImportPayload,
  setOutcome,
  stageById,
  summarize,
  updateApplication,
} from "./model.js";
import { loadApplications, loadPreference, saveApplications, savePreference } from "./storage.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let applications = loadApplications();
let activeDetailId = null;
let view = ["board", "list"].includes(loadPreference("view", "board"))
  ? loadPreference("view", "board")
  : "board";
let filters = {
  search: "",
  city: "all",
  stage: "all",
  quick: "all",
};

const elements = {
  board: $("#pipeline-board"),
  list: $("#list-view"),
  empty: $("#empty-state"),
  applicationDialog: $("#application-dialog"),
  applicationForm: $("#application-form"),
  detailDialog: $("#detail-dialog"),
  detailContent: $("#detail-content"),
  progressDialog: $("#progress-dialog"),
  progressForm: $("#progress-form"),
  outcomeDialog: $("#outcome-dialog"),
  outcomeForm: $("#outcome-form"),
  search: $("#search-input"),
  cityFilter: $("#city-filter"),
  stageFilter: $("#stage-filter"),
  importFile: $("#import-file"),
  toastRegion: $("#toast-region"),
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
});
const fullDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function icon(name, className = "icon") {
  return `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function localDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateTimeString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${localDateString(date)}T${hours}:${minutes}`;
}

function formatDate(value, formatter = dateFormatter) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : formatter.format(date);
}

function formatDateInput(value) {
  return value ? localDateString(new Date(value)) : "";
}

function statusLabel(application) {
  const labels = {
    active: stageById(application.currentStageId).label,
    paused: "暂时搁置",
    offer: "已收 Offer",
    rejected: "未通过",
    withdrawn: "已撤回",
  };
  return labels[application.status] ?? "进行中";
}

function outcomeColumn(application) {
  return ["rejected", "withdrawn"].includes(application.status)
    ? "closed"
    : application.currentStageId;
}

function companyInitial(company) {
  const trimmed = company.trim();
  return trimmed ? [...trimmed][0].toUpperCase() : "职";
}

function avatarStyle(company) {
  const palettes = [
    ["#eef0ff", "#5868ed"],
    ["#e8f8f2", "#0b9f74"],
    ["#fff3e5", "#df8519"],
    ["#f5edff", "#8c55dc"],
    ["#e9f6ff", "#1684c5"],
    ["#fff0f2", "#d24f62"],
  ];
  const hash = [...company].reduce((sum, char) => sum + char.codePointAt(0), 0);
  const [background, color] = palettes[hash % palettes.length];
  return `--avatar-bg:${background};--avatar-color:${color}`;
}

function stageStyle(stageId) {
  return `--stage-color:${stageById(stageId).color}`;
}

function persist(message = "已保存") {
  try {
    saveApplications(applications);
    if (message) showToast(message);
  } catch (error) {
    console.error(error);
    showToast("保存失败，请先导出数据后检查浏览器存储空间", "error");
  }
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " is-error" : ""}`;
  toast.innerHTML = `<span class="toast-icon">${icon(type === "error" ? "close" : "check")}</span><span>${escapeHtml(message)}</span>`;
  elements.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function formValue(form, name) {
  return new FormData(form).get(name)?.toString() ?? "";
}

function applicationFormPayload(form) {
  return {
    company: formValue(form, "company"),
    position: formValue(form, "position"),
    city: formValue(form, "city"),
    salary: formValue(form, "salary"),
    source: formValue(form, "source"),
    appliedAt: formValue(form, "appliedAt"),
    jobUrl: formValue(form, "jobUrl"),
    nextFollowUp: formValue(form, "nextFollowUp"),
    contact: formValue(form, "contact"),
    tags: formValue(form, "tags"),
    notes: formValue(form, "notes"),
  };
}

function openApplicationForm(application = null) {
  elements.applicationForm.reset();
  const title = $("#application-dialog-title");
  const submitLabel = $("#save-application-button");
  const idField = elements.applicationForm.elements.applicationId;

  if (!application) {
    title.textContent = "新建投递";
    submitLabel.lastChild.textContent = "保存投递";
    idField.value = "";
    elements.applicationForm.elements.appliedAt.value = localDateString();
  } else {
    title.textContent = "编辑投递";
    submitLabel.lastChild.textContent = "保存修改";
    idField.value = application.id;
    for (const name of ["company", "position", "city", "salary", "source", "jobUrl", "nextFollowUp", "contact", "notes"]) {
      elements.applicationForm.elements[name].value = application[name] ?? "";
    }
    elements.applicationForm.elements.appliedAt.value = formatDateInput(application.appliedAt);
    elements.applicationForm.elements.tags.value = application.tags.join("，");
  }
  elements.applicationDialog.showModal();
  window.setTimeout(() => elements.applicationForm.elements.company.focus(), 50);
}

function getFilteredApplications() {
  const search = filters.search.trim().toLocaleLowerCase("zh-CN");
  return applications.filter((application) => {
    if (search) {
      const haystack = [
        application.company,
        application.position,
        application.city,
        application.source,
        application.salary,
        application.tags.join(" "),
        application.notes,
      ].join(" ").toLocaleLowerCase("zh-CN");
      if (!haystack.includes(search)) return false;
    }
    if (filters.city !== "all" && application.city !== filters.city) return false;
    if (filters.stage !== "all" && outcomeColumn(application) !== filters.stage) return false;

    if (filters.quick === "due" && !isFollowUpDue(application)) return false;
    if (filters.quick === "interviewing" && !(application.status === "active" && INTERVIEW_STAGE_IDS.has(application.currentStageId))) return false;
    if (filters.quick === "offer" && application.status !== "offer") return false;
    if (filters.quick === "closed" && !["rejected", "withdrawn"].includes(application.status)) return false;
    return true;
  }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function cardHtml(application) {
  const stage = stageById(application.currentStageId);
  const overdue = isFollowUpDue(application);
  const closed = ["rejected", "withdrawn"].includes(application.status);
  const progress = applicationProgress(application);
  const tags = application.tags.slice(0, 2);
  const statusTag = application.status === "paused"
    ? `<span class="tag status-tag">已搁置</span>`
    : closed
      ? `<span class="tag status-tag">${escapeHtml(statusLabel(application))}</span>`
      : "";
  const quickButton = !closed && application.status !== "offer"
    ? `<button class="quick-progress" type="button" data-action="progress" data-id="${application.id}">${icon("arrow")}记录新进展</button>`
    : "";

  return `
    <article class="application-card${overdue ? " is-overdue" : ""}${closed ? " is-closed" : ""}"
      data-open-detail="${application.id}" data-application-id="${application.id}" tabindex="0"
      ${closed ? "" : "draggable=\"true\""} style="${stageStyle(stage.id)}">
      <div class="card-top">
        <span class="company-avatar" style="${avatarStyle(application.company)}">${escapeHtml(companyInitial(application.company))}</span>
        <div class="card-title"><h4>${escapeHtml(application.company)}</h4><p>${escapeHtml(application.position)}</p></div>
        <button class="card-more" type="button" data-action="details" data-id="${application.id}" aria-label="查看详情">${icon("more")}</button>
      </div>
      <div class="card-tags">
        <span class="tag stage-tag" style="${stageStyle(stage.id)}">${escapeHtml(statusLabel(application))}</span>
        ${overdue ? `<span class="tag overdue-tag">待跟进</span>` : ""}
        ${statusTag}
        ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="card-meta">
        ${application.city ? `<span>${icon("pin")}${escapeHtml(application.city)}</span>` : ""}
        <span>${icon("calendar")}${formatDate(application.appliedAt)}</span>
        <span>${daysSince(application.appliedAt)} 天</span>
      </div>
      <div class="progress-track" title="流程完成度 ${progress}%"><span style="width:${progress}%"></span></div>
      ${quickButton}
    </article>`;
}

function renderBoard(items) {
  const columns = [
    ...STAGES.map((stage) => ({ ...stage, id: stage.id })),
    { id: "closed", label: "已结束", color: "#dc5264" },
  ];

  elements.board.innerHTML = columns.map((column) => {
    const cards = items.filter((application) => outcomeColumn(application) === column.id);
    return `
      <section class="board-column" data-stage-target="${column.id}" style="--stage-color:${column.color}" aria-labelledby="column-${column.id}">
        <header class="board-column-header">
          <span class="stage-dot"></span>
          <h3 id="column-${column.id}">${escapeHtml(column.label)}</h3>
          <span class="column-count">${cards.length}</span>
        </header>
        <div class="column-cards">
          ${cards.length ? cards.map(cardHtml).join("") : `<div class="column-empty">暂无记录</div>`}
        </div>
      </section>`;
  }).join("");
}

function renderList(items) {
  elements.list.innerHTML = `
    <table class="application-table">
      <thead><tr><th>公司 / 岗位</th><th>城市</th><th>当前进度</th><th>投递日期</th><th>流程完成度</th><th>岗位链接</th></tr></thead>
      <tbody>
        ${items.map((application) => {
          const stage = stageById(application.currentStageId);
          const progress = applicationProgress(application);
          const url = safeUrl(application.jobUrl);
          return `<tr data-open-detail="${application.id}" tabindex="0">
            <td><div class="table-company"><span class="company-avatar" style="${avatarStyle(application.company)}">${escapeHtml(companyInitial(application.company))}</span><span><strong>${escapeHtml(application.company)}</strong><small>${escapeHtml(application.position)}</small></span></div></td>
            <td>${escapeHtml(application.city || "—")}</td>
            <td><span class="table-stage" style="${stageStyle(stage.id)}"><i class="stage-dot"></i>${escapeHtml(statusLabel(application))}</span></td>
            <td>${formatDate(application.appliedAt, fullDateFormatter)}</td>
            <td><span class="table-progress"><span class="progress-track" style="${stageStyle(stage.id)}"><span style="width:${progress}%"></span></span>${progress}%</span></td>
            <td>${url ? `<a class="table-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" data-stop-detail>查看岗位</a>` : "—"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function renderFilters() {
  const cities = [...new Set(applications.map((app) => app.city).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  const currentCity = filters.city;
  elements.cityFilter.innerHTML = `<option value="all">全部城市</option>${cities.map((city) => `<option value="${escapeHtml(city)}">${escapeHtml(city)}</option>`).join("")}`;
  elements.cityFilter.value = cities.includes(currentCity) ? currentCity : "all";
  if (elements.cityFilter.value === "all") filters.city = "all";

  elements.stageFilter.innerHTML = `
    <option value="all">全部进度</option>
    ${STAGES.map((stage) => `<option value="${stage.id}">${escapeHtml(stage.label)}</option>`).join("")}
    <option value="closed">已结束</option>`;
  elements.stageFilter.value = filters.stage;
}

function renderSummary() {
  const summary = summarize(applications);
  $("#stat-total").textContent = summary.total;
  $("#stat-active").textContent = summary.active;
  $("#stat-interviewing").textContent = summary.interviewing;
  $("#stat-offers").textContent = summary.offers;
  $("#nav-total").textContent = summary.total;
  $("#nav-due").textContent = summary.due || "";
  $("#nav-interviewing").textContent = summary.interviewing;
  $("#nav-offers").textContent = summary.offers;
  $("#active-ratio").textContent = summary.total ? `${Math.round((summary.active / summary.total) * 100)}%` : "0%";
  $("#stat-total-copy").textContent = summary.total ? `其中 ${summary.active} 个仍在推进` : "开始记录第一份机会";

  if (summary.total) {
    $("#welcome-heading").textContent = summary.offers ? "好消息正在路上" : "稳稳推进每一次机会";
    $("#welcome-copy").textContent = summary.due
      ? `有 ${summary.due} 个机会需要跟进，今天把它们推进一步。`
      : "目前没有逾期跟进，继续保持清晰的求职节奏。";
  } else {
    $("#welcome-heading").textContent = "稳稳推进每一次机会";
    $("#welcome-copy").textContent = "把每个环节记清楚，下一步自然更从容。";
  }
}

function renderFollowUps() {
  const dueItems = applications
    .filter((application) => isFollowUpDue(application))
    .sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp))
    .slice(0, 6);
  const panel = $("#follow-up-panel");
  panel.classList.toggle("is-hidden", dueItems.length === 0);
  $("#follow-up-list").innerHTML = dueItems.map((application) => {
    const overdueDays = Math.max(0, daysSince(`${application.nextFollowUp}T00:00:00`));
    return `<button type="button" class="follow-up-item" data-open-detail="${application.id}"><span><strong>${escapeHtml(application.company)}</strong><small>${escapeHtml(application.position)}</small></span><span>${overdueDays ? `逾期 ${overdueDays} 天` : "今天"}</span></button>`;
  }).join("");
}

function renderWorkspace() {
  const items = getFilteredApplications();
  $("#visible-count").textContent = `${items.length} 个机会`;
  elements.board.classList.toggle("is-hidden", view !== "board" || items.length === 0);
  elements.list.classList.toggle("is-hidden", view !== "list" || items.length === 0);
  elements.empty.classList.toggle("is-hidden", items.length !== 0);

  if (items.length) {
    renderBoard(items);
    renderList(items);
  } else {
    const hasAny = applications.length > 0;
    $("#empty-title").textContent = hasAny ? "没有符合条件的记录" : "还没有投递记录";
    $("#empty-copy").textContent = hasAny ? "换个关键词或清除筛选条件再试试。" : "添加第一份投递，从此不再遗漏任何进展。";
    $("#empty-action").innerHTML = hasAny ? `${icon("close")}清除筛选` : `${icon("plus")}新建投递`;
  }

  $$('[data-view]').forEach((button) => {
    const isActive = button.dataset.view === view;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderAll() {
  renderSummary();
  renderFilters();
  renderFollowUps();
  renderWorkspace();
  if (activeDetailId && elements.detailDialog.open) renderDetail(activeDetailId);
}

function routeHtml(application) {
  const complete = completedStageIds(application);
  const skipped = new Set(application.timeline.filter((event) => event.type === "skipped").map((event) => event.stageId));
  return application.pipeline.map((stageId) => {
    const stage = stageById(stageId);
    const classes = [
      "route-step",
      complete.has(stageId) ? "is-complete" : "",
      skipped.has(stageId) ? "is-skipped" : "",
      application.currentStageId === stageId ? "is-current" : "",
    ].filter(Boolean).join(" ");
    const marker = complete.has(stageId) ? "✓" : application.currentStageId === stageId ? "•" : "";
    return `<div class="${classes}" style="${stageStyle(stageId)}"><span class="route-node">${marker}</span><span>${escapeHtml(stage.shortLabel)}</span></div>`;
  }).join("");
}

function timelineHtml(application) {
  const typeLabels = { entered: "进入", completed: "完成", skipped: "跳过", reopened: "重开" };
  const eventColors = { entered: "#5b6cf9", completed: "#0ca678", skipped: "#9298aa", reopened: "#e68a17" };
  const timeline = [...application.timeline].sort((a, b) => new Date(b.at) - new Date(a.at));
  if (!timeline.length) return `<p class="detail-notes is-empty">尚无进展记录</p>`;
  return `<div class="timeline">${timeline.map((event) => `
    <article class="timeline-item" style="--event-color:${eventColors[event.type] ?? eventColors.entered}">
      <span class="timeline-dot"></span>
      <div class="timeline-content">
        <div class="timeline-title"><strong>${escapeHtml(stageById(event.stageId).label)}<span class="timeline-type">${typeLabels[event.type] ?? "记录"}</span></strong><time datetime="${escapeHtml(event.at)}">${formatDate(event.at, dateTimeFormatter)}</time></div>
        ${event.note ? `<p>${escapeHtml(event.note)}</p>` : ""}
      </div>
    </article>`).join("")}</div>`;
}

function renderDetail(applicationId) {
  const application = applications.find((item) => item.id === applicationId);
  if (!application) {
    elements.detailDialog.close();
    activeDetailId = null;
    return;
  }
  const stage = stageById(application.currentStageId);
  const url = safeUrl(application.jobUrl);
  const closed = ["rejected", "withdrawn"].includes(application.status);
  const statusClass = application.status === "offer" ? " is-offer" : closed ? " is-closed" : "";
  const primaryAction = !closed && application.status !== "offer"
    ? `<button class="button button-primary" type="button" data-detail-action="progress">${icon("arrow")}记录公司通知的下一步</button>`
    : application.status === "offer"
      ? `<button class="button button-ghost" type="button" data-detail-action="status">${icon("sparkle")}更新最终状态</button>`
      : `<button class="button button-primary" type="button" data-detail-action="status">${icon("arrow")}重新开启流程</button>`;
  const jumpOptions = application.pipeline.map((stageId) => `<option value="${stageId}" ${stageId === application.currentStageId ? "selected" : ""}>${escapeHtml(stageById(stageId).label)}</option>`).join("");

  elements.detailContent.innerHTML = `
    <section class="detail-hero">
      <div class="detail-company-row">
        <span class="company-avatar" style="${avatarStyle(application.company)}">${escapeHtml(companyInitial(application.company))}</span>
        <div><h2>${escapeHtml(application.company)}</h2><p>${escapeHtml(application.position)}</p></div>
        <span class="detail-status${statusClass}">${escapeHtml(statusLabel(application))}</span>
      </div>
      <div class="detail-meta">
        ${application.city ? `<span>${icon("pin")}${escapeHtml(application.city)}</span>` : ""}
        <span>${icon("calendar")}投递于 ${formatDate(application.appliedAt, fullDateFormatter)}</span>
        ${application.salary ? `<span>${escapeHtml(application.salary)}</span>` : ""}
        ${application.source ? `<span>来自 ${escapeHtml(application.source)}</span>` : ""}
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${icon("link")}打开岗位链接</a>` : ""}
      </div>
      ${application.tags.length ? `<div class="detail-tags">${application.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <div class="detail-actions">
        ${primaryAction}
        <div class="detail-secondary-actions">
          <button class="icon-button" type="button" data-detail-action="edit" title="编辑投递" aria-label="编辑投递">${icon("edit")}</button>
          <button class="icon-button" type="button" data-detail-action="status" title="更新状态" aria-label="更新状态">${icon("more")}</button>
        </div>
      </div>
    </section>

    <section class="detail-section">
      <div class="detail-section-header"><h3>招聘流程</h3><small>按公司实际通知自动生成 · ${application.pipeline.length} 个环节</small></div>
      <div class="route-steps">${routeHtml(application)}</div>
      ${!closed && application.status !== "offer" ? `<div class="stage-jump"><label class="form-field"><span>快速调整当前进度</span><select id="stage-jump-select">${jumpOptions}</select></label><button class="button button-ghost button-small" type="button" data-detail-action="jump-stage">更新</button></div>` : ""}
    </section>

    <section class="detail-section">
      <div class="detail-section-header"><h3>进展时间线</h3><small>${application.timeline.length} 条自动记录</small></div>
      ${timelineHtml(application)}
    </section>

    <section class="detail-section">
      <div class="detail-section-header"><h3>岗位与准备备注</h3>${application.contact ? `<small>联系人：${escapeHtml(application.contact)}</small>` : ""}</div>
      <p class="detail-notes${application.notes ? "" : " is-empty"}">${escapeHtml(application.notes || "还没有备注，点击编辑补充 JD 重点或面试准备事项。")}</p>
    </section>

    <section class="detail-danger">
      <button class="text-button" type="button" data-detail-action="delete">删除这条投递记录</button>
    </section>`;
}

function openDetail(applicationId) {
  activeDetailId = applicationId;
  renderDetail(applicationId);
  if (!elements.detailDialog.open) elements.detailDialog.showModal();
}

function openProgress(applicationId) {
  const application = applications.find((item) => item.id === applicationId);
  if (!application || ["offer", "rejected", "withdrawn"].includes(application.status)) return;
  const stage = stageById(application.currentStageId);
  const currentIndex = application.pipeline.indexOf(application.currentStageId);
  const unavailableStageIds = new Set(application.pipeline.slice(0, currentIndex + 1));
  const availableStages = STAGES.filter(
    (candidate) => candidate.id !== "applied" && !unavailableStageIds.has(candidate.id),
  );
  elements.progressForm.reset();
  elements.progressForm.elements.applicationId.value = application.id;
  elements.progressForm.elements.completedAt.value = localDateTimeString();
  elements.progressForm.elements.nextFollowUp.value = application.nextFollowUp || "";
  elements.progressForm.elements.nextStageId.innerHTML = `
    <option value="">请选择已确认的下一环节</option>
    ${availableStages.map((candidate) => `<option value="${candidate.id}">${escapeHtml(candidate.label)}</option>`).join("")}`;
  $("#progress-current").innerHTML = `<span class="stage-bubble" style="${stageStyle(stage.id)}">${escapeHtml(stage.shortLabel.slice(0, 2))}</span><span><strong>当前：${escapeHtml(stage.label)}</strong><small>下一步以公司实际通知为准</small></span>`;
  $("#progress-description").textContent = "选择公司已经确认的下一环节，系统会按真实顺序补进流程。";
  $("#complete-stage-label").textContent = "保存并进入下一环节";
  elements.progressDialog.showModal();
  window.setTimeout(() => elements.progressForm.elements.nextStageId.focus(), 50);
}

function openOutcome(applicationId) {
  const application = applications.find((item) => item.id === applicationId);
  if (!application) return;
  elements.outcomeForm.reset();
  elements.outcomeForm.elements.applicationId.value = application.id;
  const desiredStatus = ["paused", "rejected", "withdrawn"].includes(application.status) ? "active" : "paused";
  const radio = elements.outcomeForm.querySelector(`[name="status"][value="${desiredStatus}"]`);
  if (radio) radio.checked = true;
  elements.outcomeDialog.showModal();
}

function updateApplicationInState(updated) {
  applications = applications.map((application) => application.id === updated.id ? updated : application);
  applications.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function resetFilters() {
  filters = { search: "", city: "all", stage: "all", quick: "all" };
  elements.search.value = "";
  $$("[data-quick-filter]").forEach((button) => button.classList.toggle("is-active", button.dataset.quickFilter === "all"));
  renderAll();
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  const payload = exportPayload(applications);
  downloadFile(JSON.stringify(payload, null, 2), `jobtrail-backup-${localDateString()}.json`, "application/json;charset=utf-8");
  showToast(`已导出 ${applications.length} 条投递记录`);
}

function safeCsvCell(value) {
  let text = String(value ?? "").replaceAll('"', '""');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text}"`;
}

function exportCsv() {
  const headers = ["公司", "岗位", "城市", "当前进度", "状态", "投递日期", "下次跟进", "薪资", "渠道", "岗位链接", "标签", "备注"];
  const rows = applications.map((application) => [
    application.company,
    application.position,
    application.city,
    stageById(application.currentStageId).label,
    statusLabel(application),
    formatDateInput(application.appliedAt),
    application.nextFollowUp,
    application.salary,
    application.source,
    application.jobUrl,
    application.tags.join("；"),
    application.notes,
  ]);
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}`;
  downloadFile(csv, `jobtrail-applications-${localDateString()}.csv`, "text/csv;charset=utf-8");
  showToast(`已导出 ${applications.length} 条 CSV 记录`);
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  savePreference("theme", theme);
  $("meta[name=\"theme-color\"]").content = theme === "dark" ? "#181b26" : "#5b6cf9";
}

function initializeTheme() {
  const saved = loadPreference("theme", "");
  const theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  setTheme(theme);
}

function setupEventListeners() {
  $("#add-application-button").addEventListener("click", () => openApplicationForm());
  $("#empty-action").addEventListener("click", () => applications.length ? resetFilters() : openApplicationForm());

  $$('[data-close-dialog]').forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog)?.close());
  });

  [elements.applicationDialog, elements.detailDialog, elements.progressDialog, elements.outcomeDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  elements.applicationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!elements.applicationForm.reportValidity()) return;
    const payload = applicationFormPayload(elements.applicationForm);
    const applicationId = formValue(elements.applicationForm, "applicationId");
    if (applicationId) {
      const existing = applications.find((application) => application.id === applicationId);
      if (!existing) return;
      updateApplicationInState(updateApplication(existing, payload));
      persist("投递信息已更新");
    } else {
      const created = createApplication(payload);
      applications.unshift(created);
      persist("投递已创建，开始记录进展");
      activeDetailId = created.id;
    }
    elements.applicationDialog.close();
    renderAll();
  });

  elements.progressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const applicationId = formValue(elements.progressForm, "applicationId");
    const existing = applications.find((application) => application.id === applicationId);
    if (!existing) return;
    const details = {
      at: formValue(elements.progressForm, "completedAt"),
      note: formValue(elements.progressForm, "note"),
      nextFollowUp: formValue(elements.progressForm, "nextFollowUp"),
      nextStageId: formValue(elements.progressForm, "nextStageId"),
    };
    const updated = completeCurrentStage(existing, details);
    updateApplicationInState(updated);
    persist(`进展已记录，已进入「${stageById(updated.currentStageId).label}」`);
    elements.progressDialog.close();
    renderAll();
  });

  elements.outcomeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const applicationId = formValue(elements.outcomeForm, "applicationId");
    const existing = applications.find((application) => application.id === applicationId);
    const status = formValue(elements.outcomeForm, "status");
    if (!existing || !status) {
      showToast("请选择一个状态", "error");
      return;
    }
    updateApplicationInState(setOutcome(existing, status, { note: formValue(elements.outcomeForm, "note") }));
    persist("流程状态已更新");
    elements.outcomeDialog.close();
    renderAll();
  });

  document.addEventListener("click", (event) => {
    const stopDetail = event.target.closest("[data-stop-detail]");
    if (stopDetail) return;
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      event.stopPropagation();
      const applicationId = actionButton.dataset.id;
      if (actionButton.dataset.action === "progress") openProgress(applicationId);
      if (actionButton.dataset.action === "details") openDetail(applicationId);
      return;
    }
    const opener = event.target.closest("[data-open-detail]");
    if (opener) openDetail(opener.dataset.openDetail);
  });

  elements.detailContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-detail-action]");
    if (!button || !activeDetailId) return;
    const application = applications.find((item) => item.id === activeDetailId);
    if (!application) return;
    const action = button.dataset.detailAction;
    if (action === "progress") openProgress(application.id);
    if (action === "edit") openApplicationForm(application);
    if (action === "status") openOutcome(application.id);
    if (action === "jump-stage") {
      const target = $("#stage-jump-select")?.value;
      if (target && target !== application.currentStageId) {
        updateApplicationInState(moveToStage(application, target, { note: `手动调整至「${stageById(target).label}」` }));
        persist(`进度已调整至「${stageById(target).label}」`);
        renderAll();
      }
    }
    if (action === "delete") {
      const confirmed = window.confirm(`确定删除「${application.company} · ${application.position}」吗？删除后只能通过此前导出的备份恢复。`);
      if (!confirmed) return;
      applications = applications.filter((item) => item.id !== application.id);
      persist("投递记录已删除");
      activeDetailId = null;
      elements.detailDialog.close();
      renderAll();
    }
  });

  document.addEventListener("keydown", (event) => {
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if ((event.key === "/" || (event.metaKey && event.key.toLowerCase() === "k")) && !isTyping) {
      event.preventDefault();
      elements.search.focus();
    }
    if (!isTyping && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "n") {
      event.preventDefault();
      openApplicationForm();
    }
    if (!isTyping && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "e") {
      event.preventDefault();
      exportJson();
    }
    if ((event.key === "Enter" || event.key === " ") && document.activeElement?.matches("[data-open-detail]")) {
      event.preventDefault();
      openDetail(document.activeElement.dataset.openDetail);
    }
  });

  elements.search.addEventListener("input", () => {
    filters.search = elements.search.value;
    renderWorkspace();
  });
  elements.cityFilter.addEventListener("change", () => {
    filters.city = elements.cityFilter.value;
    renderWorkspace();
  });
  elements.stageFilter.addEventListener("change", () => {
    filters.stage = elements.stageFilter.value;
    renderWorkspace();
  });

  $$('[data-view]').forEach((button) => button.addEventListener("click", () => {
    view = button.dataset.view;
    savePreference("view", view);
    renderWorkspace();
  }));

  $$('[data-quick-filter]').forEach((button) => button.addEventListener("click", () => {
    filters.quick = button.dataset.quickFilter;
    $$('[data-quick-filter]').forEach((item) => item.classList.toggle("is-active", item === button));
    renderWorkspace();
    $("#pipeline-heading").scrollIntoView({ behavior: "smooth", block: "start" });
  }));

  $("#theme-toggle").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  $("#export-button").addEventListener("click", exportJson);
  $("#export-csv-button")?.addEventListener("click", exportCsv);
  $("#import-button").addEventListener("click", () => elements.importFile.click());
  elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files?.[0];
    if (!file) return;
    try {
      const imported = parseImportPayload(JSON.parse(await file.text()));
      applications = mergeApplications(applications, imported);
      persist(`已导入并合并 ${imported.length} 条记录`);
      resetFilters();
    } catch (error) {
      console.error(error);
      showToast(error.message || "导入失败，请检查 JSON 备份文件", "error");
    } finally {
      elements.importFile.value = "";
    }
  });

  let draggedApplicationId = "";
  elements.board.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-application-id]");
    if (!card) return;
    draggedApplicationId = card.dataset.applicationId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedApplicationId);
  });
  elements.board.addEventListener("dragover", (event) => {
    const column = event.target.closest("[data-stage-target]");
    const application = applications.find((item) => item.id === draggedApplicationId);
    if (!column || !application || !application.pipeline.includes(column.dataset.stageTarget)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    column.classList.add("is-drop-target");
  });
  elements.board.addEventListener("dragleave", (event) => {
    const column = event.target.closest("[data-stage-target]");
    if (column && !column.contains(event.relatedTarget)) column.classList.remove("is-drop-target");
  });
  elements.board.addEventListener("drop", (event) => {
    event.preventDefault();
    const column = event.target.closest("[data-stage-target]");
    const application = applications.find((item) => item.id === draggedApplicationId);
    $$(".board-column.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    if (!column || !application || !application.pipeline.includes(column.dataset.stageTarget)) return;
    const target = column.dataset.stageTarget;
    if (target === application.currentStageId) return;
    updateApplicationInState(moveToStage(application, target, { note: `看板拖动至「${stageById(target).label}」` }));
    persist(`已移动到「${stageById(target).label}」并自动记录`);
    renderAll();
    draggedApplicationId = "";
  });
  elements.board.addEventListener("dragend", () => {
    $$(".board-column.is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    draggedApplicationId = "";
  });
}

function initialize() {
  initializeTheme();
  $("#today-label").textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
  setupEventListeners();
  renderAll();
  document.documentElement.dataset.appReady = "true";

  if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.warn));
  }
}

initialize();
