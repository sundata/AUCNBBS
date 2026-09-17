# 最低成本 Google Cloud 部署方案（AUCN Hub）

本文档用于在 Google Cloud 上以最低成本方式部署 AUCN Hub，并保持与项目现有生产结构一致。

目标：

- 1 台低成本 Linux VM
- PostgreSQL 安装在 VM 内部，不额外付 Cloud SQL 费用
- Docker + Docker Compose 运行 API 和 Web
- Nginx 负责 HTTPS + 反向代理
- 使用 .env.production 维护生产环境变量

适用范围：

- 低流量起步项目
- 预算有限的生产环境
- 项目已具备本地验证和 Docker 生产 Compose 配置

---

## 1. 机器配置建议与成本选型

在 1 台 VM 上同时运行 PostgreSQL + Nginx + Web（前端） + API（后端），核心瓶颈通常是内存（RAM）。

### 推荐配置

| 规格类型   | 机型 / 规格                         | 预估月费（us-central1）             | 适用场景                             | 评估                                                                    |
| ---------- | ----------------------------------- | ----------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| 极致省钱型 | e2-micro（2 vCPU, 1 GB RAM）        | 约 $0 ~ $7 / 月（受免费层额度影响） | 轻量 Node.js / Go / Python 微服务    | 仅适合轻量负载，若前端有 SSR（如 Next.js）极易在构建/运行高峰期触发 OOM |
| 推荐起步型 | e2-small（2 vCPU, 2 GB RAM）        | 约 $14 ~ $16 / 月                   | 最稳妥的低成本底线                   | 搭配 2GB Swap，可从容运行 Postgres、API、Web 服务与 Nginx               |
| 磁盘       | 20 ~ 30 GB Balanced Persistent Disk | 约 $2 ~ $3 / 月                     | 性能与成本平衡                       | 高于标准磁盘，远低于 SSD 的高性能盘                                     |
| 操作系统   | Ubuntu 22.04 LTS                    | 免费                                | Docker + Nginx + Postgres 兼容性最佳 | 社区支持完善，适合长期维护                                              |

> 关键操作提示：
>
> 1. 保留静态外部 IP：在 GCE 分配 External IP 时设为 Static，防止实例重启后 IP 变动导致域名解析失效。
> 2. GCE 防火墙规则：仅对外开放 tcp:80、tcp:443。SSH（tcp:22）建议只开放给自己的公网 IP 或通过 GCP Cloud Shell / IAP 访问。不要暴露数据库端口（5432）。

---

## 2. 宿主机初始化与防 OOM 配置（必做）

对于 1G~2G 内存的机器，配置 Swap 是防止进程被内核 OOM Killer 杀死的关键生命线。

```bash
# 1. 更新系统软件包
sudo apt update && sudo apt upgrade -y

# 2. 创建 2GB Swap 分区（如果是 1G 内存机型，建议创建 4GB）
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 3. 持久化 Swap
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 4. 调整 swappiness（降到 10~20，优先使用物理内存，避免频繁刷盘）
sudo sysctl vm.swappiness=15
echo 'vm.swappiness=15' | sudo tee -a /etc/sysctl.conf
```

---

## 3. PostgreSQL 安装与调优（宿主机原生运行）

说明：在此场景下，宿主机直接通过 apt 安装 PostgreSQL 往往比容器化 PG 资源开销更小、管理 systemd 守护进程与日志轮转更直接。

### 3.1 安装与建库

```bash
# 安装 PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# 启动并设置开机自启
sudo systemctl enable postgresql
sudo systemctl start postgresql

# 创建数据库与应用专有账号
sudo -u postgres psql
```

进入 psql 控制台后执行：

```sql
CREATE DATABASE app_production;
CREATE USER app_user WITH ENCRYPTED PASSWORD 'StrongProductionPasswordHere';
GRANT ALL PRIVILEGES ON DATABASE app_production TO app_user;
-- PostgreSQL 15+ 额外授权 schema 权限：
\c app_production
GRANT ALL ON SCHEMA public TO app_user;
\q
```

### 3.2 允许 Docker 容器访问本地 PG

默认情况下，PostgreSQL 只监听 `127.0.0.1`。Docker 容器访问宿主机时使用的是宿主机网桥 IP（通常为 `172.17.0.1`）。

1. 修改 `/etc/postgresql/14/main/postgresql.conf`（以实际版本号为准）：

```conf
# 允许监听本地所有接口（或仅写 127.0.0.1, 172.17.0.1）
listen_addresses = 'localhost, 172.17.0.1'
```

2. 修改 `/etc/postgresql/14/main/pg_hba.conf`，允许 Docker 默认网段连接：

```conf
# 允许来自 Docker 容器网段的连接
host    app_production   app_user    172.17.0.0/16       scram-sha-256
```

3. 重启数据库服务：

```bash
sudo systemctl restart postgresql
```

---

## 4. 安装 Docker & Docker Compose

使用官方一键脚本安装最新版本的 Docker 引擎与 Compose 插件：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重启 session 或执行 newgrp docker 以免每次输入 sudo
```

验证：

```bash
docker --version
docker compose version
```

---

## 5. 项目结构规范与生产环境配置

推荐在 `/opt` 或 `/srv` 规范化部署路径：

```text
/opt/myapp/
├── docker-compose.yml
├── .env.production
└── logs/
```

### 5.1 设置 .env.production

```bash
sudo mkdir -p /opt/myapp
sudo chown -R $USER:$USER /opt/myapp
cd /opt/myapp
```

创建 `.env.production`：

```env
# 安全与基础
NODE_ENV=production
APP_SECRET=your_super_secret_key_here

# 数据库连接（指向宿主机在 Docker 网桥的 IP）
DATABASE_URL=postgresql://app_user:StrongProductionPasswordHere@172.17.0.1:5432/app_production

# 端口绑定（仅绑定宿主机 127.0.0.1，不对外暴露公网）
API_PORT=3000
WEB_PORT=8080
```

> 权限收紧：
>
> ```bash
> chmod 600 /opt/myapp/.env.production
> ```

### 5.2 生产项目的真实配置

在 AUCN Hub 中，生产环境变量应参考当前仓库文件：

- [.env.example](../.env.example)
- [.env.production](../.env.production)

不建议直接沿用示例模板，至少要补全：

```env
NODE_ENV=production
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD
DATABASE_URL=postgresql://aucn:CHANGE_ME_STRONG_PASSWORD@postgres:5432/aucnhub?schema=public
API_PORT=4000
CORS_ORIGINS=https://your-domain.com
JWT_ACCESS_SECRET=REPLACE_WITH_32_PLUS_CHAR_RANDOM_SECRET
JWT_REFRESH_SECRET=REPLACE_WITH_32_PLUS_CHAR_RANDOM_SECRET
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
OTP_DELIVERY=smtp
OTP_TTL_SECONDS=600
NEXT_PUBLIC_API_URL=https://api.your-domain.com
API_INTERNAL_URL=http://api:4000
API_PUBLIC_URL=https://api.your-domain.com
WEB_ORIGIN=https://your-domain.com
MEDIA_LOCAL_DIR=/app/uploads
SMTP_URL=smtp://username:password@smtp.host:587
SMTP_FROM=no-reply@your-domain.com
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PROMOTION_PRICE_ID=price_xxx
```

### 5.3 编写 docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    image: my-docker-registry/api:latest
    restart: always
    env_file:
      - .env.production
    ports:
      - '127.0.0.1:3000:3000'
    deploy:
      resources:
        limits:
          memory: 512M

  web:
    image: my-docker-registry/web:latest
    restart: always
    env_file:
      - .env.production
    ports:
      - '127.0.0.1:8080:80'
    deploy:
      resources:
        limits:
          memory: 256M
```

启动应用：

```bash
docker compose --env-file .env.production up -d
```

---

## 6. Nginx 反向代理与 HTTPS（Certbot）

宿主机直接运行 Nginx，具有消耗低、统一挂接 SSL 证书、配置和调试直观的优点。

### 6.1 安装 Nginx & Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 6.2 配置站点反向代理

创建 `/etc/nginx/sites-available/myapp.conf`：

```nginx
server {
    listen 80;
    server_name example.com api.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

启用配置并重载：

```bash
sudo ln -s /etc/nginx/sites-available/myapp.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 6.3 申请免费 Let's Encrypt 证书

确保域名 A 记录已解析到 VM 的静态 IP：

```bash
sudo certbot --nginx -d example.com -d api.example.com
```

### 6.4 最终 Nginx 代理完整配置参考

Certbot 自动生成证书后，编辑 `/etc/nginx/sites-available/myapp.conf` 调整代理路径：

```nginx
# Web 前端
server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# API 后端
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

测试并生效：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. 生产兜底保障（极低成本必配）

单机架构最大的风险是单点故障与数据损坏，必须补齐两项无额外开销的兜底措施：

### 7.1 PostgreSQL 定时本地备份 + 轮转

创建备份脚本 `/usr/local/bin/pg_backup.sh`：

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/postgres"
DATE=$(date +"%Y%m%d_%H%M%S")
mkdir -p "$BACKUP_DIR"

# 导出并压缩
sudo -u postgres pg_dump app_production | gzip > "$BACKUP_DIR/app_production_$DATE.sql.gz"

# 仅保留最近 7 天的备份
find "$BACKUP_DIR" -type f -name "*.sql.gz" -mtime +7 -delete
```

设置执行权限与 cron 定时任务（每天凌晨 3:00 执行）：

```bash
sudo chmod +x /usr/local/bin/pg_backup.sh
(sudo crontab -l 2>/dev/null; echo "0 3 * * * /usr/local/bin/pg_backup.sh") | sudo crontab -
```

进阶建议：可通过 `rclone` 或 `gsutil` 将压缩包同步到 Google Cloud Storage 的 Coldline 存储桶。

### 7.2 UFW 宿主机防火墙加固

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 8. 项目启动命令（实际部署版）

在 VM 上执行：

```bash
cd /opt/AUCNBBS

# 1) 拉取代码
git pull origin main

# 2) 复制生产变量
cp .env.example .env.production
# 然后在 .env.production 中填入真实配置

# 3) 构建镜像并启动数据库
docker compose --env-file .env.production -f infrastructure/compose.production.yml build
docker compose --env-file .env.production -f infrastructure/compose.production.yml up -d postgres

# 4) 执行 Prisma migration
docker compose --env-file .env.production -f infrastructure/compose.production.yml run --rm --no-deps api pnpm prisma:migrate:deploy

# 5) 启动 API 与 Web
docker compose --env-file .env.production -f infrastructure/compose.production.yml up -d
```

验证：

```bash
curl -fsS https://api.your-domain.com/api/v1/health
curl -fsS https://your-domain.com
```

---

## 9. 维护建议

建议定期执行：

```bash
cd /opt/AUCNBBS

docker compose --env-file .env.production -f infrastructure/compose.production.yml pull
docker compose --env-file .env.production -f infrastructure/compose.production.yml up -d --no-deps --build api web
docker compose --env-file .env.production -f infrastructure/compose.production.yml logs -f
```

数据库备份：

```bash
PGPASSWORD='CHANGE_ME_STRONG_PASSWORD' pg_dump -h 127.0.0.1 -U aucn -d aucnhub > aucnhub_backup_$(date +%F_%H%M%S).sql
```

---

## 10. 结论

对于 AUCN Hub 这类全栈项目，最低成本且合理的方案是：

- 1 台 Ubuntu VPS
- PostgreSQL 安装在 VM 内部
- Docker + Compose 部署
- Nginx + Let's Encrypt 作为反向代理
- .env.production 管理生产秘钥

这种方案比 Cloud SQL 更便宜，也更符合当前项目结构；同时通过 Swap、UFW、备份和 Nginx 代理，可以在低成本机器上保持较稳定的可运行状态。
