# ADR-004 身份提供方抽象与 email OTP 先行

- 状态：Accepted（2026-09-02）

## 决定

- `users` 是唯一内部身份；第三方登录一律落到 `identities(provider, provider_app_id, provider_subject)`，数据库唯一约束先建。
- Increment 0 只实现 `email_otp`：验证码哈希存储、10 分钟有效、5 次尝试、防枚举（请求接口总是返回 200）。
- 会话：平台自有短时 access JWT + 可轮换 refresh token（哈希存 `sessions`）。
- 微信/Apple/Google 各自实现 `IdentityProvider`，在开放平台审核完成前不暴露入口。
