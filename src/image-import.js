const FIELD_LABELS = Object.freeze({
  company: ["公司名称", "企业名称", "单位名称", "公司全称", "招聘单位", "招聘公司"],
  location: ["工作地点", "工作地址", "工作城市", "招聘城市", "岗位城市", "单位地址", "公司地址", "工作地", "工作区域", "地点", "城市", "地址"],
  position: ["招聘职位", "招聘岗位", "招聘专业", "需求专业", "岗位名称", "职位名称", "招聘职务", "岗位", "职位"],
});
const STOP_LABELS = /^(?:截止时间|截止日期|薪资|薪酬|待遇|岗位职责|职位描述|工作职责|任职要求|岗位要求|职位要求|招聘要求|专业要求|学历要求|学历|招聘人数|需求人数|联系人|联系电话|联系方式|投递方式|投递链接|公司简介|企业简介|单位简介|福利|报名|申请|打开官网|关闭|查看更多)/u;
const COMPANY_SUFFIX = /(?:有限责任公司|股份有限公司|有限公司|集团|研究院|研究所|银行|医院|设计院|事务所|中心)$/u;
const ROLE_ENDING = /(?:工程师|设计师|研究员|技术员|经理|专员|主管|管培生|实习生|助理|开发|运营|岗位)$/u;
const CITIES = "北京 上海 天津 重庆 石家庄 唐山 秦皇岛 邯郸 保定 张家口 廊坊 沧州 衡水 太原 大同 呼和浩特 包头 鄂尔多斯 沈阳 大连 鞍山 长春 吉林 哈尔滨 大庆 南京 苏州 无锡 常州 南通 扬州 镇江 盐城 徐州 杭州 宁波 温州 绍兴 嘉兴 湖州 金华 义乌 台州 舟山 丽水 合肥 芜湖 蚌埠 马鞍山 福州 厦门 泉州 莆田 漳州 南昌 赣州 九江 济南 青岛 烟台 威海 潍坊 淄博 济宁 郑州 洛阳 新乡 开封 武汉 宜昌 襄阳 长沙 株洲 湘潭 岳阳 广州 深圳 珠海 佛山 东莞 中山 惠州 汕头 江门 湛江 南宁 桂林 柳州 海口 三亚 成都 绵阳 德阳 宜宾 贵阳 遵义 昆明 曲靖 大理 拉萨 西安 咸阳 宝鸡 榆林 兰州 西宁 银川 乌鲁木齐 香港 澳门 台北".split(" ").sort((a, b) => b.length - a.length);
const CITY_PATTERN = new RegExp(CITIES.join("|"), "gu");

export function normalizeRecognitionText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/(?<=\p{Script=Han})[\t ]+(?=\p{Script=Han})/gu, "")
    .replace(/[\t ]*([，、：；])[\t ]*/gu, "$1")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("zh-CN");
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findHeading(line) {
  for (const [field, labels] of Object.entries(FIELD_LABELS)) {
    for (const label of labels) {
      if (line.startsWith(label)) {
        return { field, value: line.slice(label.length).replace(/^[\s:：|丨]+/u, "") };
      }
    }
  }
  return null;
}

function cleanCandidate(value) {
  return value.trim()
    .replace(/\s{2,}[Xx×✕✖]$/u, "")
    .replace(/^(?:[•●·\-–—]+|\d+[.、)）])\s*/u, "")
    .replace(/^[\s:：|丨“”‘’]+|[\s。…]+$/gu, "")
    .trim();
}

function joinPositionLines(lines) {
  return lines.reduce((text, line) => {
    const next = cleanCandidate(line);
    if (!next) return text;
    const newItem = /^(?:[•●·\-–—]+|\d+[.、)）])/u.test(line) || ROLE_ENDING.test(text);
    return text + (text && newItem && !/[,，、;；]$/u.test(text) ? "、" : "") + next;
  }, "");
}

export function extractRecruitmentFields(value) {
  const text = normalizeRecognitionText(value);
  // Some screenshots render several labelled fields on a single row.
  const labelAlternatives = Object.values(FIELD_LABELS).flat().sort((a, b) => b.length - a.length).join("|");
  const lines = text.replace(new RegExp(`(?:${labelAlternatives})[:：]`, "gu"), (match, offset) =>
    offset && text[offset - 1] !== "\n" ? `\n${match}` : match).split("\n");
  const sections = { company: [], location: [], position: [] };
  const unlabelled = [];
  let activeField = null;
  for (const line of lines) {
    if (!line) continue;
    const heading = findHeading(line);
    if (heading) {
      activeField = heading.field;
      if (heading.value) sections[activeField].push(heading.value);
      continue;
    }
    if (STOP_LABELS.test(line) || /^[\p{Script=Han}]{2,8}[:：]/u.test(line)) {
      activeField = null;
      continue;
    }
    if (activeField) sections[activeField].push(line);
    else unlabelled.push(line);
  }

  let company = cleanCandidate(sections.company[0] ?? "");
  if (!company) {
    company = unlabelled.map(cleanCandidate).find((line) => line.length <= 80 && COMPANY_SUFFIX.test(line)) ?? "";
  }
  if (!company) {
    const first = cleanCandidate(unlabelled[0] ?? "");
    if (/^[\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z\d .&·()（）-]{1,39}$/u.test(first)
      && !/(?:招聘|校招|秋招|春招|信息|详情|届|本科|硕士|博士|岗位|职位|工程师|专业|投递)/u.test(first)) {
      company = first;
    }
  }

  let positionLines = sections.position;
  if (!positionLines.length) {
    // Light grey field headings can be lost by OCR; retain clear enumerated job/major lists.
    const start = unlabelled.findIndex((line) => /[,，、;；]/u.test(line)
      && /(?:工程|技术|管理|设计|研发|学|自动化|运营|研究)/u.test(line));
    if (start >= 0) positionLines = unlabelled.slice(start);
  }
  const positionText = joinPositionLines(positionLines);
  const positions = unique((positionText
    ? positionText.split(/[,，、;；\n]+/u)
    : unlabelled.filter((line) => ROLE_ENDING.test(line) && line !== company))
    .map(cleanCandidate).filter((item) => item && !/^(?:等|不限|若干|[.…]+)$/u.test(item)));

  const locations = unique(sections.location.flatMap((line) => line.split(/[,，、;；/|丨\n]+/u)).map(cleanCandidate));
  const cities = unique(locations.flatMap((location) => {
    const found = [...location.matchAll(CITY_PATTERN)]
      .filter((match) => !/^(?:[东西南北]?路|[东西南北]?街|大道|巷)/u.test(location.slice(match.index + match[0].length)))
      .map((match) => match[0]);
    return found.length ? found : [location.replace(/市$/u, "")];
  }));
  const address = locations.filter((location) => /(?:路|街|号|大厦|园区|楼|室|镇|乡)/u.test(location)).join("；");
  return { company, cities, positions, address, text };
}
