# 实施清单与验收状态

更新：2026-09-17。第三轮（剩余缺口）：TOTP/MFA（员工强制）、httpOnly cookie 会话、发布风控（敏感词/诈骗/重复/价格异常）、举报去重、Postgres 限流存储、社区进阶（投票/采纳/编辑历史/版主工具/禁言/慢速）、私信安全（陌生人请求/拉黑/撤回/证件遮盖/外链提示）、通知偏好与营销退订、保存搜索与活动提醒 worker、定时发布/修订/撤回 CMS、商家多门店/成员/线索收件箱/CSV、订阅/招聘套餐/原生广告/发票、搜索城市别名召回、SEO（sitemap/JSON-LD/hreflang/notFound）、公开用户主页、年龄门槛、电话脱敏查看、App MFA、可选 OpenTelemetry 与 `/health/metrics`。

第二轮（Inc 2 遗留 + P0 缺口）：listing 审核队列（普通会员进 `pending_review`，可信角色直通）、申诉复核（原处理人回避）、收藏/关注/保存搜索、会话管理与账号注销/数据导出、隐私政策/用户协议页、头像与 onboarding、商家目录（收录/认领/评价）、活动（RSVP/候补/.ics）、搜索覆盖商家与活动。区分代码交付、本地验收和外部上线条件，不能把缺少账号或未执行的验证算作完成。

## 逐项结果（第三轮新增）

| 能力           | 已交付                                                                                                                                                                                      | 验证 / 外部条件                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| MFA / TOTP     | `POST /auth/mfa/setup                                                                                                                                                                       | enable                                                                    | disable | complete`；标准 TOTP（±1 step）；员工角色登录返回 `mfaRequired`+一次性 ticket，`mfaSetupRequired` 标记强引导；员工不可自行关闭；Web/App 登录均处理挑战 | 集成测试覆盖设置、错误码、挑战完成、员工禁关；passkey/WebAuthn 未实现 |
| Cookie 会话    | httpOnly `aucn_at`/`aucn_rt`（Secure、SameSite=Lax）；refresh/logout 读写 cookie，守卫同时接受 Bearer；Web 全部走 `credentials: 'include'`，App 仍用 Bearer+SecureStore                     | 浏览器 e2e 登录流程通过；跨站写操作目前依赖 SameSite=Lax，未加 CSRF token |
| 发布风控       | `risk.ts`：敏感词（app_config 可覆盖）、诈骗模式（先转账/站外联系/礼品卡/免费噱头）、7 天重复标题、价格异常；命中即强制 `pending_review` 并记录 `riskFlags`；房源/招聘对 <18 岁账号拒绝发布 | 集成测试覆盖命中关键词进审核；图片病毒/NSFW 扫描未实现                    |
| 举报去重       | 同一登录用户对同一对象 24h 内重复举报返回 409 并带原受理号                                                                                                                                  | 集成测试覆盖                                                              |
| 分布式限流     | `PrismaThrottleStorage` 把 throttler 桶落库（`throttle_buckets`），多实例共享；`THROTTLER_DISABLED` 仅测试逃逸                                                                              | 系统测试在共享服务器下通过                                                |
| 社区进阶       | 投票帖（选项/多选/截止）、采纳答案、帖子/评论编辑留 ContentRevision、置顶/锁定/移动/合并/慢速、按用户禁言；匿名作者返回本地化匿名名                                                         | 集成测试覆盖投票、采纳、修订历史、锁定拒评、置顶                          |
| CMS 扩展       | 文章 `publishAt` 定时发布（worker 到点上线）、`retract` 撤回、ContentRevision 修订历史、`topic` 专题字段                                                                                    | 定时发布由 NotificationsWorker 每小时执行；双人审批未实现                 |
| 私信安全       | 陌生人会话 `requested` 状态需对方 `respond` 接受（发起方限 3 条）、拉黑/解除/列表、10 分钟内撤回、TFN/银行卡/ABN 自动遮盖、外链标记                                                         | 集成测试覆盖请求-接受、遮盖、撤回、拉黑后拒发                             |
| 通知偏好       | `PUT /me/notification-prefs`（分类×渠道）、`POST /me/consents` 同意记录、营销退订时间戳；`notify()` 统一做偏好过滤；保存搜索按 cadence 投递、活动开始前 24h 提醒、outbox 派发               | 通知仍只站内投递，无 Push/Email/SMS 通道                                  |
| 商家扩展       | `BusinessLocation` 多门店、`BusinessMember` 角色（owner/manager/staff）、`BusinessLead` 线索收件箱与状态、`leads.csv`（需 business_pro 订阅或员工）、`Offer` 优惠发布                       | 集成测试覆盖线索提交、收件箱权限隔离；CSV 订阅门未做端到端 Stripe 联调    |
| 商业化         | `Subscription`（business_pro/member_plus/job_pack，含 credits）、`AdCampaign`（预算/CPC 点击计费，渲染不计费）、`Invoice`（付款自动开票 INV-YYYYMM-序号）、webhook 按支付 kind 分发         | 集成测试覆盖广告 serve/点击计费；Stripe 真实订阅联调仍缺密钥              |
| 搜索与 SEO     | 搜索向量并入城市名/suburb，查询别名/拼音扩展；筛选 UI（价格/房型/排序）；`sitemap.xml`+`robots.txt`、per-page metadata、JSON-LD、hreflang alternates、详情页 notFound                       | 构建产出 sitemap/robots；拼音覆盖有限别名表，非完整拼音库                 |
| 合规与公开主页 | `/users/[id]` 公开主页（帖子/在架信息）、`birthYear` 年龄门槛、`/listings/:id/phone` 登录后查看且审计记录、举报对象含 business/event                                                        | e2e 覆盖主流程；年龄门槛依赖用户自报出生年                                |
| App / 可观测性 | App 登录处理 MFA 挑战；API `telemetry.ts` 在 `OTEL_ENABLED=true` 时启动 NodeSDK+OTLP；`GET /health/metrics` 输出队列/积压/内存指标                                                          | OTel 依赖已安装但默认关闭，未连真实 collector                             |

## 逐项结果（第二轮新增）

## 逐项结果（第二轮新增）

| 能力                | 已交付                                                                                                                                                                 | 验证 / 外部条件                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 信息审核队列        | 会员发布进 `pending_review`；`/admin/listings` 队列与通过/拒绝（拒绝必填原因）；审核中锁定编辑、房主不能自审；拒绝可编辑→草稿→重新提交                                 | 集成测试覆盖直通拒绝、自审拒绝、审核通过后上线、拒绝→修改→重投                                                |
| 申诉                | `POST /appeals` 仅作者可对 removed/rejected/hidden 内容申诉；`GET /appeals/mine`；管理端裁决 upheld/overturned，原处理人不得裁决                                       | 集成测试覆盖重复申诉 409、原审核人 403、第二审核人撤销并恢复内容                                              |
| 收藏/关注/搜索      | `/me/favorites`（listing/post/article/business/event）、`/me/follows`（user/board/business）、`/me/saved-searches`；详情页收藏按钮                                     | 集成测试覆盖幂等、隐私隔离；保存搜索的提醒投递（按 cadence 发通知）尚未实现投递 worker                        |
| 会话与账号          | `GET /me/sessions` 设备列表、`DELETE /me/sessions/:id` 远程下线（当前设备用 logout）；`POST/DELETE /me/deletion` 7 天冷静期 + worker 匿名化；`GET /me/export` 数据导出 | 集成测试覆盖远程下线、导出不含哈希密钥、冷静期可取消；删除 worker 每小时扫描                                  |
| 合规页与 onboarding | `/zh                                                                                                                                                                   | en/privacy`、`/terms`；头像上传（512px WebP、公开可读）；新用户登录跳 `/onboarding`（语言/城市/兴趣，可跳过） | 页面在 e2e 冒烟覆盖内；头像本地验证 |
| 商家目录            | `Business` 模型；`GET /businesses` 列表/详情、创建收录、认领申请 + 管理端审批、`/reviews` 评价（每人一条）与店主回复                                                   | 集成测试覆盖收录、唯一评价、认领审批后 owner 可回复                                                           |
| 活动                | `Event` 模型；列表/详情、创建、名额满转候补、取消报名自动转正、`GET /events/:id/ics` 日历导出、取消活动通知报名者                                                      | 集成测试覆盖 RSVP 幂等、候补、转正通知、ICS；付费活动只展示外链购票，不经平台收款                             |

## 逐项结果

| 能力         | 已交付                                                                                                                                                       | 验证 / 外部条件                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 第三方登录   | Google / Apple / 微信网站授权码回调；浏览器绑定、state、nonce、Google PKCE、Google/Apple ID token 签名验证；未配置入口隐藏；Twilio 手机验证码；SMTP 邮件发送 | 本地验证未配置与错误 state 拒绝。用户目前没有这些平台账号，未完成真实供应商联调；Apple client-secret JWT 需定期轮换。App 当前使用邮箱登录                                       |
| 图片上传     | Web/App 相册上传；JPEG/PNG/WebP 验证、8MB/25MP 上限、重编码 WebP、清除元数据、每条信息最多 8 张；本地持久化或私有 S3；所有权验证、私有信息图片访问控制、删除 | 本地 API 已验证，S3 未配置、未联调。Web 在“我的 → 编辑及图片”上传                                                                                                               |
| 私信与通知   | 从分类信息联系发布者；会话去重、双方权限隔离、分页消息、未读数、已读操作、站内通知；Web 前台每 10 秒检查新消息，App 会话刷新                                 | 本地数据库和浏览器验证。当前是站内通知，不包含 APNs/FCM 或后台推送；这些仍需平台配置及后续实现                                                                                  |
| 举报审核     | Web `/zh/admin`、`/en/admin`；按状态分页、查看被举报内容、分流/驳回/处置；移除内容或封禁普通账号；乐观并发控制、审计日志和举报人通知                         | 本地权限、处置、重复操作验证。仅 moderator/admin/super_admin 可审核                                                                                                             |
| 分类信息编辑 | 四种分类完整替换 API，复用 Web 发布表单；可编辑已支持的表单字段，保留未展示的明细字段；版本冲突返回 409；不可编辑已移除/归档/完成信息                        | 本地 API、浏览器编辑与状态管理验证                                                                                                                                              |
| 个人中心分页 | Web“加载更多”；App 列表分页；直接管理完成、暂停、恢复、续期、归档                                                                                            | 本地数据库多页验证                                                                                                                                                              |
| CMS          | Web 草稿/发布/隐藏、标题/摘要/正文/分类/语言/来源/slug 编辑；slug 冲突、版本冲突；修订前内容留在审计记录                                                     | API 和浏览器验证。editor/admin/super_admin 可用；不包含富文本、定时发布及可视化版本恢复                                                                                         |
| 支付         | Web 7 天分类信息高亮商品（明确“推广”标记）；Stripe Checkout、订单列表、签名 webhook、金额/币种校验、幂等履约、全额退款接口及管理员表单、退款撤销权益         | 已用本地签名事件验证付款、重复通知、金额不匹配与退款。用户有 Stripe 账号，但本地密钥与商品 Price ID 为空，未完成 Stripe 测试环境真实 Checkout 联调；数字权益不在原生 App 内销售 |
| App          | Expo 57 / React Native 0.86 原生 iOS/Android：双语、城市分类浏览、搜索、资讯、社区发帖评论、邮箱登录、SecureStore、发布编辑、我的信息、私信、相册上传、举报  | 两平台 JS/Hermes 包成功导出，类型与 lint 通过；没有可用模拟器/真机及签名账号，未完成原生安装、真机体验、上架；并非全部 Web 功能已移植                                           |
| 生产验证     | 独立数据库迁移与真实 HTTP 测试、Playwright、自动启动/清理验收脚本、Dockerfile、生产 Compose、角色授权 CLI、部署与回滚说明                                    | 本地 25 项单元测试、11 项数据库集成测试、4 项浏览器测试通过；Linux 镜像构建和容器 API/Web 启动验证通过。无生产主机/域名配置，未部署；TLS、备份恢复、负载、渗透测试仍需执行      |

## 本地验收

最终结果：27 项单元测试（domain 7 + api 20）+ 23 项真实数据库集成测试 + 4 项 Playwright 流程全部通过；格式、Lint、类型检查、Web/API 构建及 iOS/Android bundle 导出通过。另已构建 `aucnhub-api:local` Linux 镜像并在容器内验证 API 健康检查、Web 登录页及生产环境未配置邮件时拒绝发送。

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`：领域与 API 单元测试；Web UI 由单独的 Playwright 命令覆盖。
- `pnpm build`：API/Web 构建及 App iOS/Android JS bundle 导出，不等于签名安装包。
- `TEST_DATABASE_URL=postgresql://.../aucnhub_test?schema=public pnpm test:system`：自动迁移、启动独立 API/Web、执行集成与浏览器测试、关闭本次测试进程；要求 4100/3100 空闲。

测试夹具只允许名称以 `_test` 结尾的数据库。测试通过公开登录 API 验证固定测试验证码，验证码夹具只在测试数据库内建立；没有新增测试登录后门接口。

截图由 Playwright 输出到 `apps/web/test-results/`，报告在 `apps/web/playwright-report/`。这些输出不提交仓库。

## 原有到期闭环

API 启动和每分钟清理过期信息，避免重叠执行并记录重试错误；过期转换递增版本。即使清理尚未运行，也按实际到期时间提供续期入口；已完成/移除信息不会自动复活。个人中心管理非公开信息，不再跳进公开详情 404。

## 进入真实上线前仍需完成

1. Stripe：填入测试密钥、webhook signing secret 和 AUD 商品 Price ID（置顶/订阅/招聘套餐），完成真实 Checkout/退款联调后再切生产。
2. 注册 Google/Apple/微信开发者账号、邮件/短信服务；配置回调、发件域名与短信验证服务并逐项联调。
3. 确定生产主机和域名，构建并部署镜像、配置 TLS、备份并实测恢复。
4. App 安装及真机测试、应用标识确认、商店签名、隐私与上架资料；推送与原生第三方登录需要继续接入。
5. 生产密钥配置：WebAuthn `WEBAUTHN_RP_ID/RP_NAME` + 可信 origin、Web Push `VAPID_*`（及 `NEXT_PUBLIC_VAPID_KEY`）、Twilio `TWILIO_FROM_NUMBER`（通知短信通道）、可选 `IMAGE_SCAN_URL/BLOCKLIST` 外部图片扫描。PostGIS 地理索引（当前为 haversine 全表扫描）为已知后续项。
6. 生产 OpenTelemetry collector 与告警通道（`OTEL_ENABLED=true` + `OTEL_EXPORTER_OTLP_ENDPOINT` 即可导出 trace）。

## 第四轮硬化（已完成）

- **CSRF 双提交**：cookie 会话的写操作必须携带 `x-csrf-token`（与可读 `aucn_csrf` cookie 一致），Bearer 客户端豁免；Web `api()` 自动附加。
- **Passkey/WebAuthn**：`@simplewebauthn/server` v13，5 分钟签名票据承载挑战；`/auth/passkey/register|login` 流程、凭据列表/删除；Web 端注册/登录按钮（`@simplewebauthn/browser`）。
- **员工 MFA 强制**：`StaffMfaGuard` 作用于整个 AdminController——staff 角色未启用 TOTP 一律 403；登录流程先完成 TOTP 才发令牌。
- **通知通道**：分类偏好按 inapp/push/email/sms 投递；Resend/SMTP 邮件、Twilio Messages 短信、web-push VAPID 推送，失效订阅自动清理；`POST/DELETE /me/push-subscriptions`。
- **CMS 双人审批**：`app_config.cms.dualApproval` 开启后，`POST /admin/articles/:id/approve` 需第二编辑签字（作者不可自批），编辑后重置签字。
- **图片扫描钩子**：`common/image-scan.ts`（sha256 黑名单 + 外部扫描器 URL），命中标记 `flaggedAt/flagReason` 并对非属主隔离；测试逃逸 `IMAGE_SCAN_FORCE_VERDICT`（生产禁用）。
- **附近排序**：`GET /listings?sort=near&lat&lng` haversine 距离排序 + `(distance,id)` keyset 分页。
- **邮件回退**：`common/mail.ts` 统一 SMTP/Resend/无配置安全失败。

配置、操作和验证方法见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 第五轮（地图 / 签到 / 移动端深化 / 无障碍）

- **地图展示**：`components/map-embed.tsx` 在 listing、商家、活动详情页按坐标渲染嵌入式地图（OpenStreetMap iframe + 外链，无 API key 依赖）；无坐标时不渲染。
- **活动签到 UI**：参加者详情页展示签到码；组织者专用验票表单提交 `POST /events/:id/checkin`，显示签到成功/失败状态。
- **移动端深化**：详情页编辑入口与图片上传、收藏开关（listing/business/event）、商家目录与详情（门店/优惠/线索表单）、活动详情（RSVP/候补/取消/签到码/组织者验票）、举报入口；`mobile.spec.ts` 合约测试保证 App.tsx 引用的每条文案 key 在 zh/en 目录均存在（46 项断言）。
- **无障碍（W-11）**：新增 `e2e/a11y.spec.ts`，axe-core 对 6 个公开页面做 WCAG 2.1 A/AA 扫描并纳入系统测试。首轮扫描发现并修复全部 serious 对比度违规：`--color-coral` #e36a52→#b54534（白字 5.43:1）、`--color-brand` #087f8c→#077884（red-50 上 4.76:1）、`--color-muted` #657789→#55677a、新增 `--color-coral-dark` 供浅底文字、gray-400→gray-500。
- **测试矩阵更新**：单元 20（API）+ 领域测试 + mobile 46 项文案合约 + **集成 27 + Playwright 10（4 流程 + 6 a11y）全部通过**。

仍未覆盖：Weekend 模块无自动化测试（独立附加功能）；App 无模拟器/真机验证；原生 passkey 与 APNs/FCM 推送需原生模块与平台账号，当前 App 侧未接。

## 第六轮（Pulse 内容管道）

- **通用采集器**：`FeedSource`/`FeedItem`/`PulseMetric`（迁移 `increment_5_pulse`）。复用 SSRF 防护 fetch（DNS 钉住、HTTPS、1MB 上限、不跟跳转）、租约调度与指数退避；env `PULSE_COLLECTOR_ENABLED` + `PULSE_SOURCES_JSON` 启动时 upsert 数据源。
- **结构化 adapter**：`frankfurter`（AUD/CNY 汇率）、`openmeteo`（天气+7 日预报）、`fuelcheck`（油价）→ 写入 `pulse_metrics`；`rss`/`json` 通用解析 → `feed_items`。
- **风控自动发布**：`screenText`（从 listing 风控提取的共用函数）扫标题+摘要；`autoPublish` 源过风控直接发布，命中进 pending 队列；指纹 URL 去重。
- **每日 digest**：悉尼时间 07:30 后自动生成 `daily-YYYY-MM-DD-{zh,en}` 已发布文章（汇率/天气/活动/昨日热帖/新增信息），系统自动建"AUCN 编辑部"作者账号。
- **API**：`GET /pulse/dashboard`（汇率/天气/油价/预警/近期活动/热帖/新增数）、`GET /pulse/feed`（分类+城市筛选分页）、管理端 sources 开关与 items 审核。
- **Weekend 多城市**：source/event 加 `cityId` 与 `category`（general/family/social/market/festival），weekendRange 按城市时区计算；浏览 API 支持 `city`/`category` 过滤。
- **Web**：首页"今日澳洲"仪表盘卡片（汇率/天气/油价/预警/活动）、`/pulse` 信息流页（分类 tab + 分页，署名+外链原文）、导航入口、管理后台"内容采集"分区（源启停 + 待审发布/拒绝）、weekend 页城市/类型筛选与分类徽标。
- **Mobile**：browse 页今日卡片（汇率/天气/预警/活动），复用 `pulse.*` 文案。
- **集成测试 +4**：dashboard、审核流（member 403/editor 200）、周末城市分类过滤、digest 幂等生成。

## 第七轮（纯中文内容策略）

- **受众决策**：平台面向中文用户，自动采集仅保留中文源；英文文本源（ABC/Guardian/OzBargain/Concrete Playground/SMH/The Age）全部移除。数值型 metric adapter（澳元汇率、天气）保留——无文本内容。
- **中文源**：新足迹（oursteps.com.au）按版块 RSS 接入——新闻汇总 fid43、澳洲时政 fid124、生活百科 fid1、老爸老妈 fid96、餐馆点评 fid131、聚会交友 fid119、社区动态 fid118、房屋租赁 fid95、房屋买卖 fid141、招工找工 fid42、二手市场 fid108、二手车 fid109、电子二手 fid113、免费广告 fid61。
- **新增 feed 类目**：`housing`/`job`/`market`/`service`；各分类信息版块页挂对应类目的自动情报块（共享 `AutoIntel` 组件）。
- **日报中文化**：早/午/晚三刊仅生成中文版（`daily-{date}-{edition}-zh`），不再产出英文版；存量英文 digest 与英文 feed 条目已在生产库清除。
- **标题去重**：`titleHash` 归一化标题去重，同一文章跨城市 feed 只保留一条（重复出现时 cityId 归并为全国）。
- **机翻通道保留**：`titleZh`/`summaryZh` 字段与 DeepL/MyMemory 翻译链路仍在（中文源下基本不触发），供将来接入非中文源时复用。
- **注意**：`oursteps-politics` 正确 fid 是 124（澳洲和世界时政）；fid=119 是聚会交友。配置时曾误用导致时政源采集社交帖，已在生产配置修正并归正条目归属。
- **实体解码**：RSS link/media 字段与标题摘要一样需要 `decodeEntities`（`common/entities.ts` 共享模块，避免 pulse↔weekend 循环依赖）；`&amp;` 未解码会导致所有原文链接 404。
- **信号提取（差异化）**：`common/extract.ts` 在入库时从帖子提取要价（`$650/周`、`时薪$35` 等 → `priceCents`+`pricePeriod`）与澳洲华人区地名（→`location`）。`GET /pulse/insights?category=` 聚合近 7 天中位价、环比与热门区域；AutoIntel 区块顶部显示统计条、条目带价格/位置徽标；日报含租金/薪酬中位数。采集内容是原材料，统计洞察是原创数据资产。

## 第八轮（纯中文界面与域名切换）

- **语言切换移除**：Web header 与移动端的中/英切换按钮删除；`routing.locales` 收敛为 `['zh']`，`messages/en.json` 删除，`switchLocale` 文案移除；`/en/*` 旧链接 301 到 `/zh/*`（middleware）。
- **SEO 纯中文**：sitemap 仅输出 `/zh` URL；hreflang 仅 `zh-CN`+`x-default`；robots.txt 去掉 `/en` 规则；`<html lang="zh-CN">`、OG `zh_CN`、JSON-LD `inLanguage: zh-CN` 固定；管理后台文章语言选项只留中文。
- **死分支清理**：`formatDate`/`formatDateTime`/`cityName`/`wmoText` 等去掉 locale 参数固定中文输出；各页面/组件 `zh ? … : …` 双语分支（约 70 处）全部折叠为中文；移动端 `Publish`/`label()` 不再接收 locale。
- **域名**：`aucn.info`（主站）+ `api.aucn.info`（API）上线，TLS 已签；`www` 301 到 apex；旧 `sundata.tech` 域名 DNS 已下线（nginx 留 301/308 兜底）；`CORS_ORIGINS`/`WEBAUTHN_RP_ID`/`NEXT_PUBLIC_SITE_URL`/`API_PUBLIC_URL` 全部切换。Passkey 因 RP_ID 变更需重新注册；移动端打包需设 `EXPO_PUBLIC_API_URL=https://api.aucn.info`。
- **站内详情页 + AI 导读**：`/pulse/[id]` 承接所有采集条目点击（AI 导读 `feed_items.brief`、价格/位置徽标、相关情报、原帖次要链接）；DeepSeek 经 Hive V3 OpenAI 兼容端点接入（`AI_BRIEF_*` env），每周日 18:00 生成租房/招工/二手行情周报发至 `/news`。
- **行情提醒**：各版块统计条内嵌订阅（关键词+上限价+频率），复用 saved_search worker 匹配 `filters.target='feed'` 的新条目并站内通知。
