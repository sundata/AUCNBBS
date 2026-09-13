#!/usr/bin/env bash
set -euo pipefail

# === Required configuration ===
# Replace these values before running on the VM.
DOMAIN="your-domain.com"
API_DOMAIN="api.your-domain.com"
PG_PASSWORD="CHANGE_ME_STRONG_PASSWORD"
JWT_ACCESS_SECRET="REPLACE_WITH_32_PLUS_CHAR_RANDOM_SECRET"
JWT_REFRESH_SECRET="REPLACE_WITH_32_PLUS_CHAR_RANDOM_SECRET"
SMTP_URL="smtp://username:password@smtp.host:587"
SMTP_FROM="no-reply@your-domain.com"
STRIPE_SECRET_KEY="sk_live_xxx"
STRIPE_WEBHOOK_SECRET="whsec_xxx"
STRIPE_PROMOTION_PRICE_ID="price_xxx"
REPO_URL="https://github.com/sundata/AUCNBBS.git"

# === Validate root / sudo ===
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root or with sudo."
  exit 1
fi

# === System update ===
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# === Create swap ===
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl vm.swappiness=15
if ! grep -q '^vm.swappiness=' /etc/sysctl.conf; then
  echo 'vm.swappiness=15' >> /etc/sysctl.conf
fi

# === Install base tools ===
apt-get install -y curl git ca-certificates gnupg lsb-release ufw

# === Install Docker ===
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list >/dev/null
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  usermod -aG docker "$SUDO_USER"
fi

# === Install Postgres ===
if ! command -v psql >/dev/null 2>&1; then
  apt-get install -y postgresql postgresql-contrib
fi
systemctl enable postgresql
systemctl start postgresql

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='aucn'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER aucn WITH ENCRYPTED PASSWORD '${PG_PASSWORD}';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='aucnhub'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE aucnhub OWNER aucn;"
fi

PG_VERSION=$(psql -V | awk '{print $3}' | cut -d. -f1)
PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
PG_HBA="/etc/postgresql/${PG_VERSION}/main/pg_hba.conf"

if ! grep -q "listen_addresses = 'localhost, 172.17.0.1'" "$PG_CONF"; then
  sed -i "s/^#listen_addresses = 'localhost'/listen_addresses = 'localhost, 172.17.0.1'/" "$PG_CONF"
fi
if ! grep -q "172.17.0.0/16" "$PG_HBA"; then
  echo "host    aucnhub             aucn             172.17.0.0/16           scram-sha-256" >> "$PG_HBA"
fi
systemctl restart postgresql

# === Install nginx and certbot ===
apt-get install -y nginx certbot python3-certbot-nginx

# === Clone repo ===
mkdir -p /opt
if [ ! -d /opt/AUCNBBS ]; then
  git clone "$REPO_URL" /opt/AUCNBBS
fi
cd /opt/AUCNBBS
git pull origin main || true

# === Create production environment ===
cat > .env.production <<EOF
NODE_ENV=production
POSTGRES_PASSWORD=${PG_PASSWORD}
DATABASE_URL=postgresql://aucn:${PG_PASSWORD}@postgres:5432/aucnhub?schema=public
API_PORT=4000
CORS_ORIGINS=https://${DOMAIN}
JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
OTP_DELIVERY=smtp
OTP_TTL_SECONDS=600
NEXT_PUBLIC_API_URL=https://${API_DOMAIN}
API_INTERNAL_URL=http://api:4000
API_PUBLIC_URL=https://${API_DOMAIN}
WEB_ORIGIN=https://${DOMAIN}
MEDIA_LOCAL_DIR=/app/uploads
SMTP_URL=${SMTP_URL}
SMTP_FROM=${SMTP_FROM}
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
WECHAT_WEB_APP_ID=
WECHAT_WEB_APP_SECRET=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
STRIPE_PROMOTION_PRICE_ID=${STRIPE_PROMOTION_PRICE_ID}
REDIS_URL=
OPENSEARCH_URL=
S3_BUCKET=
S3_REGION=ap-southeast-2
GOOGLE_MAPS_API_KEY=
SENTRY_DSN=
KMS_KEY_ALIAS=
EOF
chmod 600 .env.production

# === nginx config ===
cat > /etc/nginx/sites-available/aucnhub <<EOF
server {
    listen 80;
    server_name ${DOMAIN} ${API_DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name ${API_DOMAIN};

    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/aucnhub /etc/nginx/sites-enabled/aucnhub
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# === Certbot (requires DNS to already point to this VM) ===
certbot --nginx -d "$DOMAIN" -d "$API_DOMAIN"

# === Firewall ===
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# === Docker compose deployment ===
cd /opt/AUCNBBS
docker compose --env-file .env.production -f infrastructure/compose.production.yml build
docker compose --env-file .env.production -f infrastructure/compose.production.yml up -d postgres
docker compose --env-file .env.production -f infrastructure/compose.production.yml run --rm --no-deps api pnpm prisma:migrate:deploy
docker compose --env-file .env.production -f infrastructure/compose.production.yml up -d

# === Final verification ===
curl -fsS "https://${API_DOMAIN}/api/v1/health" || true
curl -fsS "https://${DOMAIN}" || true

echo
echo "Deployment script finished."
echo "Check API: https://${API_DOMAIN}/api/v1/health"
echo "Check Swagger: https://${API_DOMAIN}/api/docs"
echo "Check Web: https://${DOMAIN}"
