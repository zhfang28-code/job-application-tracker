import {
  INTERVIEW_STAGE_IDS,
  STAGES,
  applicationCategory,
  applicationProgress,
  completeCurrentStage,
  completedStageIds,
  createApplication,
  daysSince,
  exportPayload,
  hasScheduledFollowUp,
  inferCompanyFromUrl,
  isCurrentStageCompleted,
  isFollowUpDue,
  markCurrentStageCompleted,
  mergeApplications,
  moveToStage,
  parseImportPayload,
  setOutcome,
  stageById,
  summarize,
  updateApplication,
} from "./model.js?v=20260903-8";
import { mergeCsvApplications, readJobCsv } from "./csv-import.js?v=20260903-8";
import { loadApplications, loadPreference, removePreference, saveApplications, savePreference } from "./storage.js?v=20260903-8";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const CUSTOM_FORM_OPTION_LIMIT = 120;
const MULTI_VALUE_LIMIT = 20;
const CUSTOM_FORM_OPTION_FIELDS = Object.freeze({
  position: { key: "positions", label: "岗位", inputName: "position", maxLength: 100 },
  city: { key: "cities", label: "城市", inputName: "city", maxLength: 40 },
});

let applications = loadApplications();
let customFormOptions = loadCustomFormOptions();
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

const QUICK_FILTERS = new Set(["all", "followup", "ongoing", "assessment", "interviewing", "offer", "closed"]);
const QUICK_FILTER_TITLES = Object.freeze({
  all: "投递流程",
  followup: "需要跟进的投递",
  ongoing: "进行中的投递",
  assessment: "测试阶段",
  interviewing: "面试阶段",
  offer: "收到 Offer",
  closed: "已结束的投递",
});
const CLOSED_COLUMN = Object.freeze({ id: "closed", label: "已结束", color: "#dc5264" });
const FOLLOW_UP_COLUMN = Object.freeze({ id: "followup", label: "需要跟进", color: "#e68a17" });

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
  analyzeJobLinkButton: $("#analyze-job-link-button"),
  openJobLinkButton: $("#open-job-link-button"),
  openJobLinkLabel: $("#open-job-link-label"),
  jobLinkAnalysisStatus: $("#job-link-analysis-status"),
  importFile: $("#import-file"),
  csvImportFile: $("#csv-import-file"),
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
const DEFAULT_JOB_LINK_ANALYSIS_COPY = "粘贴后可直接打开链接；公司信息只在本地分析。";

function customOptionKey(value) {
  return String(value ?? "").trim().toLocaleLowerCase("zh-CN");
}

function normalizeCustomOptionList(values, maxLength) {
  const seen = new Set();
  const normalized = [];
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = String(rawValue ?? "").trim();
    const key = customOptionKey(value);
    if (!value || value.length > maxLength || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
    if (normalized.length >= CUSTOM_FORM_OPTION_LIMIT) break;
  }
  return normalized;
}

function loadCustomFormOptions() {
  try {
    const parsed = JSON.parse(loadPreference("custom-form-options", "{}"));
    return {
      positions: normalizeCustomOptionList(parsed?.positions, CUSTOM_FORM_OPTION_FIELDS.position.maxLength),
      cities: normalizeCustomOptionList(parsed?.cities, CUSTOM_FORM_OPTION_FIELDS.city.maxLength),
    };
  } catch {
    return { positions: [], cities: [] };
  }
}

function storeCustomFormOptions(nextOptions) {
  customFormOptions = {
    positions: normalizeCustomOptionList(nextOptions.positions, CUSTOM_FORM_OPTION_FIELDS.position.maxLength),
    cities: normalizeCustomOptionList(nextOptions.cities, CUSTOM_FORM_OPTION_FIELDS.city.maxLength),
  };
  savePreference("custom-form-options", JSON.stringify(customFormOptions));
}

function parseCustomOptionEntries(value) {
  return String(value ?? "")
    .split(/[\r\n,，;；、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMultiValueList(values, maxLength) {
  const seen = new Set();
  const normalized = [];
  for (const rawValue of Array.isArray(values) ? values : []) {
    const value = String(rawValue ?? "").trim();
    const key = customOptionKey(value);
    if (!value || value.length > maxLength || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
    if (normalized.length >= MULTI_VALUE_LIMIT) break;
  }
  return normalized;
}

function splitMultiValueEntries(value) {
  return String(value ?? "")
    .split(/[\r\n,，;；、]+|(?<!\+)\+(?!\+)/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMultiValueEntries(value, maxLength) {
  return normalizeMultiValueList(splitMultiValueEntries(value), maxLength);
}

function selectedMultiValues(kind) {
  const config = CUSTOM_FORM_OPTION_FIELDS[kind];
  if (!config) return [];
  return parseMultiValueEntries(
    elements.applicationForm.elements[config.inputName].value,
    config.maxLength,
  );
}

function renderMultiValueField(kind) {
  const config = CUSTOM_FORM_OPTION_FIELDS[kind];
  if (!config) return;
  const values = selectedMultiValues(kind);
  const chips = $(`[data-multi-value-chips="${kind}"]`);
  chips.innerHTML = values.map((value, index) => `
    <span class="multi-value-chip">
      <span title="${escapeHtml(value)}">${escapeHtml(value)}</span>
      <button type="button" data-multi-value-remove="${kind}" data-multi-value-index="${index}" aria-label="移除${config.label}：${escapeHtml(value)}">${icon("close")}</button>
    </span>`).join("");

  const selectedKeys = new Set(values.map(customOptionKey));
  $$(`[data-custom-option-select="${kind}"]`).forEach((button) => {
    const option = customFormOptions[config.key]?.[Number(button.dataset.customOptionIndex)];
    const selected = selectedKeys.has(customOptionKey(option));
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function setSelectedMultiValues(kind, values, { clearEntry = false } = {}) {
  const config = CUSTOM_FORM_OPTION_FIELDS[kind];
  if (!config) return;
  const normalized = normalizeMultiValueList(values, config.maxLength);
  elements.applicationForm.elements[config.inputName].value = normalized.join(" + ");
  const entry = $(`[data-multi-value-entry="${kind}"]`);
  if (clearEntry) entry.value = "";
  entry.setCustomValidity("");
  renderMultiValueField(kind);
}

function commitMultiValueEntry(kind, { announce = false } = {}) {
  const config = CUSTOM_FORM_OPTION_FIELDS[kind];
  if (!config) return false;
  const entry = $(`[data-multi-value-entry="${kind}"]`);
  const rawValue = entry.value.trim();
  if (!rawValue) {
    entry.setCustomValidity("");
    return true;
  }

  const rawEntries = splitMultiValueEntries(rawValue);
  const tooLong = rawEntries.filter((value) => value.length > config.maxLength);
  if (!rawEntries.length || tooLong.length) {
    const message = `每个${config.label}不能超过 ${config.maxLength} 个字符`;
    entry.setCustomValidity(message);
    if (announce) {
      entry.reportValidity();
      showToast(message, "error");
    }
    return false;
  }

  const previous = selectedMultiValues(kind);
  const next = normalizeMultiValueList([...previous, ...rawEntries], config.maxLength);
  if (next.length === previous.length && previous.length >= MULTI_VALUE_LIMIT) {
    const message = `每条投递最多添加 ${MULTI_VALUE_LIMIT} 个${config.label}`;
    entry.setCustomValidity(message);
    if (announce) {
      entry.reportValidity();
      showToast(message, "error");
    }
    return false;
  }

  const addedCount = next.length - previous.length;
  setSelectedMultiValues(kind, next, { clearEntry: true });
  if (announce && addedCount) showToast(`已添加 ${addedCount} 个${config.label}`);
  return true;
}

function removeSelectedMultiValue(kind, index) {
  const values = selectedMultiValues(kind);
  if (!values[index]) return;
  values.splice(index, 1);
  setSelectedMultiValues(kind, values);
  $(`[data-multi-value-entry="${kind}"]`)?.focus();
}

function renderCustomFormOptions() {
  for (const [kind, config] of Object.entries(CUSTOM_FORM_OPTION_FIELDS)) {
    const options = customFormOptions[config.key];
    const selectedKeys = new Set(selectedMultiValues(kind).map(customOptionKey));
    $(`#${kind}-custom-options`).innerHTML = options
      .map((value) => `<option value="${escapeHtml(value)}"></option>`)
      .join("");
    const toggle = $(`[data-custom-option-toggle="${kind}"]`);
    toggle.textContent = options.length ? `设置选项 (${options.length})` : "设置选项";
    const list = $(`#${kind}-custom-option-list`);
    list.innerHTML = options.length
      ? options.map((value, index) => {
        const selected = selectedKeys.has(customOptionKey(value));
        return `
        <div class="custom-option-item">
          <button type="button" class="custom-option-select${selected ? " is-selected" : ""}" data-custom-option-select="${kind}" data-custom-option-index="${index}" aria-pressed="${selected}" title="${selected ? "取消选择" : "选择"}：${escapeHtml(value)}"><span class="custom-option-check">✓</span><span>${escapeHtml(value)}</span></button>
          <button type="button" class="custom-option-delete" data-custom-option-delete="${kind}" data-custom-option-index="${index}" aria-label="删除${config.label}选项：${escapeHtml(value)}" title="删除这个选项">${icon("close")}</button>
        </div>`;
      }).join("")
      : `<p class="custom-option-empty">暂无手动添加的${config.label}选项</p>`;
    renderMultiValueField(kind);
  }
}

function setCustomOptionPanelExpanded(kind, expanded) {
  if (!CUSTOM_FORM_OPTION_FIELDS[kind]) return;
  for (const fieldKind of Object.keys(CUSTOM_FORM_OPTION_FIELDS)) {
    const shouldExpand = fieldKind === kind && expanded;
    $(`[data-custom-option-toggle="${fieldKind}"]`)?.setAttribute("aria-expanded", String(shouldExpand));
    $(`#${fieldKind}-custom-option-panel`)?.classList.toggle("is-hidden", !shouldExpand);
  }
}

function addCustomFormOptions(kind) {
  const config = CUSTOM_FORM_OPTION_FIELDS[kind];
  if (!config) return;
  const entry = $(`[data-custom-option-entry="${kind}"]`);
  const candidates = parseCustomOptionEntries(entry.value);
  if (!candidates.length) {
    showToast(`请输入要添加的${config.label}选项`, "error");
    entry.focus();
    return;
  }
  const validCandidates = candidates.filter((value) => value.length <= config.maxLength);
  const previousOptions = customFormOptions[config.key];
  const nextOptions = normalizeCustomOptionList(
    [...previousOptions, ...validCandidates],
    config.maxLength,
  );
  const addedCount = nextOptions.length - previousOptions.length;
  const skippedTooLong = candidates.length - validCandidates.length;
  if (!addedCount) {
    const reason = skippedTooLong === candidates.length ? `每个${config.label}选项不能超过 ${config.maxLength} 个字符` : "这些选项已经存在";
    showToast(reason, "error");
    entry.focus();
    return;
  }
  storeCustomFormOptions({
    ...customFormOptions,
    [config.key]: nextOptions,
  });
  entry.value = "";
  renderCustomFormOptions();
  setCustomOptionPanelExpanded(kind, true);
  showToast(`已添加 ${addedCount} 个${config.label}选项${skippedTooLong ? `，跳过 ${skippedTooLong} 个过长内容` : ""}`);
}

function selectCustomFormOption(kind, index) {
  const config = CUSTOM_FORM_OPTION_FIELDS[kind];
  const value = config ? customFormOptions[config.key]?.[index] : "";
  if (!config || !value) return;
  const values = selectedMultiValues(kind);
  const selectedIndex = values.findIndex((item) => customOptionKey(item) === customOptionKey(value));
  if (selectedIndex >= 0) {
    values.splice(selectedIndex, 1);
  } else {
    values.push(value);
  }
  setSelectedMultiValues(kind, values);
  setCustomOptionPanelExpanded(kind, true);
}

function deleteCustomFormOption(kind, index) {
  const config = CUSTOM_FORM_OPTION_FIELDS[kind];
  const options = config ? customFormOptions[config.key] : null;
  if (!config || !options?.[index]) return;
  const removed = options[index];
  storeCustomFormOptions({
    ...customFormOptions,
    [config.key]: options.filter((_, optionIndex) => optionIndex !== index),
  });
  renderCustomFormOptions();
  setCustomOptionPanelExpanded(kind, true);
  showToast(`已删除${config.label}选项“${removed}”`);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeUrl(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue || (/^[a-z][a-z\d+.-]*:/i.test(rawValue) && !/^https?:\/\//i.test(rawValue))) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function directTarget(value) {
  const rawValue = String(value ?? "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawValue)) {
    return { href: `mailto:${rawValue}`, value: rawValue, label: "发送邮件", kind: "email" };
  }
  const url = safeUrl(rawValue);
  return url
    ? { href: url, value: url, label: "打开链接", kind: "url" }
    : { href: "", value: rawValue, label: "打开链接", kind: "text" };
}

function applicationTarget(application) {
  const email = String(application.applicationEmail ?? "").trim();
  const target = directTarget(email || application.jobUrl);
  if (!target.href) return { ...target, label: "" };
  return { ...target, label: target.kind === "email" ? "发送投递邮件" : "打开投递链接" };
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

function baseBoardColumns(quickFilter = filters.quick) {
  if (quickFilter === "followup") return [FOLLOW_UP_COLUMN];
  if (quickFilter === "ongoing") return STAGES.filter((stage) => stage.id === "applied");
  if (quickFilter === "assessment") return STAGES.filter((stage) => stage.id === "assessment");
  if (quickFilter === "interviewing") {
    return STAGES.filter((stage) => INTERVIEW_STAGE_IDS.has(stage.id));
  }
  if (quickFilter === "offer") return STAGES.filter((stage) => stage.id === "offer");
  if (quickFilter === "closed") return [CLOSED_COLUMN];
  return [...STAGES, CLOSED_COLUMN];
}

function currentBoardColumns() {
  const columns = baseBoardColumns();
  return filters.quick === "followup" || filters.stage === "all"
    ? columns
    : columns.filter((column) => column.id === filters.stage);
}

function updateQuickFilterControls() {
  $$('[data-quick-filter]').forEach((button) => {
    const isActive = button.dataset.quickFilter === filters.quick;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  $$('[data-summary-filter]').forEach((button) => {
    const isSelected = button.dataset.summaryFilter === filters.quick;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });
}

function applyQuickFilter(quickFilter, { scroll = true } = {}) {
  if (!QUICK_FILTERS.has(quickFilter)) return;
  filters.quick = quickFilter;

  const availableColumns = new Set(baseBoardColumns(quickFilter).map((column) => column.id));
  if (filters.stage !== "all" && !availableColumns.has(filters.stage)) {
    filters.stage = "all";
    elements.stageFilter.value = "all";
  }

  updateQuickFilterControls();
  renderWorkspace();
  if (scroll) $("#pipeline-heading").scrollIntoView({ behavior: "smooth", block: "start" });
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

function setJobLinkAnalysisStatus(message = DEFAULT_JOB_LINK_ANALYSIS_COPY, state = "") {
  elements.jobLinkAnalysisStatus.textContent = message;
  elements.jobLinkAnalysisStatus.classList.toggle("is-success", state === "success");
  elements.jobLinkAnalysisStatus.classList.toggle("is-warning", state === "warning");
}

function updateOpenJobLinkButton() {
  const target = directTarget(elements.applicationForm.elements.jobUrl.value);
  const enabled = Boolean(target.href);
  elements.openJobLinkLabel.textContent = target.label;
  elements.openJobLinkButton.classList.toggle("is-disabled", !enabled);
  elements.openJobLinkButton.setAttribute("aria-disabled", String(!enabled));
  elements.openJobLinkButton.tabIndex = enabled ? 0 : -1;

  if (!enabled) {
    elements.openJobLinkButton.removeAttribute("href");
    elements.openJobLinkButton.removeAttribute("target");
    elements.openJobLinkButton.removeAttribute("rel");
    return;
  }

  elements.openJobLinkButton.href = target.href;
  if (target.kind === "url") {
    elements.openJobLinkButton.target = "_blank";
    elements.openJobLinkButton.rel = "noopener noreferrer";
  } else {
    elements.openJobLinkButton.removeAttribute("target");
    elements.openJobLinkButton.removeAttribute("rel");
  }
}

function analyzeCompanyFromJobUrl({ announce = false } = {}) {
  const jobUrlField = elements.applicationForm.elements.jobUrl;
  const companyField = elements.applicationForm.elements.company;
  updateOpenJobLinkButton();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(jobUrlField.value.trim())) {
    setJobLinkAnalysisStatus("已识别为投递邮箱；请手动填写公司名称。", "success");
    return;
  }
  const result = inferCompanyFromUrl(jobUrlField.value);

  if (!jobUrlField.value.trim()) {
    setJobLinkAnalysisStatus("请先粘贴岗位链接，再识别公司。", "warning");
    return;
  }
  if (!result.company) {
    setJobLinkAnalysisStatus("链接中没有可识别的公司信息，请手动填写公司名称。招聘平台链接常见这种情况。", "warning");
    return;
  }

  const currentCompany = companyField.value.trim();
  const previousInference = companyField.dataset.inferredCompany ?? "";
  const canFill = !currentCompany || currentCompany === previousInference;
  const actionLabel = result.confidence === "high" ? "识别" : "推测";

  if (canFill) {
    companyField.value = result.company;
    companyField.dataset.inferredCompany = result.company;
    setJobLinkAnalysisStatus(`已从链接${actionLabel}为“${result.company}”，请确认名称是否正确。`, "success");
    if (announce) showToast(`已${actionLabel}公司：${result.company}`);
    return;
  }

  if (currentCompany === result.company) {
    setJobLinkAnalysisStatus(`当前公司名称与链接${actionLabel}结果一致。`, "success");
  } else {
    setJobLinkAnalysisStatus(`链接${actionLabel}为“${result.company}”；已保留你填写的“${currentCompany}”。`, "warning");
  }
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
    appliedAt: formValue(form, "appliedAt"),
    jobUrl: formValue(form, "jobUrl"),
    nextFollowUp: formValue(form, "nextFollowUp"),
    tags: formValue(form, "tags"),
    notes: formValue(form, "notes"),
  };
}

function openApplicationForm(application = null) {
  elements.applicationForm.reset();
  for (const kind of Object.keys(CUSTOM_FORM_OPTION_FIELDS)) {
    $(`[data-multi-value-entry="${kind}"]`).setCustomValidity("");
    setCustomOptionPanelExpanded(kind, false);
  }
  const title = $("#application-dialog-title");
  const submitLabel = $("#save-application-button");
  const idField = elements.applicationForm.elements.applicationId;
  delete elements.applicationForm.elements.company.dataset.inferredCompany;
  setJobLinkAnalysisStatus();

  if (!application) {
    title.textContent = "新建投递";
    submitLabel.lastChild.textContent = "保存投递";
    idField.value = "";
    elements.applicationForm.elements.appliedAt.value = localDateString();
  } else {
    title.textContent = "编辑投递";
    submitLabel.lastChild.textContent = "保存修改";
    idField.value = application.id;
    for (const name of ["company", "position", "city", "salary", "nextFollowUp", "notes"]) {
      elements.applicationForm.elements[name].value = application[name] ?? "";
    }
    elements.applicationForm.elements.jobUrl.value = application.applicationEmail || application.jobUrl || "";
    elements.applicationForm.elements.appliedAt.value = formatDateInput(application.appliedAt);
    elements.applicationForm.elements.tags.value = application.tags.join("，");
  }
  renderCustomFormOptions();
  updateOpenJobLinkButton();
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
        application.salary,
        application.jobUrl,
        application.applicationEmail,
        application.tags.join(" "),
        application.notes,
      ].join(" ").toLocaleLowerCase("zh-CN");
      if (!haystack.includes(search)) return false;
    }
    if (filters.city !== "all") {
      const selectedCityKey = customOptionKey(filters.city);
      const applicationCities = parseMultiValueEntries(
        application.city,
        CUSTOM_FORM_OPTION_FIELDS.city.maxLength,
      );
      if (!applicationCities.some((city) => customOptionKey(city) === selectedCityKey)) return false;
    }
    if (filters.stage !== "all" && outcomeColumn(application) !== filters.stage) return false;
    if (filters.quick === "followup" && !hasScheduledFollowUp(application)) return false;
    if (!["all", "followup"].includes(filters.quick) && applicationCategory(application) !== filters.quick) return false;
    return true;
  }).sort((a, b) => filters.quick === "followup"
    ? a.nextFollowUp.localeCompare(b.nextFollowUp) || new Date(b.updatedAt) - new Date(a.updatedAt)
    : new Date(b.updatedAt) - new Date(a.updatedAt));
}

function cardHtml(application) {
  const stage = stageById(application.currentStageId);
  const currentStageCompleted = isCurrentStageCompleted(application);
  const overdue = isFollowUpDue(application);
  const closed = ["rejected", "withdrawn"].includes(application.status);
  const progress = applicationProgress(application);
  const tags = application.tags.slice(0, 2);
  const statusTag = application.status === "paused"
    ? `<span class="tag status-tag">已搁置</span>`
    : closed
      ? `<span class="tag status-tag">${escapeHtml(statusLabel(application))}</span>`
      : "";
  const importTag = application.importSource?.format === "csv"
    ? `<span class="tag import-source-tag">CSV 导入</span>`
    : "";
  const quickButton = !closed && application.status !== "offer"
    ? `<button class="quick-progress" type="button" data-action="progress" data-id="${application.id}">${icon("arrow")}记录新进展</button>`
    : "";
  const followUpDate = application.nextFollowUp
    ? `跟进 ${application.nextFollowUp.replaceAll("-", "/")}`
    : closed || application.status === "offer"
      ? "无需跟进"
      : "未设跟进";
  const followUpClass = overdue ? " is-due" : application.nextFollowUp ? "" : " is-empty";

  return `
    <article class="application-card${overdue ? " is-overdue" : ""}${closed ? " is-closed" : ""}"
      data-open-detail="${application.id}" data-application-id="${application.id}" tabindex="0"
      ${closed || filters.quick === "followup" ? "" : "draggable=\"true\""} style="${stageStyle(stage.id)}">
      <div class="card-top">
        <span class="company-avatar" style="${avatarStyle(application.company)}">${escapeHtml(companyInitial(application.company))}</span>
        <div class="card-title"><h4>${escapeHtml(application.company)}</h4><p>${escapeHtml(application.position)}</p></div>
        <button class="card-more" type="button" data-action="details" data-id="${application.id}" aria-label="查看详情">${icon("more")}</button>
      </div>
      <div class="card-tags">
        <span class="tag stage-tag" style="${stageStyle(stage.id)}">${escapeHtml(stage.label)}</span>
        ${currentStageCompleted ? `<span class="tag completed-stage-tag">${icon("check")}已完成</span>` : ""}
        ${overdue ? `<span class="tag overdue-tag">待跟进</span>` : ""}
        ${statusTag}
        ${importTag}
        ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
      <div class="card-meta">
        ${application.city ? `<span>${icon("pin")}${escapeHtml(application.city)}</span>` : ""}
        <span>${icon("calendar")}${formatDate(application.appliedAt)}</span>
        <span class="card-follow-up-date${followUpClass}" title="下次跟进日期">${icon("clock")}${escapeHtml(followUpDate)}</span>
      </div>
      <div class="progress-track" title="流程完成度 ${progress}%"><span style="width:${progress}%"></span></div>
      ${quickButton}
    </article>`;
}

function renderBoard(items) {
  const columns = currentBoardColumns();
  elements.board.classList.toggle("is-card-grid", ["followup", "ongoing", "assessment"].includes(filters.quick));

  elements.board.innerHTML = columns.map((column) => {
    const cards = filters.quick === "followup"
      ? items
      : items.filter((application) => outcomeColumn(application) === column.id);
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
      <thead><tr><th>公司 / 岗位</th><th>城市</th><th>当前进度</th><th>投递日期</th><th>流程完成度</th><th>链接 / 邮箱</th></tr></thead>
      <tbody>
        ${items.map((application) => {
          const stage = stageById(application.currentStageId);
          const progress = applicationProgress(application);
          const target = applicationTarget(application);
          return `<tr data-open-detail="${application.id}" tabindex="0">
            <td><div class="table-company"><span class="company-avatar" style="${avatarStyle(application.company)}">${escapeHtml(companyInitial(application.company))}</span><span><strong>${escapeHtml(application.company)}</strong><small>${escapeHtml(application.position)}</small></span></div></td>
            <td>${escapeHtml(application.city || "—")}</td>
            <td><span class="table-stage" style="${stageStyle(stage.id)}"><i class="stage-dot"></i>${escapeHtml(statusLabel(application))}</span></td>
            <td>${formatDate(application.appliedAt, fullDateFormatter)}</td>
            <td><span class="table-progress"><span class="progress-track" style="${stageStyle(stage.id)}"><span style="width:${progress}%"></span></span>${progress}%</span></td>
            <td>${target.href ? `<a class="table-link" href="${escapeHtml(target.href)}" ${target.kind === "url" ? "target=\"_blank\" rel=\"noopener noreferrer\"" : ""} data-stop-detail>${escapeHtml(target.kind === "email" ? "发送邮件" : "查看链接")}</a>` : escapeHtml(target.value || "—")}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function renderFilters() {
  const citiesByKey = new Map();
  for (const application of applications) {
    for (const city of parseMultiValueEntries(application.city, CUSTOM_FORM_OPTION_FIELDS.city.maxLength)) {
      if (!citiesByKey.has(customOptionKey(city))) citiesByKey.set(customOptionKey(city), city);
    }
  }
  const cities = [...citiesByKey.values()]
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
  $("#stat-ongoing").textContent = summary.ongoing;
  $("#stat-assessment").textContent = summary.assessment;
  $("#stat-interviewing").textContent = summary.interviewing;
  $("#stat-offers").textContent = summary.offers;
  $("#nav-total").textContent = summary.total;
  $("#nav-followup").textContent = summary.followUps;
  $("#nav-followup").classList.toggle("is-alert", summary.followUps > 0);
  $("#nav-ongoing").textContent = summary.ongoing;
  $("#nav-assessment").textContent = summary.assessment;
  $("#nav-interviewing").textContent = summary.interviewing;
  $("#nav-offers").textContent = summary.offers;
  $("#nav-closed").textContent = summary.closed;
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
  $("#pipeline-heading").textContent = QUICK_FILTER_TITLES[filters.quick] ?? QUICK_FILTER_TITLES.all;
  $("#visible-count").textContent = `${items.length} 个机会`;
  elements.board.classList.toggle("is-hidden", view !== "board" || items.length === 0);
  elements.list.classList.toggle("is-hidden", view !== "list" || items.length === 0);
  elements.empty.classList.toggle("is-hidden", items.length !== 0);

  if (items.length) {
    renderBoard(items);
    renderList(items);
  } else {
    elements.board.replaceChildren();
    elements.list.replaceChildren();
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
  updateQuickFilterControls();
  renderWorkspace();
  if (activeDetailId && elements.detailDialog.open) renderDetail(activeDetailId);
}

function routeHtml(application) {
  const complete = completedStageIds(application);
  const skipped = new Set(application.timeline.filter((event) => event.type === "skipped").map((event) => event.stageId));
  return application.pipeline.map((stageId) => {
    const stage = stageById(stageId);
    const isCurrent = application.currentStageId === stageId;
    const isComplete = isCurrent
      ? isCurrentStageCompleted(application)
      : complete.has(stageId);
    const isSkipped = skipped.has(stageId);
    const classes = [
      "route-step",
      isComplete ? "is-complete" : "",
      isSkipped ? "is-skipped" : "",
      isCurrent ? "is-current" : "",
    ].filter(Boolean).join(" ");
    const marker = isComplete ? "✓" : isCurrent ? "•" : "";
    const canComplete = isCurrent
      && !isComplete
      && !isSkipped
      && stageId !== "offer"
      && application.status === "active";
    const completionControl = isComplete
      ? `<span class="route-complete-state">${icon("check")}已完成</span>`
      : canComplete
        ? `<button class="route-complete-button" type="button" data-detail-action="complete-stage" data-stage-id="${stageId}">${icon("check")}标记已完成</button>`
        : "";
    return `<div class="${classes}" style="${stageStyle(stageId)}"><span class="route-node">${marker}</span><span class="route-label">${escapeHtml(stage.shortLabel)}</span>${completionControl}</div>`;
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
  const target = applicationTarget(application);
  const closed = ["rejected", "withdrawn"].includes(application.status);
  const statusClass = application.status === "offer" ? " is-offer" : closed ? " is-closed" : "";
  const primaryAction = !closed && application.status !== "offer"
    ? `<button class="button button-primary" type="button" data-detail-action="progress">${icon("arrow")}记录公司通知的下一步</button>`
    : application.status === "offer"
      ? `<button class="button button-ghost" type="button" data-detail-action="status">${icon("sparkle")}更新最终状态</button>`
      : `<button class="button button-primary" type="button" data-detail-action="status">${icon("arrow")}重新开启流程</button>`;
  const visibleStatusAction = !closed && application.status !== "offer"
    ? `<button class="button button-ghost detail-status-action" type="button" data-detail-action="status">${icon("more")}更新流程状态</button>`
    : "";
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
        ${target.href ? `<a href="${escapeHtml(target.href)}" ${target.kind === "url" ? "target=\"_blank\" rel=\"noopener noreferrer\"" : ""}>${icon("link")}${escapeHtml(target.label)}</a>` : target.value ? `<span>${icon("link")}${escapeHtml(target.value)}</span>` : ""}
      </div>
      ${application.tags.length || application.importSource?.format === "csv" ? `<div class="detail-tags">${application.importSource?.format === "csv" ? `<span class="tag import-source-tag">CSV 导入</span>` : ""}${application.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <div class="detail-actions">
        ${primaryAction}
        <div class="detail-secondary-actions">
          ${visibleStatusAction}
          <button class="icon-button" type="button" data-detail-action="edit" title="编辑投递" aria-label="编辑投递">${icon("edit")}</button>
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
      <div class="detail-section-header"><h3>岗位与准备备注</h3></div>
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

function renderProgressCurrent(application) {
  const stage = stageById(application.currentStageId);
  const currentCompleted = isCurrentStageCompleted(application);
  const completionUnavailable = application.status !== "active";
  $("#progress-current").innerHTML = `<span class="stage-bubble" style="${stageStyle(stage.id)}">${escapeHtml(stage.shortLabel.slice(0, 2))}</span><span><strong>当前：${escapeHtml(stage.label)}</strong><small>${currentCompleted ? "本环节已完成，等待公司通知下一步" : "下一步以公司实际通知为准"}</small></span>`;
  const completionButton = $("#progress-complete-current-button");
  completionButton.disabled = currentCompleted || completionUnavailable;
  completionButton.classList.toggle("is-complete", currentCompleted);
  $("#progress-complete-current-label").textContent = currentCompleted
    ? "本环节已完成"
    : completionUnavailable
      ? "流程已搁置"
      : "标记本环节已完成";
}

function openProgress(applicationId) {
  const application = applications.find((item) => item.id === applicationId);
  if (!application || ["offer", "rejected", "withdrawn"].includes(application.status)) return;
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
  renderProgressCurrent(application);
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
  const headers = ["公司", "岗位", "城市", "当前进度", "状态", "投递日期", "下次跟进", "薪资", "投递链接/邮箱", "标签", "备注"];
  const rows = applications.map((application) => [
    application.company,
    application.position,
    application.city,
    stageById(application.currentStageId).label,
    statusLabel(application),
    formatDateInput(application.appliedAt),
    application.nextFollowUp,
    application.salary,
    application.applicationEmail || application.jobUrl,
    application.tags.join("；"),
    application.notes,
  ]);
  const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}`;
  downloadFile(csv, `jobtrail-applications-${localDateString()}.csv`, "text/csv;charset=utf-8");
  showToast(`已导出 ${applications.length} 条 CSV 记录`);
}

async function decodeCsvFile(file) {
  if (file.size > 10 * 1024 * 1024) throw new Error("CSV 文件超过 10 MB，请先精简后再导入");
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(buffer);
    } catch {
      throw new Error("无法识别 CSV 编码，请另存为 UTF-8 CSV 后重试");
    }
  }
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
  elements.analyzeJobLinkButton.addEventListener("click", () => analyzeCompanyFromJobUrl({ announce: true }));
  elements.openJobLinkButton.addEventListener("click", (event) => {
    if (elements.openJobLinkButton.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
  elements.applicationForm.elements.jobUrl.addEventListener("change", () => analyzeCompanyFromJobUrl());
  elements.applicationForm.elements.jobUrl.addEventListener("input", () => {
    setJobLinkAnalysisStatus();
    updateOpenJobLinkButton();
  });
  elements.applicationForm.elements.jobUrl.addEventListener("paste", () => {
    window.setTimeout(() => analyzeCompanyFromJobUrl(), 0);
  });
  elements.applicationForm.elements.company.addEventListener("input", () => {
    const field = elements.applicationForm.elements.company;
    if (field.dataset.inferredCompany && field.value.trim() !== field.dataset.inferredCompany) {
      delete field.dataset.inferredCompany;
    }
  });
  for (const kind of Object.keys(CUSTOM_FORM_OPTION_FIELDS)) {
    const entry = $(`[data-multi-value-entry="${kind}"]`);
    entry.addEventListener("input", () => entry.setCustomValidity(""));
    entry.addEventListener("change", () => commitMultiValueEntry(kind));
  }
  elements.applicationForm.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-multi-value-remove]");
    if (removeButton) {
      removeSelectedMultiValue(
        removeButton.dataset.multiValueRemove,
        Number(removeButton.dataset.multiValueIndex),
      );
      return;
    }
    const addButton = event.target.closest("[data-custom-option-add]");
    if (addButton) {
      addCustomFormOptions(addButton.dataset.customOptionAdd);
      return;
    }
    const deleteButton = event.target.closest("[data-custom-option-delete]");
    if (deleteButton) {
      deleteCustomFormOption(
        deleteButton.dataset.customOptionDelete,
        Number(deleteButton.dataset.customOptionIndex),
      );
      return;
    }
    const selectButton = event.target.closest("[data-custom-option-select]");
    if (selectButton) {
      selectCustomFormOption(
        selectButton.dataset.customOptionSelect,
        Number(selectButton.dataset.customOptionIndex),
      );
      return;
    }
    const toggle = event.target.closest("[data-custom-option-toggle]");
    if (toggle) {
      setCustomOptionPanelExpanded(
        toggle.dataset.customOptionToggle,
        toggle.getAttribute("aria-expanded") !== "true",
      );
    }
  });
  elements.applicationForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const multiValueEntry = event.target.closest("[data-multi-value-entry]");
    if (multiValueEntry) {
      event.preventDefault();
      commitMultiValueEntry(multiValueEntry.dataset.multiValueEntry, { announce: true });
      return;
    }
    const entry = event.target.closest("[data-custom-option-entry]");
    if (!entry) return;
    event.preventDefault();
    addCustomFormOptions(entry.dataset.customOptionEntry);
  });
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
    let multiValuesValid = true;
    for (const kind of Object.keys(CUSTOM_FORM_OPTION_FIELDS)) {
      if (!commitMultiValueEntry(kind)) multiValuesValid = false;
    }
    const positionEntry = $('[data-multi-value-entry="position"]');
    if (multiValuesValid) {
      positionEntry.setCustomValidity(selectedMultiValues("position").length ? "" : "请至少添加一个岗位");
    }
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

  $("#progress-complete-current-button").addEventListener("click", () => {
    const applicationId = formValue(elements.progressForm, "applicationId");
    const existing = applications.find((application) => application.id === applicationId);
    if (!existing) return;
    const updated = markCurrentStageCompleted(existing, {
      at: formValue(elements.progressForm, "completedAt"),
      note: formValue(elements.progressForm, "note"),
      nextFollowUp: formValue(elements.progressForm, "nextFollowUp"),
    });
    if (updated.timeline.length <= existing.timeline.length) return;
    updateApplicationInState(updated);
    persist(`「${stageById(updated.currentStageId).label}」已标记完成`);
    elements.progressDialog.close();
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
    if (action === "complete-stage") {
      const stageId = button.dataset.stageId;
      if (stageId === application.currentStageId) {
        const updated = markCurrentStageCompleted(application);
        if (updated.timeline.length > application.timeline.length) {
          updateApplicationInState(updated);
          persist(`「${stageById(stageId).label}」已标记完成`);
          renderAll();
        }
      }
    }
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
    applyQuickFilter(button.dataset.quickFilter);
  }));

  $$('[data-summary-filter]').forEach((button) => button.addEventListener("click", () => {
    applyQuickFilter(button.dataset.summaryFilter);
  }));

  $("#theme-toggle").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  $("#export-button").addEventListener("click", exportJson);
  $("#export-csv-button")?.addEventListener("click", exportCsv);
  $("#import-csv-button").addEventListener("click", () => elements.csvImportFile.click());
  $("#import-csv-top-button").addEventListener("click", () => elements.csvImportFile.click());
  elements.csvImportFile.addEventListener("change", async () => {
    const file = elements.csvImportFile.files?.[0];
    if (!file) return;
    try {
      const parsed = readJobCsv(await decodeCsvFile(file), {
        fallbackAppliedAt: localDateString(),
      });
      if (!parsed.records.length) throw new Error("CSV 中没有同时填写公司和岗位的记录");
      if (parsed.stats.fallbackDateCount) {
        const confirmed = window.confirm(
          `CSV 中有 ${parsed.stats.fallbackDateCount} 条记录没有有效投递日期，将以今天作为导入日期。是否继续？`,
        );
        if (!confirmed) return;
      }
      const result = mergeCsvApplications(applications, parsed.records);
      applications = result.applications;
      const skipped = parsed.stats.skippedMissingRequired + parsed.stats.skippedDuplicates;
      persist(`CSV 导入完成：新增 ${result.stats.created}，更新 ${result.stats.updated}，跳过 ${skipped}`);
      resetFilters();
    } catch (error) {
      console.error(error);
      showToast(error.message || "CSV 导入失败，请检查列名和文件内容", "error");
    } finally {
      elements.csvImportFile.value = "";
    }
  });
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
  for (const key of ["form-history", "form-history-initialized", "form-history-dismissed"]) {
    removePreference(key);
  }
  $("#today-label").textContent = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
  setupEventListeners();
  renderAll();
  document.documentElement.dataset.appReady = "true";
}

initialize();
