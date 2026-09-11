# ADR-001 模块化单体 + pnpm monorepo

- 状态：Accepted（2026-09-02）

## 背景

设计书 §10 要求 Web/App/Admin 共用 API、领域模型与设计语言，首发领域多但团队规模未知。

## 决定

- 单仓库 pnpm workspace + Turborepo：`apps/api`（NestJS）、`apps/web`（Next.js）、`packages/domain`（纯领域）。
- API 内部按领域模块划分（identity、regions、community、listings、content、search、feed、reports），模块之间只通过 service 调用，不直接读写彼此的表。
- 所有前端只经 HTTP API 访问数据。

## 后果

- 单进程部署、事务一致性简单；后续出现独立扩缩容证据时再拆 Messaging/Search/Media。
- Web SSR 需要 `API_INTERNAL_URL` 访问 API。
