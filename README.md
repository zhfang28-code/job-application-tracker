# JobTrail 职迹

一款本地优先的求职投递进度管理网页。把投递链接或邮箱、公司、城市和招聘进展放在同一张看板里；收到公司的下一步通知后，选择实际环节，系统会自动补充流程与时间线。可选配飞书 → JobTrail 单向自动同步。

## 功能

- 投递档案：公司、岗位、城市、薪资、投递链接或邮箱、标签与备注
- 链接识别公司：粘贴企业招聘官网或包含公司信息的岗位链接后，在浏览器本地尝试填写公司名称
- 动态招聘流程：新建时无需猜测完整流程；收到通知后再添加在线测试、AI 面试、一面、二面、终面、HR 面或 Offer
- 自动进展时间线：完成、跳过、跨阶段移动、回退、暂停、未通过和撤回都会保留记录
- 看板与列表双视图：支持搜索、城市筛选、阶段筛选和快捷状态筛选
- 跟进提醒：到期记录会出现在首页提醒区，并在卡片上突出显示
- 拖动更新：桌面端可把卡片拖到该公司流程中的目标阶段，跨过的环节自动记为跳过
- 本地持久化：数据保存在浏览器 `localStorage`；只有主动配置飞书同步后才会请求指定云函数
- 飞书单向同步：打开页面时经安全云函数读取飞书，只创建或更新 JobTrail 记录，不回写飞书
- 字段白名单：仅同步投递公司、链接 / 邮箱、投递时间、岗位和目前进度，不请求简历
- 备份迁移：支持 JSON 完整备份的导入/合并，以及 CSV 导出
- PWA 与离线访问：可安装到桌面或手机主屏幕
- 深色模式、键盘快捷键与移动端响应式布局

## 本地运行

无需安装第三方依赖，只需 Node.js 20 或更高版本：

```bash
npm start
```

然后访问 <http://127.0.0.1:4173>。

也可以直接使用任意静态文件服务器托管项目根目录。由于页面使用 ES Modules，不建议直接双击 `index.html` 以 `file://` 方式打开。

## 测试

```bash
npm test
npm run check
```

当前自动化测试覆盖链接识别公司、动态流程、自动推进、跳过环节、跨阶段移动、回退重开、终止状态、跟进日期、统计、备份合并、飞书字段白名单、分页、去重和进度转换。`scripts/browser-smoke.mjs` 还可连接 Chrome DevTools，执行真实浏览器烟雾测试。

## 数据与隐私

未配置飞书同步时，投递信息只保存在当前浏览器和当前站点域名下。配置后，浏览器会从指定的只读云函数获取白名单字段并写入本机 `localStorage`；云函数密钥不在前端代码中。清理浏览器数据或更换设备后，需要重新填写同步服务地址与访问密钥。仍建议定期点击“导出数据”保存 JSON 备份。

## 飞书单向同步

GitHub Pages 是静态网站，不能安全保存飞书 App Secret，因此同步由“飞书自建应用 + 中国大陆云函数 + JobTrail”组成：

```text
飞书多维表格 ──只读 API──> 腾讯云函数 ──字段白名单──> JobTrail 浏览器本地存储
```

云函数代码位于 [`server/feishu-sync`](server/feishu-sync)，完整配置见[部署说明](server/feishu-sync/README.md)。同步以飞书 `record_id` 去重，不会自动删除本地记录，也不上传简历。

## 部署到 GitHub Pages

仓库包含 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)。推送到 `main` 后：

1. 打开仓库的 **Settings → Pages**。
2. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。
3. 重新运行 `Deploy JobTrail to GitHub Pages` 工作流（或再次推送）。

工作流会先运行单元测试，测试通过后再发布静态网页。

## 快捷键

| 快捷键 | 操作 |
| --- | --- |
| `N` | 新建投递 |
| `/` 或 `⌘ K` | 聚焦搜索 |
| `E` | 导出 JSON 备份 |

## 项目结构

```text
job-application-tracker/
├─ index.html                 # 页面结构与对话框
├─ styles.css                 # 桌面/移动/深色模式样式
├─ src/
│  ├─ app.js                  # 界面渲染与交互
│  ├─ feishu-sync.js          # 飞书字段解析、去重与同步客户端
│  ├─ model.js                # 流程、时间线和数据规则
│  └─ storage.js              # 本地持久化
├─ server/feishu-sync/        # 腾讯云只读同步服务
├─ tests/                     # Node.js 单元测试
├─ scripts/
│  ├─ dev-server.mjs          # 零依赖静态开发服务器
│  └─ browser-smoke.mjs       # Chrome 真实浏览器烟雾测试
├─ sw.js                      # 离线缓存
└─ .github/workflows/pages.yml
```

## 许可证

[MIT](LICENSE)
