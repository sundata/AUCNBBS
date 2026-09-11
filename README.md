# 澳中生活圈 / AUCN Hub

面向在澳华人的双语本地生活平台：资讯 + 社区 + 租房/招聘/二手/生活服务分类信息。
产品设计与任务书见 [DEVIN_PRODUCT_DESIGN.md](DEVIN_PRODUCT_DESIGN.md)，架构决定见 [docs/adr](docs/adr/README.md)。

## 结构

```
apps/api        NestJS 11 + Prisma 6 (PostgreSQL)   http://localhost:4000  (Swagger: /docs)
apps/web        Next.js 15 双语门户 (/zh, /en)       http://localhost:3000
packages/domain 领域枚举、zod schema、listing 状态机
infrastructure  docker-compose (PostgreSQL 16)
```

## 本地运行

```bash
pnpm install
cp .env.example .env
docker compose -f infrastructure/docker-compose.yml up -d
pnpm --filter @aucn/api prisma:migrate     # 应用迁移
pnpm --filter @aucn/api prisma:seed        # 确定性种子数据
pnpm dev
```

开发环境登录：在 `/zh/login` 输入邮箱，验证码打印在 API 日志中（`OTP_DELIVERY=log`）。

## 质量门

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```
