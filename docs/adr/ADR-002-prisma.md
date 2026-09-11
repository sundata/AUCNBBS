# ADR-002 数据访问层选 Prisma（否决 Drizzle）

- 状态：Accepted（2026-09-02）

## 决定

使用 Prisma 6 作为唯一 ORM。schema 文件即数据字典；`prisma migrate` 生成版本化迁移；`prisma db seed` 提供确定性 seed。

## 理由

- 迁移工具链和类型生成成熟，Nest 集成简单。
- 复杂 PostGIS/报表查询通过 `$queryRaw` 参数化 SQL 完成，不引入第二套 ORM。

## 代价

- 生成 client 需要 `prisma generate` 步骤（已放入 `postinstall` 和 CI）。
- 全文搜索列（tsvector）由迁移 SQL 手写维护。
