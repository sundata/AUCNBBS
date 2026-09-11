# ADR-005 统一 listing 引擎 + intent

- 状态：Accepted（2026-09-02）

## 决定

`listings` 主表承载所有分类信息公共字段（类型、意图、状态、标题、正文、城市、价格、到期），
`housing_details / job_details / item_details / service_details` 按类型 1:1 扩展。
`intent = offer | wanted` 表达出租/求租、招聘/求职、出售/求购、提供服务/求助。

状态机（`packages/domain`）：
`draft → pending_review → active → reserved|paused → completed|expired → archived`，
`pending_review → rejected`，`active → removed`。Increment 0 无审核队列时 `publish` 直接 `draft → active`，
但迁移路径保持不变以便开启审核。
