# ADR-003 搜索：PostgreSQL 全文起步

- 状态：Accepted（2026-09-02）

## 决定

Increment 0 使用 PostgreSQL `tsvector`（simple 词典）+ `pg_trgm` 提供中英文混合模糊搜索，
通过 `SearchProvider` 接口封装；Phase 1 用 OpenSearch 实现同一接口并由 outbox 事件驱动索引。

## 理由

首发流量（100k MAU）不需要独立搜索集群；接口隔离保证搜索故障不影响发布/私信。

## 代价

中文分词质量有限（trigram 近似）；拼音、同义词、聚合筛选延后。
