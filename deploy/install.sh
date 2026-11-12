#!/usr/bin/env bash
#
# SolarOps — server setup script (Debian 12+ / Ubuntu 22.04+), run by
# `npm run setup` (and `npm run update`, see deploy/update.sh).
#
# Node.js 24 must be installed beforehand, for the whole system (see the
# README). The script installs the other OS dependencies: nginx, certbot (+
# OVH / Cloudflare / DigitalOcean DNS plugins), PostgreSQL, git, build tools,
# pm2, and pnpm / yarn through corepack (for projects using them).
#
# Then (unless --deps-only) prepares the server for SolarOps:
#   - a dedicated "solarops" system user,
#   - the projects base folder and SolarOps's data folder,
#   - the nginx include loading every project configuration,
#   - a sudo rule allowing SolarOps to test and reload nginx (nothing else),
#   - a PostgreSQL role for SolarOps (CREATEDB + CREATEROLE, not superuser),
#   - pm2 startup (projects come back after a reboot) and pm2-logrotate
#     (project logs are rotated and compressed),
#   - the SolarOps systemd service and the `solarops` CLI wrapper,
#   - a daily timer renewing certificates (safety net for the scheduler),
#   - optionally a domain + HTTPS certificate for SolarOps itself, managed
#     like any project (Projects › SolarOps): the domain and the e-mail for
#     Let's Encrypt are asked while the script runs.
#
# The script is idempotent, and remembers its setup: an option not given
# keeps the value of the previous run (never the default), so running it
# again only changes what you pass.
#
# Nothing already installed is replaced or upgraded: a missing dependency is
# installed, an installed one is kept as is when its version is supported,
# and the script stops (changing nothing) when it is too old. Minimums:
# Node.js 24, npm 10, git 2.25, nginx 1.18, certbot 1.12, pm2 5, PostgreSQL 13
# (and pg_dump at least as recent as the PostgreSQL server).
#
# The output of the long steps (apt, npm) goes to /var/log/solarops-install.log.
# While another package manager holds the apt locks (e.g. unattended upgrades
# on a new server), the script waits for it, up to 30 minutes.
#
# Usage:
#   npm run setup [-- options]       (or: sudo ./deploy/install.sh [options])
#
# Options (first setup: default values; later runs: the previous ones):
#   --deps-only              Only install the OS packages, pm2, pnpm and yarn.
#   --base-folder <path>     Projects base folder         (default: /var/www)
#   --data-dir <path>        SolarOps data folder        (default: /var/lib/solarops)
#   --user <name>            System user running it all   (default: solarops)
#   --port <port>            Local port of SolarOps      (default: 4100)
#   --host <address>         Address SolarOps listens on (default: 127.0.0.1).
#                            Only change it in containers or behind a firewall.
#   --skip-postgres          Do not install / configure PostgreSQL
#   --pg-host <host>         Use an existing PostgreSQL server instead of a local
#                            one (only the client tools are installed). With:
#   --pg-port <port>           its port                   (default: 5432)
#   --pg-user <role>           admin role, CREATEDB CREATEROLE (default: solarops_admin)
#   --pg-password <password>   password of that role (also for an existing local
#                              role SolarOps did not create: never modified)
#   --log-max-size <size>    Rotate a project log above this size (default: 10M)
#   --log-retain <count>     Rotated logs kept per file          (default: 14)
#   --update                 Used by npm run update: no question, no option,
#                            the previous setup as is.
#   -h, --help               Show this help.

set -Eeuo pipefail

# ─────────────────────────────── Settings ───────────────────────────────

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPS_ONLY=false
BASE_FOLDER="/var/www"
DATA_DIR="/var/lib/solarops"
SERVICE_USER="solarops"
PORT="4100"
LISTEN_HOST="127.0.0.1"
DOMAIN=""
EMAIL=""
SKIP_POSTGRES=false
NODE_MAJOR="24"
PG_ADMIN_ROLE="solarops_admin"
PG_EXTERNAL_HOST=""
PG_EXTERNAL_PORT="5432"
PG_EXTERNAL_PASSWORD=""
LOG_MAX_SIZE="10M"
LOG_RETAIN="14"
LOG_OPTIONS_GIVEN=false
UPDATE_MODE=false

# Options given on the command line: the others keep their previous value.
declare -A GIVEN=()

# Output of the long commands (apt, npm): follow it with tail -f.
INSTALL_LOG="/var/log/solarops-install.log"

# Locks taken by apt and dpkg while they work, e.g. by unattended upgrades or
# cloud-init right after a server is created.
APT_LOCK_FILES=(/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock)
APT_WAIT_MAX_SECONDS=1800
APT_LOCK_OPTIONS=(-o DPkg::Lock::Timeout=300)

# Oldest versions SolarOps works with (installed ones are never upgraded).
MIN_NPM="10.0.0"
MIN_GIT="2.25.0"
MIN_NGINX="1.18.0"
MIN_CERTBOT="1.12.0"
MIN_PM2="5.0.0"
MIN_POSTGRES_MAJOR="13"

# ─────────────────────────────── Helpers ────────────────────────────────

COLOR_RESET="\033[0m"
COLOR_CYAN="\033[36m"
COLOR_GREEN="\033[32m"
COLOR_YELLOW="\033[33m"
COLOR_RED="\033[31m"
COLOR_BOLD="\033[1m"

step() {
  printf "\n${COLOR_CYAN}${COLOR_BOLD}▸ %s${COLOR_RESET}\n" "$1"
}

info() {
  printf "  %s\n" "$1"
}

success() {
  printf "  ${COLOR_GREEN}✔ %s${COLOR_RESET}\n" "$1"
}

warn() {
  printf "  ${COLOR_YELLOW}⚠ %s${COLOR_RESET}\n" "$1"
}

fail() {
  printf "\n${COLOR_RED}✖ %s${COLOR_RESET}\n" "$1" >&2
  exit 1
}

on_error() {
  fail "Installation failed at line $1. Fix the problem above and run the script again (it is safe to re-run)."
}

trap 'on_error $LINENO' ERR

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# Generate a random alphanumeric secret. Every command reads its whole
# input: no early exit, so no SIGPIPE under "set -o pipefail".
random_secret() {
  head -c 1024 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c "1-${1:-32}"
}

# Read a KEY=value from the .env file (empty when absent).
env_value() {
  local key="$1"
  local file="$APP_DIR/.env"

  if [[ -f "$file" ]]; then
    grep -E "^${key}=" "$file" | tail -n 1 | cut -d '=' -f 2- || true
  fi
}

# Set (or replace) a KEY=value in the .env file.
set_env_value() {
  local key="$1"
  local value="$2"
  local file="$APP_DIR/.env"

  if grep -qE "^${key}=" "$file"; then
    local escaped
    escaped="$(printf '%s' "$value" | sed -e 's/[\/&|]/\\&/g')"
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# Run psql as the postgres superuser (from a folder it can enter).
run_psql() {
  (cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 "$@")
}

# Run a long command, its output going to the install log. On failure, the
# end of the log is shown (then the ERR trap stops the script).
run_logged() {
  local status=0

  "$@" >> "$INSTALL_LOG" 2>&1 || status=$?

  if [[ $status -ne 0 ]]; then
    printf "  ${COLOR_RED}%s failed (exit code %s). End of %s:${COLOR_RESET}\n" "$*" "$status" "$INSTALL_LOG" >&2
    tail -n 20 "$INSTALL_LOG" | sed 's/^/    /' >&2
  fi

  return "$status"
}

# Process holding an apt / dpkg lock, as "pid command" (empty when none).
# apt and dpkg take POSIX locks, listed in /proc/locks as
# "id: POSIX ADVISORY WRITE <pid> <major>:<minor>:<inode> ..." ("->" marks a
# process waiting for a lock, not holding it). Processes that merely run,
# such as unattended-upgrade-shutdown waiting for a shutdown, hold none.
apt_lock_holder() {
  local file
  local inode
  local pid
  local fd
  local command

  for file in "${APT_LOCK_FILES[@]}"; do
    inode="$(stat -c %i "$file" 2> /dev/null || true)"

    if [[ -z "$inode" ]]; then
      continue
    fi

    for pid in $(awk -v inode="$inode" '$2 != "->" { n = split($6, id, ":"); if (id[n] == inode && $5 > 0) print $5 }' /proc/locks); do
      # The same inode may exist on another filesystem: the process must have this file open.
      for fd in "/proc/${pid}/fd/"*; do
        if [[ "$(readlink "$fd" 2> /dev/null || true)" == "$file" ]]; then
          command="$({ tr '\0' ' ' < "/proc/${pid}/cmdline"; } 2> /dev/null || true)"
          printf '%s %s' "$pid" "${command% }"
          return 0
        fi
      done
    done
  done

  return 0
}

# Wait while another package manager holds the apt / dpkg locks: apt would
# wait silently, or fail.
wait_for_apt() {
  local waited=0
  local holder

  while holder="$(apt_lock_holder)" && [[ -n "$holder" ]]; do
    if [[ $waited -eq 0 ]]; then
      warn "Another package manager is working: ${holder}"
      info "Waiting for it to finish (on a new server: unattended upgrades or cloud-init, usually a few minutes)…"
    elif [[ $((waited % 60)) -eq 0 ]]; then
      info "Still waiting ($((waited / 60)) min)…"
    fi

    if [[ $waited -ge $APT_WAIT_MAX_SECONDS ]]; then
      fail "apt / dpkg is still busy after $((APT_WAIT_MAX_SECONDS / 60)) minutes (${holder}). Let it finish, then run this script again."
    fi

    sleep 5
    waited=$((waited + 5))
  done
}

# Whether a Debian package is installed.
is_installed() {
  dpkg-query -W -f='${Status}' "$1" 2> /dev/null | grep -q "install ok installed"
}

APT_UPDATED=false

# Refresh the package lists once, only when something has to be installed.
apt_update_once() {
  if [[ "$APT_UPDATED" == false ]]; then
    wait_for_apt
    info "Refreshing the package lists…"
    run_logged apt-get "${APT_LOCK_OPTIONS[@]}" update
    APT_UPDATED=true
  fi
}

# Install the packages that are missing. Installed ones are never upgraded
# (--no-upgrade), even if a newer version is available.
apt_install_missing() {
  local missing=()
  local package

  for package in "$@"; do
    if ! is_installed "$package"; then
      missing+=("$package")
    fi
  done

  if [[ ${#missing[@]} -eq 0 ]]; then
    return 0
  fi

  apt_update_once
  wait_for_apt
  info "Installing ${missing[*]}…"
  run_logged apt-get "${APT_LOCK_OPTIONS[@]}" install -y --no-install-recommends --no-upgrade "${missing[@]}"
}

# Install an optional package when missing; only warn if this release lacks it.
install_optional_package() {
  if is_installed "$1"; then
    success "$1 already installed"
    return 0
  fi

  apt_update_once
  wait_for_apt

  if apt-get "${APT_LOCK_OPTIONS[@]}" install -y --no-install-recommends --no-upgrade "$1" >> "$INSTALL_LOG" 2>&1; then
    success "$1 installed"
  else
    warn "$1 is not available on this release: install the certbot plugin manually if you need it."
  fi
}

# Whether version $1 >= version $2.
version_ge() {
  dpkg --compare-versions "$1" ge "$2"
}

# Stop when an installed tool is too old: it is never replaced or upgraded.
require_version() {
  local name="$1"
  local version="$2"
  local minimum="$3"

  if [[ -z "$version" ]] || ! version_ge "$version" "$minimum"; then
    fail "${name} ${version:-of unknown version} is installed, SolarOps needs ${minimum} or later. It is not replaced: upgrade it yourself, then run this script again."
  fi
}

# Stop when the PostgreSQL server is too old, or pg_dump older than it
# (dumps would fail). $1: SHOW server_version_num, e.g. 160004.
check_postgres_versions() {
  local server_major=$(( $1 / 10000 ))
  local client_version
  local client_major

  if [[ "$server_major" -lt "$MIN_POSTGRES_MAJOR" ]]; then
    fail "PostgreSQL ${server_major} is installed, SolarOps needs ${MIN_POSTGRES_MAJOR} or later. It is not replaced: upgrade it yourself, then run this script again."
  fi

  client_version="$(pg_dump --version | awk '{print $3}')"
  client_major="${client_version%%.*}"

  if [[ "$client_major" -lt "$server_major" ]]; then
    fail "pg_dump ${client_version} is older than the PostgreSQL ${server_major} server: dumps would fail. Install postgresql-client-${server_major}, then run this script again."
  fi

  success "PostgreSQL ${server_major} server, pg_dump ${client_version}"
}

# Whether a command exists (sbin folders included, they are not always in PATH).
has_command() {
  command -v "$1" > /dev/null || [[ -x "/usr/sbin/$1" ]]
}

# npm run setup / update run as a regular user: continue as root.
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo > /dev/null; then
    exec sudo -- bash "$0" "$@"
  fi

  fail "Run this script as root."
fi

# ─────────────────────────────── Arguments ──────────────────────────────

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deps-only)
      DEPS_ONLY=true
      GIVEN[deps-only]=1
      shift
      ;;
    --base-folder)
      BASE_FOLDER="${2:?--base-folder needs a value}"
      GIVEN[base-folder]=1
      shift 2
      ;;
    --data-dir)
      DATA_DIR="${2:?--data-dir needs a value}"
      GIVEN[data-dir]=1
      shift 2
      ;;
    --user)
      SERVICE_USER="${2:?--user needs a value}"
      GIVEN[user]=1
      shift 2
      ;;
    --port)
      PORT="${2:?--port needs a value}"
      GIVEN[port]=1
      shift 2
      ;;
    --host)
      LISTEN_HOST="${2:?--host needs a value}"
      GIVEN[host]=1
      shift 2
      ;;
    --pg-host)
      PG_EXTERNAL_HOST="${2:?--pg-host needs a value}"
      GIVEN[pg-host]=1
      shift 2
      ;;
    --pg-port)
      PG_EXTERNAL_PORT="${2:?--pg-port needs a value}"
      GIVEN[pg-port]=1
      shift 2
      ;;
    --pg-user)
      PG_ADMIN_ROLE="${2:?--pg-user needs a value}"
      GIVEN[pg-user]=1
      shift 2
      ;;
    --pg-password)
      PG_EXTERNAL_PASSWORD="${2:?--pg-password needs a value}"
      GIVEN[pg-password]=1
      shift 2
      ;;
    --log-max-size)
      LOG_MAX_SIZE="${2:?--log-max-size needs a value, e.g. 10M}"
      LOG_OPTIONS_GIVEN=true
      GIVEN[log-max-size]=1
      shift 2
      ;;
    --log-retain)
      LOG_RETAIN="${2:?--log-retain needs a value}"
      LOG_OPTIONS_GIVEN=true
      GIVEN[log-retain]=1
      shift 2
      ;;
    --update)
      UPDATE_MODE=true
      shift
      ;;
    --domain | --email)
      fail "The domain and the e-mail are asked while the script runs: no $1 option."
      ;;
    --skip-postgres)
      SKIP_POSTGRES=true
      GIVEN[skip-postgres]=1
      shift
      ;;
    -h | --help)
      usage
      ;;
    *)
      fail "Unknown option: $1 (see --help)"
      ;;
  esac
done

# ─────────────────────────────── Previous setup ─────────────────────────
#
# A new run (npm run setup to change an option, npm run update after a
# pull) keeps the configuration of the previous one: an option not given is
# read back from .env (and the service), never reset to its default.

PREVIOUS_SETUP=false

if [[ -f "$APP_DIR/.env" ]] && [[ -f /etc/systemd/system/solarops.service ]]; then
  PREVIOUS_SETUP=true
fi

# Value of the previous run for an option that was not given.
keep_previous() {
  local option="$1"
  local variable="$2"
  local key="$3"
  local value

  if [[ -n "${GIVEN[$option]:-}" ]]; then
    return 0
  fi

  value="$(env_value "$key")"

  if [[ -n "$value" ]]; then
    printf -v "$variable" '%s' "$value"
  fi
}

if [[ "$PREVIOUS_SETUP" == true ]]; then
  keep_previous port PORT SOLAROPS_PORT
  keep_previous host LISTEN_HOST SOLAROPS_HOST
  keep_previous base-folder BASE_FOLDER SOLAROPS_BASE_FOLDER
  keep_previous data-dir DATA_DIR SOLAROPS_DATA_DIR
  keep_previous user SERVICE_USER SOLAROPS_SETUP_USER

  # Setups older than SOLAROPS_SETUP_USER: the user running the service.
  if [[ -z "${GIVEN[user]:-}" ]] && [[ -z "$(env_value SOLAROPS_SETUP_USER)" ]]; then
    unit_user="$(sed -n 's/^User=//p' /etc/systemd/system/solarops.service | head -n 1)"

    if [[ -n "$unit_user" ]]; then
      SERVICE_USER="$unit_user"
    fi
  fi

  # The same kind of PostgreSQL server as last time, unless told otherwise.
  if [[ -z "${GIVEN[pg-host]:-}" ]] && [[ -z "${GIVEN[skip-postgres]:-}" ]]; then
    previous_postgres="$(env_value SOLAROPS_SETUP_POSTGRES)"
    previous_pg_host="$(env_value SOLAROPS_PG_HOST)"

    # Setups older than SOLAROPS_SETUP_POSTGRES: deduced from the host.
    if [[ -z "$previous_postgres" ]]; then
      previous_postgres=local

      if [[ -n "$previous_pg_host" ]] && [[ "$previous_pg_host" != 127.0.0.1 ]] && [[ "$previous_pg_host" != localhost ]]; then
        previous_postgres=external
      fi
    fi

    case "$previous_postgres" in
      external)
        PG_EXTERNAL_HOST="$previous_pg_host"
        keep_previous pg-port PG_EXTERNAL_PORT SOLAROPS_PG_PORT
        keep_previous pg-password PG_EXTERNAL_PASSWORD SOLAROPS_PG_PASSWORD
        ;;
      skip)
        SKIP_POSTGRES=true
        ;;
    esac
  fi

  keep_previous pg-user PG_ADMIN_ROLE SOLAROPS_PG_USER
fi

if [[ "$UPDATE_MODE" == true ]]; then
  if [[ "$PREVIOUS_SETUP" == false ]]; then
    fail "SolarOps is not set up on this server yet: run npm run setup first."
  fi

  if [[ ${#GIVEN[@]} -gt 0 ]]; then
    fail "npm run update keeps the setup as it is: change options with npm run setup."
  fi
fi

# What the PostgreSQL step does (a run given --pg-host and --skip-postgres connects).
PG_MODE=local

if [[ -n "$PG_EXTERNAL_HOST" ]]; then
  PG_MODE=external
elif [[ "$SKIP_POSTGRES" == true ]]; then
  PG_MODE=skip
fi

BASE_FOLDER="${BASE_FOLDER%/}"
SERVICE_HOME="/home/${SERVICE_USER}"

# ─────────────────────────────── Checks ─────────────────────────────────

if [[ "$UPDATE_MODE" == true ]]; then
  step "Pre-flight checks (update: the setup is kept as it is)"
else
  step "Pre-flight checks"
fi

# The arguments are not logged: they may hold --pg-password.
touch "$INSTALL_LOG"
chmod 600 "$INSTALL_LOG"
printf '\n===== SolarOps installation, %s =====\n' "$(date -Is)" >> "$INSTALL_LOG"

if ! command -v apt-get > /dev/null; then
  fail "This script supports Debian / Ubuntu (apt) only."
fi

# shellcheck source=/dev/null
source /etc/os-release
info "System: ${PRETTY_NAME}"
info "SolarOps sources: ${APP_DIR}"

if [[ ! "$BASE_FOLDER" = /* ]] || [[ ! "$DATA_DIR" = /* ]]; then
  fail "--base-folder and --data-dir must be absolute paths."
fi

if [[ -n "$PG_EXTERNAL_HOST" ]] && [[ -z "$PG_EXTERNAL_PASSWORD" ]]; then
  fail "--pg-host requires --pg-password."
fi

if ! command -v dpkg-query > /dev/null; then
  fail "dpkg is missing: this script supports Debian / Ubuntu only."
fi

if [[ "$PREVIOUS_SETUP" == true ]]; then
  pg_label="local server"

  if [[ "$PG_MODE" == external ]]; then
    pg_label="${PG_EXTERNAL_HOST}:${PG_EXTERNAL_PORT}"
  elif [[ "$PG_MODE" == skip ]]; then
    pg_label="not managed"
  fi

  info "Previous setup kept, except the options given: port ${PORT} on ${LISTEN_HOST}, projects in ${BASE_FOLDER},"
  info "data in ${DATA_DIR}, user ${SERVICE_USER}, PostgreSQL ${pg_label} (role ${PG_ADMIN_ROLE})"
fi

success "Ready for liftoff"
info "Detailed output: ${INSTALL_LOG} (follow it with tail -f from another shell)"

# ─────────────────────────────── Domain ─────────────────────────────────

# Read an answer from the terminal (else from the standard input: the test
# bench pipes its answers, echoed so the log reads like a session).
ask() {
  local answer=""

  printf "  %s " "$1" >&2
  read -r answer || true

  if [[ ! -t 0 ]]; then
    printf '%s\n' "$answer" >&2
  fi

  printf '%s' "$answer"
}

if [[ "$UPDATE_MODE" == false ]] && [[ "$DEPS_ONLY" == false ]]; then
  step "SolarOps's own domain"
  info "SolarOps can have a domain of its own, served over HTTPS (Let's Encrypt): it must point to this server."

  if [[ "$PREVIOUS_SETUP" == true ]]; then
    info "Leave it empty to keep SolarOps's current address."
  else
    info "Leave it empty to reach SolarOps through an SSH tunnel only (a domain can be added later)."
  fi

  while true; do
    DOMAIN="$(ask "Domain (e.g. ops.example.com):")"
    DOMAIN="${DOMAIN,,}"

    if [[ -z "$DOMAIN" ]] || [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; then
      break
    fi

    warn "\"${DOMAIN}\" is not a domain name."

    if [[ ! -t 0 ]]; then
      fail "Invalid domain."
    fi
  done

  if [[ -n "$DOMAIN" ]]; then
    while true; do
      EMAIL="$(ask "E-mail for Let's Encrypt (expiry notices):")"

      if [[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
        break
      fi

      warn "\"${EMAIL}\" is not an e-mail address."

      if [[ ! -t 0 ]]; then
        fail "Invalid e-mail."
      fi
    done
  fi
fi

# ─────────────────────────────── OS packages ────────────────────────────

step "OS packages (only the missing ones are installed)"

export DEBIAN_FRONTEND=noninteractive
# needrestart (Ubuntu) only lists the services to restart: the server's
# running services are never restarted by this script.
export NEEDRESTART_MODE=l

apt_install_missing ca-certificates curl gnupg build-essential python3 sudo openssl acl
success "Base tools: ca-certificates, curl, gnupg, build tools, python3, sudo, openssl, acl"

if has_command git; then
  git_version="$(git --version | awk '{print $3}')"
  require_version git "$git_version" "$MIN_GIT"
  success "git ${git_version} already installed: kept as is"
else
  apt_install_missing git
  success "git $(git --version | awk '{print $3}') installed"
fi

if has_command nginx; then
  nginx_version="$(nginx -v 2>&1 | sed -E 's|.*nginx/([0-9.]+).*|\1|')"
  require_version nginx "$nginx_version" "$MIN_NGINX"
  success "nginx ${nginx_version} already installed: kept as is"
else
  apt_install_missing nginx
  success "nginx $(nginx -v 2>&1 | sed -E 's|.*nginx/([0-9.]+).*|\1|') installed"
fi

certbot_from_apt=true

if has_command certbot; then
  certbot_version="$(certbot --version 2>&1 | awk '{print $2}')"
  require_version certbot "$certbot_version" "$MIN_CERTBOT"
  success "certbot ${certbot_version} already installed: kept as is"

  # A snap / pip certbot does not see the plugins installed with apt.
  if ! is_installed certbot && ! is_installed python3-certbot; then
    certbot_from_apt=false
  fi
else
  apt_install_missing certbot
  success "certbot $(certbot --version 2>&1 | awk '{print $2}') installed"
fi

if [[ "$certbot_from_apt" == true ]]; then
  for plugin in python3-certbot-dns-ovh python3-certbot-dns-cloudflare python3-certbot-dns-digitalocean; do
    install_optional_package "$plugin"
  done
else
  warn "certbot does not come from apt (snap?): its DNS plugins are not installed here. For DNS-01, add them the same way (e.g. snap install certbot-dns-ovh)."
fi

if [[ -n "$PG_EXTERNAL_HOST" ]]; then
  # External server: only pg_dump / pg_restore / psql are needed here.
  # Their major version must be >= the server's (checked once connected).
  if has_command pg_dump; then
    success "PostgreSQL client $(pg_dump --version | awk '{print $3}') already installed: kept as is"
  else
    apt_install_missing postgresql-client
    success "PostgreSQL client $(pg_dump --version | awk '{print $3}') installed (server: ${PG_EXTERNAL_HOST})"
  fi
elif [[ "$SKIP_POSTGRES" == false ]]; then
  # Any PostgreSQL server already there is used as is (version checked below).
  if compgen -G "/usr/lib/postgresql/*/bin/postgres" > /dev/null || has_command postgres; then
    success "PostgreSQL server already installed: kept as is"
  else
    apt_install_missing postgresql postgresql-contrib
    success "PostgreSQL installed"
  fi

  if ! has_command pg_dump; then
    apt_install_missing postgresql-client
  fi
fi

systemctl enable --now nginx > /dev/null 2>&1
success "nginx enabled"

# ─────────────────────────────── Node.js & pm2 ──────────────────────────

step "Node.js, npm, pm2, pnpm and yarn"

# Node.js is installed beforehand, for the whole system (README): the
# script never installs nor upgrades it.
if ! has_command node; then
  fail "Node.js ${NODE_MAJOR} is not installed. Install it for the whole system first (not with nvm), e.g. from NodeSource (https://github.com/nodesource/distributions), then run this again."
fi

node_version="$(node -p 'process.versions.node')"
require_version Node.js "$node_version" "${NODE_MAJOR}.0.0"
success "Node.js ${node_version}"

if ! has_command npm; then
  fail "Node.js is installed without npm: install npm ${MIN_NPM} or later, then run this script again."
fi

npm_version="$(npm --version)"
require_version npm "$npm_version" "$MIN_NPM"
success "npm ${npm_version}"

if has_command pm2; then
  pm2_version="$(pm2 --version 2> /dev/null | tail -n 1)"
  require_version pm2 "$pm2_version" "$MIN_PM2"
  success "pm2 ${pm2_version} already installed: kept as is"
else
  info "Installing pm2…"
  run_logged npm install --global --no-fund --no-audit pm2@latest
  success "pm2 $(pm2 --version 2> /dev/null | tail -n 1) installed"
fi

# pnpm and yarn for the projects using them (detected at deploy time from
# package.json and lockfiles). Existing ones are kept; missing ones come
# from corepack, which downloads, per project, the exact version pinned in
# the "packageManager" field. corepack ships with Node.js up to 24; later
# versions no longer bundle it: it is then installed from npm.
missing_tools=()

for tool in pnpm yarn; do
  if has_command "$tool"; then
    tool_version="$(COREPACK_ENABLE_DOWNLOAD_PROMPT=0 timeout 120 "$tool" --version 2> /dev/null | tail -n 1 || true)"

    if [[ ! "$tool_version" =~ ^[0-9]+\.[0-9]+ ]]; then
      fail "A \"${tool}\" command exists ($(command -v "$tool")) but is not ${tool} (on Debian, the cmdtest package installs an unrelated yarn): remove it, then run this script again."
    fi

    success "${tool} ${tool_version} already installed: kept as is"
  else
    missing_tools+=("$tool")
  fi
done

if [[ ${#missing_tools[@]} -gt 0 ]]; then
  if ! has_command corepack; then
    info "Installing corepack…"
    run_logged npm install --global --no-fund --no-audit corepack
  fi

  corepack enable "${missing_tools[@]}"
  success "${missing_tools[*]} available through corepack $(corepack --version)"
fi

if [[ "$DEPS_ONLY" == true ]]; then
  step "Done"
  success "Dependencies installed (--deps-only)."
  exit 0
fi

# ─────────────────────────────── User & folders ─────────────────────────

step "Preparing the ${SERVICE_USER} user and folders"

if ! id "$SERVICE_USER" > /dev/null 2>&1; then
  useradd --system --create-home --home-dir "$SERVICE_HOME" --shell /bin/bash "$SERVICE_USER"
  success "User ${SERVICE_USER} created"
else
  success "User ${SERVICE_USER} exists"
fi

# Node.js and pm2 must be installed for the whole system (not with nvm in
# a user folder): SolarOps and the projects run as ${SERVICE_USER}.
for tool in node pm2; do
  if ! sudo -u "$SERVICE_USER" -H sh -c "command -v $tool" > /dev/null; then
    fail "${tool} ($(command -v "$tool")) cannot be run by ${SERVICE_USER}: install it system-wide (e.g. in /usr/bin), then run this script again."
  fi
done

# Projects: traversable by the nginx workers (static files, ACME challenges).
# An existing base folder keeps its owner, group and mode (e.g. /var/www,
# created by the nginx package and owned by root). If SolarOps cannot write
# in it, the service user only gets an ACL entry, nothing else changes.
if [[ -d "$BASE_FOLDER" ]]; then
  success "Base folder ${BASE_FOLDER} already exists: owner and permissions kept"

  if ! sudo -u "$SERVICE_USER" test -w "$BASE_FOLDER"; then
    if setfacl -m "u:${SERVICE_USER}:rwx" "$BASE_FOLDER"; then
      success "${SERVICE_USER} may create project folders in ${BASE_FOLDER} (ACL entry added)"
    else
      warn "${SERVICE_USER} cannot write in ${BASE_FOLDER} and the ACL could not be added."
      warn "To let it create projects there: sudo setfacl -m u:${SERVICE_USER}:rwx ${BASE_FOLDER}"
    fi
  fi
else
  install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 "$BASE_FOLDER"
  success "Base folder ${BASE_FOLDER} created"
fi

# Folders that predate SolarOps are adopted as they are: only report what
# would prevent SolarOps from managing them.
for existing_folder in "$BASE_FOLDER"/*/; do
  if [[ ! -d "$existing_folder" ]]; then
    continue
  fi

  if ! sudo -u "$SERVICE_USER" test -w "$existing_folder"; then
    warn "${existing_folder} is not writable by ${SERVICE_USER} (left untouched)."
  fi
done

# SolarOps state (database, master key): owner only.
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DATA_DIR"
# Database backups, taken by SolarOps itself before migrations: its own,
# even when an earlier update created the folder as root.
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DATA_DIR/backups"
chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR/backups"
success "Data folder ${DATA_DIR}"

if ! sudo -u "$SERVICE_USER" test -r "$APP_DIR/server/index.js"; then
  fail "${SERVICE_USER} cannot read ${APP_DIR}. Clone SolarOps in a readable place, e.g. /var/solarops."
fi

# ─────────────────────────────── Configuration ──────────────────────────

step "Writing ${APP_DIR}/.env"

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
fi

SYSTEMCTL_BIN="$(command -v systemctl)"
NGINX_BIN="$(command -v nginx || echo /usr/sbin/nginx)"

set_env_value NODE_ENV production
set_env_value SOLAROPS_HOST "$LISTEN_HOST"
set_env_value SOLAROPS_PORT "$PORT"
set_env_value SOLAROPS_DATA_DIR "$DATA_DIR"
set_env_value SOLAROPS_BASE_FOLDER "$BASE_FOLDER"
set_env_value SOLAROPS_NGINX_TEST_CMD "sudo -n ${NGINX_BIN} -t"
set_env_value SOLAROPS_NGINX_RELOAD_CMD "sudo -n ${SYSTEMCTL_BIN} reload nginx"
# Kept for the next runs (see "Previous setup").
set_env_value SOLAROPS_SETUP_USER "$SERVICE_USER"
set_env_value SOLAROPS_SETUP_POSTGRES "$PG_MODE"

chown root:"$SERVICE_USER" "$APP_DIR/.env"
chmod 0640 "$APP_DIR/.env"
success ".env ready (root:${SERVICE_USER}, 0640)"

# ─────────────────────────────── nginx ──────────────────────────────────

step "Connecting nginx to the project configurations"

# The include below loads <project>/etc/nginx.conf for every folder: report
# the files SolarOps did not generate (they are loaded, never modified).
for existing_config in "$BASE_FOLDER"/*/etc/nginx.conf; do
  if [[ -f "$existing_config" ]] && ! grep -q '^# Managed by SolarOps' "$existing_config"; then
    warn "${existing_config} was not generated by SolarOps: nginx will load it as is."
  fi
done

cat > /etc/nginx/conf.d/solarops.conf <<EOF
# Managed by SolarOps (deploy/install.sh).
# Every project writes its own server blocks in <project>/etc/nginx.conf.
include ${BASE_FOLDER}/*/etc/nginx.conf;
EOF
success "/etc/nginx/conf.d/solarops.conf"

# Long domain names need a larger hash bucket (only if not already set).
if ! grep -RqsE '^\s*server_names_hash_bucket_size' /etc/nginx/nginx.conf /etc/nginx/conf.d/; then
  echo "server_names_hash_bucket_size 128;" > /etc/nginx/conf.d/00-solarops-hash.conf
  success "server_names_hash_bucket_size 128"
fi

# Allow SolarOps to validate and reload nginx — and nothing else.
SUDOERS_FILE="/etc/sudoers.d/solarops"
cat > "${SUDOERS_FILE}.tmp" <<EOF
# Managed by SolarOps (deploy/install.sh): validate and reload nginx only.
${SERVICE_USER} ALL=(root) NOPASSWD: ${NGINX_BIN} -t, ${SYSTEMCTL_BIN} reload nginx
EOF

if visudo -cf "${SUDOERS_FILE}.tmp" > /dev/null; then
  install -m 0440 "${SUDOERS_FILE}.tmp" "$SUDOERS_FILE"
  rm -f "${SUDOERS_FILE}.tmp"
  success "sudo rule ${SUDOERS_FILE}"
else
  rm -f "${SUDOERS_FILE}.tmp"
  fail "Generated sudoers rule is invalid."
fi

"$NGINX_BIN" -t > /dev/null 2>&1 || fail "nginx configuration is invalid: run 'nginx -t' to see why."
systemctl reload nginx
success "nginx configuration valid and reloaded"

if command -v ufw > /dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' > /dev/null
  success "Firewall (ufw): HTTP and HTTPS allowed"
fi

# ─────────────────────────────── PostgreSQL ─────────────────────────────

if [[ -n "$PG_EXTERNAL_HOST" ]]; then
  step "Connecting to PostgreSQL at ${PG_EXTERNAL_HOST}:${PG_EXTERNAL_PORT}"

  set_env_value SOLAROPS_PG_HOST "$PG_EXTERNAL_HOST"
  set_env_value SOLAROPS_PG_PORT "$PG_EXTERNAL_PORT"
  set_env_value SOLAROPS_PG_USER "$PG_ADMIN_ROLE"
  set_env_value SOLAROPS_PG_PASSWORD "$PG_EXTERNAL_PASSWORD"

  if server_version_num="$(PGPASSWORD="$PG_EXTERNAL_PASSWORD" PGCONNECT_TIMEOUT=10 psql -h "$PG_EXTERNAL_HOST" \
    -p "$PG_EXTERNAL_PORT" -U "$PG_ADMIN_ROLE" -d postgres -tAc 'SHOW server_version_num' 2> /dev/null)"; then
    check_postgres_versions "$server_version_num"
    success "Connected as ${PG_ADMIN_ROLE} — credentials stored in .env"
  else
    warn "Could not connect as ${PG_ADMIN_ROLE}: check the server, then fix it in SolarOps › PostgreSQL."
  fi
elif [[ "$SKIP_POSTGRES" == false ]]; then
  step "Configuring PostgreSQL"

  # A server without the usual systemd unit (custom install) is used as is.
  if systemctl cat postgresql.service > /dev/null 2>&1; then
    systemctl enable --now postgresql > /dev/null 2>&1
  fi

  if ! id postgres > /dev/null 2>&1; then
    fail "PostgreSQL is not run by the postgres system user (container, custom install?): use --pg-host 127.0.0.1 --pg-user <admin role> --pg-password <password>."
  fi

  check_postgres_versions "$(run_psql -tAc 'SHOW server_version_num')"

  # A password in .env only belongs to the role stored with it.
  stored_password=""

  if [[ "$(env_value SOLAROPS_PG_USER)" == "$PG_ADMIN_ROLE" ]]; then
    stored_password="$(env_value SOLAROPS_PG_PASSWORD)"
  fi

  role_exists="$(run_psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '${PG_ADMIN_ROLE}'")"

  if [[ "$role_exists" != "1" ]]; then
    PG_PASSWORD="${PG_EXTERNAL_PASSWORD:-${stored_password:-$(random_secret 40)}}"
    run_psql -q -c "CREATE ROLE ${PG_ADMIN_ROLE} WITH LOGIN CREATEDB CREATEROLE PASSWORD '${PG_PASSWORD}'"
    success "Role ${PG_ADMIN_ROLE} created (CREATEDB, CREATEROLE)"
  else
    # An existing role is never modified, only checked: with --pg-password,
    # or the password a previous run stored in .env.
    PG_PASSWORD="${PG_EXTERNAL_PASSWORD:-$stored_password}"

    if [[ -z "$PG_PASSWORD" ]]; then
      fail "The role ${PG_ADMIN_ROLE} already exists and was not created by SolarOps: pass its password with --pg-password (it is not modified), or choose another --pg-user."
    fi

    if ! PGPASSWORD="$PG_PASSWORD" psql -h 127.0.0.1 -U "$PG_ADMIN_ROLE" -d postgres -tAc 'SELECT 1' > /dev/null 2>&1; then
      fail "Could not sign in as ${PG_ADMIN_ROLE} on 127.0.0.1 with the password given (--pg-password or .env): check it (the role is not modified)."
    fi

    privileges="$(run_psql -tAc "SELECT rolcreatedb AND rolcreaterole FROM pg_roles WHERE rolname = '${PG_ADMIN_ROLE}'")"

    if [[ "$privileges" != "t" ]]; then
      fail "The existing role ${PG_ADMIN_ROLE} lacks CREATEDB or CREATEROLE: grant them yourself (it is not modified), or choose another --pg-user."
    fi

    success "Existing role ${PG_ADMIN_ROLE} (CREATEDB, CREATEROLE) used as is"
  fi

  set_env_value SOLAROPS_PG_HOST 127.0.0.1
  set_env_value SOLAROPS_PG_PORT 5432
  set_env_value SOLAROPS_PG_USER "$PG_ADMIN_ROLE"
  set_env_value SOLAROPS_PG_PASSWORD "$PG_PASSWORD"
  success "Credentials of ${PG_ADMIN_ROLE} stored in .env"
fi

# ─────────────────────────────── SolarOps ──────────────────────────────

step "Building SolarOps"

cd "$APP_DIR"
info "Installing the dependencies and building the UI (a few minutes)…"
run_logged npm ci --no-fund --no-audit
run_logged npm run build
success "Dependencies installed and UI built"

# Sources stay owned by root: SolarOps can read but not modify its own code.
chmod -R go-w "$APP_DIR"

step "Configuring pm2 startup"

# The pm2 daemon runs in its own systemd unit, so restarting SolarOps
# never stops the projects.
env PATH="$PATH" pm2 startup systemd -u "$SERVICE_USER" --hp "$SERVICE_HOME" > /dev/null
systemctl enable "pm2-${SERVICE_USER}" > /dev/null 2>&1
PM2_UNIT_READY=true

if ! systemctl is-active --quiet "pm2-${SERVICE_USER}"; then
  if sudo -u "$SERVICE_USER" -H pm2 ping > /dev/null 2>&1; then
    # A daemon started by hand (pm2 update, pm2 resurrect...) runs outside
    # the unit: systemd refuses to adopt it, and stopping it would stop
    # every project. It is left as is.
    PM2_UNIT_READY=false
    warn "pm2 runs outside pm2-${SERVICE_USER}.service (started by hand, e.g. with pm2 update): the projects run, and the service takes over at the next reboot."
    warn "To hand it over now (each project restarts for a few seconds): sudo -u ${SERVICE_USER} -H pm2 save && sudo -u ${SERVICE_USER} -H pm2 kill && sudo systemctl restart pm2-${SERVICE_USER}"
  elif ! systemctl start "pm2-${SERVICE_USER}"; then
    systemctl status "pm2-${SERVICE_USER}" --no-pager -l 2>&1 | tail -n 15 >&2 || true
    fail "pm2-${SERVICE_USER}.service does not start: see the lines above (journalctl -u pm2-${SERVICE_USER})."
  fi
fi

sudo -u "$SERVICE_USER" -H pm2 save --force > /dev/null 2>&1 || true

if [[ "$PM2_UNIT_READY" == true ]]; then
  success "pm2-${SERVICE_USER}.service enabled and running"
else
  success "pm2-${SERVICE_USER}.service enabled (takes over at the next reboot)"
fi

step "Configuring pm2 log rotation"

# Without it, project logs (<project>/logs/*.log) and pm2's own log grow
# forever. pm2-logrotate rotates every file pm2 writes, wherever it is:
# above LOG_MAX_SIZE, and every night; rotated files are compressed.
# An existing pm2-logrotate keeps its settings, unless --log-max-size or
# --log-retain are given.
configure_logrotate="$LOG_OPTIONS_GIVEN"

if [ ! -d "${SERVICE_HOME}/.pm2/modules/pm2-logrotate" ]; then
  run_logged sudo -u "$SERVICE_USER" -H pm2 install pm2-logrotate
  configure_logrotate=true
fi

if [[ "$configure_logrotate" == true ]]; then
  sudo -u "$SERVICE_USER" -H pm2 set pm2-logrotate:max_size "$LOG_MAX_SIZE" > /dev/null
  sudo -u "$SERVICE_USER" -H pm2 set pm2-logrotate:retain "$LOG_RETAIN" > /dev/null
  sudo -u "$SERVICE_USER" -H pm2 set pm2-logrotate:compress true > /dev/null
  sudo -u "$SERVICE_USER" -H pm2 set pm2-logrotate:rotateInterval '0 0 * * *' > /dev/null
  sudo -u "$SERVICE_USER" -H pm2 save --force > /dev/null 2>&1 || true
  success "pm2-logrotate: above ${LOG_MAX_SIZE} or nightly, ${LOG_RETAIN} compressed files kept"
else
  success "pm2-logrotate already installed: its settings are kept (--log-max-size / --log-retain change them)"
fi

step "Installing the SolarOps service"

NODE_BIN="$(command -v node)"

cat > /etc/systemd/system/solarops.service <<EOF
[Unit]
Description=SolarOps — mission control for your projects
Documentation=file://${APP_DIR}/README.md
After=network-online.target nginx.service postgresql.service pm2-${SERVICE_USER}.service
Wants=network-online.target pm2-${SERVICE_USER}.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PM2_HOME=${SERVICE_HOME}/.pm2
# Only stop SolarOps itself: builds and pm2 must survive a restart.
KillMode=process
# Hardening that keeps git, npm, pm2, certbot and "sudo nginx -t" working
# (NoNewPrivileges is deliberately not set: it would disable sudo).
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

cat > /usr/local/bin/solarops <<EOF
#!/bin/sh
# SolarOps CLI: always runs as the ${SERVICE_USER} user.
if [ "\$(id -un)" = "${SERVICE_USER}" ]; then
  exec ${NODE_BIN} ${APP_DIR}/bin/solarops.js "\$@"
fi
exec sudo -u ${SERVICE_USER} -H -- ${NODE_BIN} ${APP_DIR}/bin/solarops.js "\$@"
EOF
chmod 0755 /usr/local/bin/solarops

systemctl daemon-reload
systemctl enable solarops > /dev/null 2>&1
STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
systemctl restart solarops
success "solarops.service started"
success "CLI available: sudo solarops help"

# ─────────────────────────────── Certificate renewal ────────────────────

step "Scheduling certificate renewal"

# SolarOps renews certificates itself; this daily timer is the safety net
# for when SolarOps is down (SolarOps's own certificate included).
cat > /etc/systemd/system/solarops-certs.service <<EOF
[Unit]
Description=SolarOps — renew due certificates
After=network-online.target nginx.service

[Service]
Type=oneshot
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
Environment=PM2_HOME=${SERVICE_HOME}/.pm2
ExecStart=${NODE_BIN} ${APP_DIR}/bin/solarops.js certs:renew
EOF

cat > /etc/systemd/system/solarops-certs.timer <<EOF
[Unit]
Description=SolarOps — daily certificate renewal

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now solarops-certs.timer > /dev/null 2>&1
success "solarops-certs.timer enabled (daily)"

# ─────────────────────────────── Own domain ─────────────────────────────

DOMAIN_READY=false

if [[ -n "$DOMAIN" ]]; then
  step "Exposing SolarOps on https://${DOMAIN}"

  # SolarOps is its own "system" project: its nginx config and certificate
  # live in ${BASE_FOLDER}/solarops/etc, like any project's.
  sleep 2

  if /usr/local/bin/solarops domain:set "$DOMAIN" --email "$EMAIL"; then
    DOMAIN_READY=true
    success "https://${DOMAIN} is live"
  else
    warn "SolarOps could not get its certificate yet (does ${DOMAIN} point to this server?)."
    warn "Fix the DNS, then run: sudo solarops domain:set ${DOMAIN} --email ${EMAIL}"
  fi
fi

# ─────────────────────────────── Summary ────────────────────────────────

if [[ "$UPDATE_MODE" == true ]]; then
  step "Setup applied"
else
  step "Mission accomplished 🚀"
fi

sleep 3
# A new setup token is printed at each start while no admin exists.
# (journald drops blank lines: the token is the first non-empty line after the header.)
SETUP_TOKEN="$(journalctl -u solarops --since "$STARTED_AT" --no-pager -o cat 2> /dev/null \
  | awk '/one-time token/ { found = 1; next } found && NF { print $1; exit }' || true)"

URL="$(/usr/local/bin/solarops domain:show 2> /dev/null || true)"

if [[ "$DOMAIN_READY" == true ]]; then
  URL="https://${DOMAIN}"
elif [[ -z "$URL" ]]; then
  URL="http://127.0.0.1:${PORT}  (tunnel it: ssh -L ${PORT}:127.0.0.1:${PORT} you@server)"
fi

info "SolarOps:        ${URL}"
info "Projects folder:  ${BASE_FOLDER}"
info "Data folder:      ${DATA_DIR}  (back it up, it holds the master key)"
info "Commands:         npm run start | stop | restart | update  (in ${APP_DIR})"
info "This setup is kept: npm run update never changes it, npm run setup only changes the options you pass."

if [[ -n "$SETUP_TOKEN" ]]; then
  info ""
  info "Open ${URL%% *}/setup and use this one-time setup token:"
  printf "\n      ${COLOR_BOLD}${COLOR_CYAN}%s${COLOR_RESET}\n\n" "$SETUP_TOKEN"
  info "Or create the admin from the shell: sudo solarops admin:create you@example.com"
else
  info "Logs:             journalctl -u solarops -f"
fi
