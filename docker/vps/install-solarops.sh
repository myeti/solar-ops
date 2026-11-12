#!/usr/bin/env bash
#
# Install (or upgrade) SolarOps on the test VPS, the way you would on a real
# server (Node.js first, by hand, then npm run setup), with three test-only
# differences:
#   - sources come from /src (the repository, mounted read-only) instead of
#     a git clone,
#   - PostgreSQL is the "postgres" container (external server),
#   - certbot talks to Pebble (Let's Encrypt's test server) instead of
#     Let's Encrypt.
#
# Then it seeds a project folder that "already existed" before SolarOps, to
# test adoption. Run it again after changing the code: it is idempotent.
#
# Usage (from the docker/ folder of the repository):
#   docker compose exec vps install-solarops [extra deploy/install.sh options]
#   docker compose exec vps install-solarops --domain solarops.test --email admin@solarops.test
#
# --domain and --email are given to the setup as answers to its questions.

set -Eeuo pipefail

APP_DIR="/var/solarops"
BASE_FOLDER="/var/www"
PEBBLE_DIRECTORY="https://pebble:14000/dir"

step() {
  printf "\n\033[35m\033[1m◆ %s\033[0m\n" "$1"
}

# Set (or replace) a KEY=value in SolarOps's .env.
set_env_value() {
  local key="$1"
  local value="$2"
  local file="$APP_DIR/.env"

  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# A project that ran on this server before SolarOps: the application sits
# directly in its folder, owned by another user, with its own nginx config.
# SolarOps must adopt it without erasing or replacing anything.
seed_existing_project() {
  local folder="$BASE_FOLDER/blog"

  if [[ -e "$folder" ]]; then
    return
  fi

  step "Seeding a pre-existing project in ${folder}"

  if ! id deploy > /dev/null 2>&1; then
    useradd --create-home --shell /bin/bash deploy
  fi

  install -d -o deploy -g deploy -m 0755 "$folder" "$folder/etc"

  cat > "$folder/package.json" <<'EOF'
{
  "name": "legacy-blog",
  "private": true,
  "scripts": {
    "start": "node server.js"
  }
}
EOF

  cat > "$folder/server.js" <<'EOF'
// A blog that ran on this server before SolarOps.
const http = require('node:http');
const port = Number(process.env.PORT || 3001);

http.createServer((req, res) => {
  res.end(`Legacy blog says hi (database: ${process.env.DB_NAME || 'none'})\n`);
}).listen(port, () => console.log(`Legacy blog on port ${port}`));
EOF

  cat > "$folder/etc/nginx.conf" <<'EOF'
# Hand-written before SolarOps existed.
server {
    listen 80;
    server_name legacy-blog.example.com;

    location / {
        proxy_pass http://127.0.0.1:3001;
    }
}
EOF

  chown -R deploy:deploy "$folder"
  echo "  $folder (owner: deploy) — app at the root, foreign etc/nginx.conf"
}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (docker compose exec runs as root by default)." >&2
  exit 1
fi

# The answers to the setup questions (domain, then e-mail).
DOMAIN=""
EMAIL=""
SETUP_OPTIONS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:?--domain needs a value}"
      shift 2
      ;;
    --email)
      EMAIL="${2:?--email needs a value}"
      shift 2
      ;;
    *)
      SETUP_OPTIONS+=("$1")
      shift
      ;;
  esac
done

if [[ ! -f /src/deploy/install.sh ]]; then
  echo "SolarOps sources are not mounted at /src (see docker/compose.yml)." >&2
  exit 1
fi

step "Copying SolarOps sources to ${APP_DIR}"

mkdir -p "$APP_DIR"
# node_modules, the built UI, data and .env belong to this server: never
# copied from (nor overwritten by) the host.
rsync -a --delete \
  --exclude '/node_modules' --exclude '/client/dist' --exclude '/data' \
  --exclude '/.env' --exclude '/.claude' --exclude '/.git' --exclude '.DS_Store' \
  /src/ "$APP_DIR/"
echo "  done"

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

# Test only: certificates come from Pebble (self-signed ACME endpoint).
set_env_value SOLAROPS_CERTBOT_BIN "certbot --server ${PEBBLE_DIRECTORY} --no-verify-ssl"

# What the admin does by hand before the setup: Node.js 24, for the whole system.
if ! command -v node > /dev/null; then
  step "Installing Node.js 24 (NodeSource), as the README says"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - > /dev/null
  apt-get install -y -q nodejs > /dev/null
  echo "  node $(node --version)"
fi

step "Running npm run setup"

answers="$DOMAIN"

if [[ -n "$DOMAIN" ]]; then
  answers="${DOMAIN}"$'\n'"${EMAIL}"
fi

printf '%s\n' "$answers" | (
  cd "$APP_DIR" && npm run --silent setup -- \
    --host 0.0.0.0 \
    --pg-host postgres \
    --pg-user solarops_admin \
    --pg-password "${SOLAROPS_TEST_PG_PASSWORD:?missing SOLAROPS_TEST_PG_PASSWORD}" \
    "${SETUP_OPTIONS[@]}"
)

seed_existing_project

step "Test bench ready"

cat <<'EOF'
  UI                 http://localhost:4100   (BENCH_UI_PORT on the host; setup token above)

  Try these:
  • Link an existing database to a project:
      postgres://legacy_shop:legacy-shop-test@postgres:5432/legacy_shop
  • Create a project named "Blog": its folder /var/www/blog already exists
    (owned by "deploy": SolarOps warns it cannot write; fix with
    chown -R solarops: /var/www/blog) and the database "blog" already
    exists (create refused → link: postgres://blog:blog-test@postgres:5432/blog)
  • Deploy an application listening on PORT, e.g. https://github.com/heroku/node-js-getting-started.git
    (branch main), domain app.solarops.test, certificate "HTTP": issued by Pebble.
    Check from the VPS:  curl -sk https://app.solarops.test
  • A static site: files in repo/dist, domain shop.solarops.test (no process, no port)
  • SolarOps's own domain:  solarops domain:set solarops.test --email admin@solarops.test

  Test domains (Pebble can validate them): solarops.test, app.solarops.test,
  www.app.solarops.test, shop.solarops.test, blog.solarops.test
EOF
