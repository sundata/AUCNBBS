# 每日图文自动传输

## 已实现的链路

生成任务产出 JSON 清单和本地封面文件 → `scripts/send-daily-note.mjs` → HTTPS 图文接收接口 → PostgreSQL 原子保存文字及 WebP 封面 → 编辑接收箱 → 网站每日图文栏目。

- 网站栏目：`/zh/daily`，默认墨尔本，也支持东京、双城内容；新闻页有入口。
- 接收箱：`/zh/admin/daily`；需要 editor/admin/super_admin 和现有后台双因素认证。
- 写入接口：`POST /api/v1/daily-notes/import`，只接受专用 Bearer 密钥。它不是管理员登录密钥，不能用来修改、删除已有稿件。
- multipart 两个字段：`payload`（JSON 文本）、`cover`（图片文件）。结构见 `examples/daily-note.json`，其中 `coverFile` 只用于发送脚本，不传到 API。
- 8 MB 上传上限、25 百万像素上限；只接受 JPEG/PNG/WebP，重新编码并清除元数据，封面压缩后不得超过 1 MB。
- 同一 deliveryId 和相同内容重试返回原稿件；不同内容使用同一 ID 返回 409，绝不覆盖编辑审核结果。使用稳定 ID，例如 `melbourne-2026-09-20-passport`。
- 正文用纯文本分段，来源链接放在 sources，不放 ChatGPT 的内部引用标记。
- 图片与文章在一次数据库事务中保存，没有第三方临时图片链接过期问题。数据库备份包含封面，每篇最多增加约 1 MB。
- AI 图标注为示意图。图文在草稿/下架状态时不能通过公开接口读取。

## 本地与 VM 配置

1. 用密码管理器或 `openssl rand -hex 32` 生成专用密钥，分别写入 API 环境与发送任务的秘密配置；不要在聊天或任务提示词里粘贴。
2. API 设置 `DAILY_NOTES_INGEST_KEY`，初始 `DAILY_NOTES_AUTO_PUBLISH=false`。
3. 应用迁移：`pnpm --filter @aucn/api prisma:migrate:deploy`，重新构建并启动 API/Web。VM 使用现有生产 Compose 流程，env_file 会带入这两个变量。
4. 发送端 `.env.delivery`（不要提交 Git）配置 `DAILY_NOTES_API_URL=https://你的API域名` 和同一个密钥。将该文件权限设为 600。
5. 生成任务将正文和图片保存在同一个运行环境后执行：

```bash
node --env-file=.env.delivery scripts/send-daily-note.mjs /path/to/manifest.json
```

脚本自动重试网络错误、429、5xx，总共最多三次，最多每次 30 秒。其他 4xx 必须修正配置或清单。只有收到 JSON 回执才算传输完成；回执包含 id、status、duplicate。

首次在后台预览后发布，访问 `/zh/daily/<回执id>` 检查。要每天自动上站，在 API 设置 `DAILY_NOTES_AUTO_PUBLISH=true` 并重启；仅影响后续新稿件，不会发布以前的草稿。编辑仍可下架。

Nginx 为此接口配置至少 `client_max_body_size 10m`。生产发送端必须用 HTTPS，不跟随重定向，防止密钥被转发。不要把密钥放进 `NEXT_PUBLIC_*`、Git 或命令行参数中。轮换时同步更新 API 与发送端的环境配置。

## 对现有“墨尔本华人每日笔记”的接法和当前限制

已通过任务读取工具找到该云端会话和近期文字内容，但该读取结果没有图片附件。读取会话摘要不是稳定的内容输出 API，也不等于可以从 Google Cloud VM 拉取完整图文。

因此，**接收端和发送脚本可独立运行，但现有云端定时任务尚未完成端到端绑定**。必须在该任务的实际运行环境验证以下条件：

- 能输出一个可读取的实际封面文件，而非只描述封面或给出临时内部链接；
- 能执行 Node 22+ 脚本（或等效的 multipart HTTP 调用）；
- 能通过秘密配置读取专用密钥，允许向 API 域名发 POST 请求；
- 网站已部署并可从公网 HTTPS 访问。

这些条件满足时，把下方步骤追加到原任务提示词；保留现有查证、选题、图片风格和运行时间。无需重复新建定时任务。

> 完成本次图文后，再为网站输出一份纯文本正文和实际封面文件。按 docs/examples/daily-note.json 的结构生成 manifest.json，city 使用 melbourne，edition 使用本次墨尔本当地日期，deliveryId 使用稳定的城市、日期和选题标识。sources 填写实际查证的完整 HTTPS 来源链接；封面为生成图时 imageKind 使用 generated。把 coverFile 指向本次实际生成的图片文件。只读取运行环境中的 DAILY_NOTES_API_URL 和 DAILY_NOTES_INGEST_KEY，不向用户显示密钥。执行 scripts/send-daily-note.mjs 发送。只有收到有效回执才报告成功，并报告稿件 ID 和 draft/published 状态。失败时保留文件，报告原因，不编造上传成功，不更换 deliveryId 来绕过去重。

如果云端任务不能满足上述条件，需要将“内容生成 + 文件输出 + 上传”迁到具有这些能力的任务运行环境，再设置原定时间。**仅在 VM 上运行上传脚本不会自动获取现有云端任务的图片，也不会生成新闻。** 本次没有修改现有云端定时任务，没有部署 VM，也没有安排重复任务。
