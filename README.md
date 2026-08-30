# JobTrail 职迹

一款本地优先的求职投递进度管理网页。把岗位链接、公司、城市、投递渠道和招聘流程放在同一张看板里；完成或跳过一个环节时，系统会自动记录时间并进入下一步。

## 功能

- 投递档案：公司、岗位、城市、薪资、渠道、岗位链接、联系人、标签与备注
- 自定义招聘流程：已投递、在线测试、AI 面试、一面、二面、终面、HR 面、Offer；每家公司都能取消不需要的环节
- 自动进展时间线：完成、跳过、跨阶段移动、回退、暂停、未通过和撤回都会保留记录
- 看板与列表双视图：支持搜索、城市筛选、阶段筛选和快捷状态筛选
- 跟进提醒：到期记录会出现在首页提醒区，并在卡片上突出显示
- 拖动更新：桌面端可把卡片拖到该公司流程中的目标阶段，跨过的环节自动记为跳过
- 本地持久化：数据保存在浏览器 `localStorage`，不发送到服务器
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

当前自动化测试覆盖自定义流程、自动推进、跳过环节、跨阶段移动、回退重开、终止状态、跟进日期、统计和备份合并。`scripts/browser-smoke.mjs` 还可连接 Chrome DevTools，执行真实浏览器烟雾测试。

## 数据与隐私

JobTrail 没有后端，投递信息只保存在当前浏览器和当前站点域名下。清理浏览器数据、切换域名或更换设备都可能看不到原记录，因此建议定期点击“导出数据”保存 JSON 备份。导入时会按记录 ID 合并；同一记录保留更新时间较新的版本。

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
│  ├─ model.js                # 流程、时间线和数据规则
│  └─ storage.js              # 本地持久化
├─ tests/model.test.js        # Node.js 单元测试
├─ scripts/
│  ├─ dev-server.mjs          # 零依赖静态开发服务器
│  └─ browser-smoke.mjs       # Chrome 真实浏览器烟雾测试
├─ sw.js                      # 离线缓存
└─ .github/workflows/pages.yml
```

## 许可证

[MIT](LICENSE)
