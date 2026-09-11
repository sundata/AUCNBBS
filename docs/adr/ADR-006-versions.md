# ADR-006 依赖版本策略

- 状态：Accepted（2026-09-02）

Node 22 LTS、TypeScript 5.x、Next.js 15、React 19、NestJS 11、Prisma 6、Tailwind 4、zod 3、next-intl 4。
只使用实现时的稳定主版本，不使用 RC/canary；使用 `^` 范围并由 lockfile 锁定，依赖自动更新走 PR。
