#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-competition-voting}"
APP_USER="${APP_USER:-competition-voting}"
APP_DIR="${APP_DIR:-/opt/$APP_NAME}"
DATA_DIR="${DATA_DIR:-/var/lib/$APP_NAME}"
PORT="${PORT:-3001}"
PUBLIC_PORT="${PUBLIC_PORT:-80}"
NODE_MAJOR="${NODE_MAJOR:-22}"
INSTALL_NGINX="${INSTALL_NGINX:-true}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo or as root."
  exit 1
fi

if [[ ! -f /etc/os-release ]] || ! grep -qiE 'ubuntu|debian' /etc/os-release; then
  echo "This script is intended for Ubuntu or Debian-based servers."
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$SOURCE_DIR/package.json" ]] || [[ ! -f "$SOURCE_DIR/server/index.js" ]]; then
  echo "Run this script from the app repository root."
  exit 1
fi

echo "Installing system dependencies..."
apt-get update
apt-get install -y ca-certificates curl gnupg build-essential python3 rsync

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]]; then
  echo "Installing Node.js $NODE_MAJOR..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if [[ "$INSTALL_NGINX" == "true" ]]; then
  echo "Installing nginx..."
  apt-get install -y nginx
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi

echo "Copying app to $APP_DIR..."
mkdir -p "$APP_DIR" "$DATA_DIR"

if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete \
    --exclude ".git" \
    --exclude "node_modules" \
    --exclude "dist" \
    --exclude "voting.sqlite" \
    --exclude "voting.sqlite-shm" \
    --exclude "voting.sqlite-wal" \
    "$SOURCE_DIR/" "$APP_DIR/"
fi

if [[ -f "$SOURCE_DIR/voting.sqlite" && ! -f "$DATA_DIR/voting.sqlite" ]]; then
  cp "$SOURCE_DIR/voting.sqlite" "$DATA_DIR/voting.sqlite"
fi

echo "Installing npm dependencies and building app..."
cd "$APP_DIR"
npm ci
npm run build
npm prune --omit=dev

chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"
chmod 750 "$DATA_DIR"

echo "Installing systemd service..."
cat > "/etc/systemd/system/$APP_NAME.service" <<SERVICE
[Unit]
Description=Competition Voting App
After=network.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=DB_FILE=$DATA_DIR/voting.sqlite
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable "$APP_NAME"
systemctl restart "$APP_NAME"

if [[ "$INSTALL_NGINX" == "true" ]]; then
  echo "Configuring nginx..."
  cat > "/etc/nginx/sites-available/$APP_NAME" <<NGINX
server {
    listen $PUBLIC_PORT default_server;
    listen [::]:$PUBLIC_PORT default_server;
    server_name _;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

  rm -f /etc/nginx/sites-enabled/default
  ln -sfn "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
fi

echo
echo "Deployment complete."
echo "App service: systemctl status $APP_NAME"
echo "App logs: journalctl -u $APP_NAME -f"
if [[ "$INSTALL_NGINX" == "true" ]]; then
  echo "Public URL: http://SERVER_IP:$PUBLIC_PORT"
else
  echo "App URL: http://SERVER_IP:$PORT"
fi
