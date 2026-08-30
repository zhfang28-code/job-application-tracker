# 飞书 → JobTrail 单向同步服务

这个零依赖 Node.js 服务部署在腾讯云 SCF Web 函数中。它使用飞书自建应用读取多维表格，只返回 JobTrail 允许的字段：

- 投递公司
- 链接 / 邮箱
- 投递时间
- 岗位
- 目前的进度

服务请求飞书记录时已通过 `field_names` 限定列名，不请求、不返回简历附件。JobTrail 不会调用任何写入飞书的接口。

## 1. 创建飞书自建应用

1. 在[飞书开放平台](https://open.feishu.cn/)创建企业自建应用。
2. 为应用开通 Wiki 节点读取权限和多维表格记录只读权限，然后发布应用版本。
3. 在目标 Wiki / 多维表格的协作者设置中添加该应用，使应用能访问此文档。
4. 记录应用的 `App ID` 与 `App Secret`。`App Secret` 只能放进腾讯云环境变量，不能粘贴到 JobTrail 网页、源代码或 GitHub。

飞书服务端鉴权使用官方的 [`tenant_access_token`](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal)；Wiki 链接先通过[获取 Wiki 节点信息](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/get_node)解析为 Base token，再调用[列出多维表格记录](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/list)。

## 2. 创建腾讯云 Web 函数

1. 进入[腾讯云云函数控制台](https://console.cloud.tencent.com/scf/list)，地域建议选择广州。
2. 创建 **Web 函数**，运行环境选择 **Node.js 20.19**，函数名可用 `jobtrail-feishu-sync`。
3. 上传本目录内容，确保 `server.js`、`service.js`、`package.json` 和 `scf_bootstrap` 位于压缩包根目录。
4. 启动文件为 `scf_bootstrap`，服务监听 `0.0.0.0:9000`。
5. 打开公网访问并创建函数 URL。授权类型选“开放”，数据接口仍会由 `JOBTRAIL_SYNC_TOKEN` 二次鉴权。
6. CORS 只允许 `https://zhfang28-code.github.io`，方法允许 `GET`、`OPTIONS`，请求头允许 `Authorization`、`Content-Type`。

腾讯云支持在控制台配置[环境变量](https://cloud.tencent.com/document/product/583/30228)，可通过[函数 URL](https://cloud.tencent.com/document/product/583/100227)提供 HTTPS 地址。不要把任何真实环境变量提交到仓库。

## 3. 配置环境变量

| 变量 | 说明 |
| --- | --- |
| `FEISHU_APP_ID` | 飞书自建应用 App ID |
| `FEISHU_APP_SECRET` | 飞书自建应用 App Secret，敏感 |
| `FEISHU_WIKI_TOKEN` | Wiki URL 中 `/wiki/` 后面的 token |
| `FEISHU_TABLE_ID` | URL 查询参数 `table` 的值 |
| `FEISHU_VIEW_ID` | URL 查询参数 `view` 的值，可留空 |
| `JOBTRAIL_SYNC_TOKEN` | 自己生成的 32 字节以上随机访问密钥，敏感 |
| `ALLOWED_ORIGIN` | `https://zhfang28-code.github.io` |

如果已经知道多维表格的 `app_token`，可以设置 `FEISHU_APP_TOKEN`，此时 `FEISHU_WIKI_TOKEN` 不再需要。

表格列名与默认值不一致时，可设置：

| 变量 | 默认列名 |
| --- | --- |
| `FEISHU_FIELD_COMPANY` | `投递公司` |
| `FEISHU_FIELD_TARGET` | `链接/邮箱` |
| `FEISHU_FIELD_APPLIED_AT` | `投递时间` |
| `FEISHU_FIELD_POSITION` | `岗位` |
| `FEISHU_FIELD_PROGRESS` | `目前的进度` |

在 PowerShell 中可生成随机同步访问密钥：

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

## 4. 连接 JobTrail

1. 打开 JobTrail，点击右上角的同步设置按钮。
2. “同步服务地址”填写腾讯云函数 URL；“同步访问密钥”填写与 `JOBTRAIL_SYNC_TOKEN` 完全相同的值。
3. 保持“打开页面时自动同步”勾选，点击“保存并同步”。

同步访问密钥仅保存在当前浏览器的 `localStorage`，不会进入 JobTrail JSON / CSV 导出，也不会提交到 GitHub。每台新电脑首次使用时需要配置一次。

## 同步规则

- 以飞书 `record_id` 去重；反复同步不会产生重复投递。
- 飞书只覆盖公司、链接 / 邮箱、投递时间、岗位和目前进度。
- JobTrail 本地的城市、薪资、标签、备注和跟进日期会保留。
- 飞书中暂时缺失的记录不会自动从 JobTrail 删除，避免误删。
- 页面打开时自动同步；页面关闭期间不会后台运行。
