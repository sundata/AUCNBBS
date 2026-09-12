# 运行、配置与部署

## 本地 Web/API

```bash
pnpm install
cp .env.example .env  # 仅首次运行；不要覆盖已有配置
# PostgreSQL
docker compose -f infrastructure/docker-compose.yml up -d
pnpm --filter @aucn/api prisma:migrate:deploy
pnpm --filter @aucn/api prisma:seed  # 仅新建的开发数据库；seed 会重建示例内容
pnpm --filter @aucn/domain build
pnpm --filter @aucn/api dev
# 另一终端
pnpm --filter @aucn/web dev
```

Web 默认 3000，API 默认 4000；Swagger 位于 `/api/docs`，健康检查 `/api/v1/health`。新迁移只增加表和字段，不清空现有用户内容。

登录后访问“我的 → 编辑及图片”“消息中心”；编辑/审核角色登录后显示“管理后台”。首次授权已有邮箱账号：

```bash
pnpm --filter @aucn/api admin:grant editor@example.com editor
pnpm --filter @aucn/api admin:grant moderator@example.com moderator
```

命令仅支持已有活跃邮箱身份，并写入审计记录；默认不创建管理员，也不提供公共角色提权 API。

## 外部服务

全部凭据只填写本地环境文件或部署平台 secret，不提交仓库。

| 服务     | 环境变量                                                                  | 接入说明                                                                                             |
| -------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 邮件     | `OTP_DELIVERY=smtp`, `SMTP_URL`, `SMTP_FROM`                              | SMTP 失败返回 503；`log` 只可用于非生产，生产不打印验证码                                            |
| 手机     | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`    | Twilio Verify，E.164 号码；未配置不显示手机入口                                                      |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                | 回调为 `API_PUBLIC_URL/api/v1/auth/oauth/google/callback`                                            |
| Apple    | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`                                  | Apple 签名 client-secret JWT；回调 `/api/v1/auth/oauth/apple/callback`，支持 form_post；轮换过期 JWT |
| 微信     | `WECHAT_WEB_APP_ID`, `WECHAT_WEB_APP_SECRET`                              | 网站扫码授权回调 `/api/v1/auth/oauth/wechat/callback`；需审核通过的网站应用                          |
| S3       | `S3_BUCKET`, `S3_REGION`，运行环境 AWS IAM 凭据                           | Bucket 保持私有。仅需对象读写删除权限。原图由 API 限流接收并重编码后保存，未使用未经处理的公开直传   |
| 本地图片 | `MEDIA_LOCAL_DIR`                                                         | 未配置 S3 时使用；生产挂载持久卷。不要在已有数据后直接切存储模式，应先迁移全部对象                   |
| Stripe   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PROMOTION_PRICE_ID` | Price 必须是启用的 AUD 单次价格；商品为 7 天高亮展示，定价由 Stripe 后台配置                         |

共同配置 `API_PUBLIC_URL`、`WEB_ORIGIN`、`CORS_ORIGINS`。第三方授权只绑定 provider + app ID + subject，不按相同邮箱静默合并账号。

### Stripe 联调

使用测试账号/测试密钥和测试模式 Price。启动 Stripe CLI（需先登录自己的 Stripe 账号）：

```bash
stripe listen --forward-to localhost:4000/api/v1/billing/webhook
```

把 CLI 输出的 signing secret 放入 `STRIPE_WEBHOOK_SECRET` 后重启 API。在 `/zh/billing` 选择有效信息并付款，再检查订单与卡片“推广”标记；取消付款不会产生权益。测试全额退款后确认订单变成 refunded、权益扣除。

生产 webhook 订阅 `checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.expired`、`charge.refunded`。签名验证依赖原始请求体；代理不能重写 JSON。重复事件按 Stripe event ID 去重，订单状态转换防止重复履约。原生 App 不包含该数字权益付款入口。

实现参考：[Stripe webhook](https://docs.stripe.com/webhooks)、[履约](https://docs.stripe.com/checkout/fulfillment)、[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)、[Twilio Verify](https://www.twilio.com/docs/verify/api)。供应商实际账号验收尚未执行。

## 原生 App

```bash
# 把设备可达的 API 地址写入 apps/mobile/.env（模拟器可用 localhost，真机用局域网 IP 或 HTTPS 域名）
# EXPO_PUBLIC_API_URL=https://api.example.com
pnpm --filter @aucn/mobile dev
pnpm --filter @aucn/mobile build
```

`build` 导出 iOS 和 Android Hermes JS bundle。生成安装包需要 Xcode/Android SDK 或 EAS 及签名凭据；配置 `apps/mobile/app.json` 中正式应用标识后，由项目持有人完成 EAS 项目关联与商店签名。本次没有签名安装包或商店提交。

[Expo 57 版本矩阵](https://docs.expo.dev/versions/v57.0.0/)：本项目使用脚手架配套的 React Native 0.86 / React 19.2.3，移动工程独立使用 TypeScript 6，Web/API 保持原有 TypeScript 5。

## 自动验收

先准备独立 `aucnhub_test` 数据库，安装 Chromium：

```bash
pnpm --filter @aucn/web exec playwright install chromium
TEST_DATABASE_URL=postgresql://aucn:aucn@localhost:5432/aucnhub_test?schema=public pnpm test:system
```

脚本不使用生产 Stripe 凭据，以本地测试密钥生成签名事件。测试数据库夹具会清理自己的记录，图片保存到测试专用目录。端口占用时脚本退出，不会杀掉用户正在运行的服务。

## 生产容器（镜像及本地启动已验证）

1. 将 `.env.example` 复制成 `.env.production`，填入正式配置、强随机 `JWT_ACCESS_SECRET`、`POSTGRES_PASSWORD` 和外部服务凭据；不要沿用示例值。
2. 构建镜像、先启动数据库并执行迁移，再启动 API/Web：

```bash
docker compose --env-file .env.production -f infrastructure/compose.production.yml build
docker compose --env-file .env.production -f infrastructure/compose.production.yml up -d postgres
docker compose --env-file .env.production -f infrastructure/compose.production.yml run --rm --no-deps api pnpm prisma:migrate:deploy
docker compose --env-file .env.production -f infrastructure/compose.production.yml up -d
```

Compose 的 API/Web 只绑定主机 loopback。使用主机反向代理为 Web/API 配置 HTTPS，转发 3000/4000；代理限制请求大小至少允许 8MB 图片。`NEXT_PUBLIC_API_URL` 为镜像构建参数，域名改变后必须重新构建 Web。

数据库及图片分别持久化到卷。发布前导出 `pg_dump` 和图片卷备份，并在独立环境实测恢复。当前迁移向后兼容：应用回滚可使用旧镜像、保留新增表；不要直接删除有数据的新表。业务开始使用消息/支付数据后，数据库恢复必须与对象存储及支付事件核对。

本次已构建 Linux 镜像，并在容器中启动 API/Web 验证健康检查、登录页和生产邮件配置保护。未获生产主机/域名，未实际部署；反向代理、TLS、备份恢复、负载和安全测试不能视为通过。
