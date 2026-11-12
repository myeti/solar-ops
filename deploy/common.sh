# Helpers shared by deploy/service.sh and deploy/update.sh (sourced, with
# APP_DIR set to the SolarOps folder).

SERVICE="solarops"
WAIT_SECONDS=40

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

# Read a KEY=value from the .env file (empty when absent).
env_value() {
  if [[ -f "$APP_DIR/.env" ]]; then
    grep -E "^$1=" "$APP_DIR/.env" | tail -n 1 | cut -d '=' -f 2- || true
  fi
}

# Whether SolarOps is installed as a service on this server.
service_installed() {
  command -v systemctl > /dev/null && systemctl cat "${SERVICE}.service" > /dev/null 2>&1
}

# Continue as root (npm runs as a regular user), with the same arguments.
become_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    exec sudo -- bash "$0" "$@"
  fi
}

# Wait until SolarOps answers on its port (returns 1 otherwise, after
# printing the last lines of its log).
wait_until_up() {
  local host
  local port
  local url
  local waited=0

  host="$(env_value SOLAROPS_HOST)"
  port="$(env_value SOLAROPS_PORT)"
  port="${port:-4100}"

  if [[ -z "$host" ]] || [[ "$host" == 0.0.0.0 ]]; then
    host=127.0.0.1
  fi

  while [[ $waited -lt $WAIT_SECONDS ]]; do
    if curl -fsS -o /dev/null --max-time 2 "http://${host}:${port}/api/auth/status" 2> /dev/null; then
      url="$(/usr/local/bin/solarops domain:show 2> /dev/null || true)"
      success "SolarOps is up: ${url:-http://${host}:${port}}"
      return 0
    fi

    # Given up by systemd (it keeps restarting a crashing service).
    if [[ $waited -ge 5 ]] && ! systemctl is-active --quiet "$SERVICE"; then
      break
    fi

    sleep 1
    waited=$((waited + 1))
  done

  printf "  ${COLOR_RED}✖ SolarOps does not answer. Last lines of its log:${COLOR_RESET}\n" >&2
  journalctl -u "$SERVICE" -n 25 --no-pager -o cat >&2 || true
  return 1
}
