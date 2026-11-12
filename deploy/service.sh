#!/usr/bin/env bash
#
# SolarOps service commands, run by npm:
#   npm run start     start the solarops service, and wait until it answers
#   npm run stop      stop it
#   npm run restart   stop and start it, and wait until it answers
#
# Only SolarOps itself is concerned: the projects keep running (pm2 runs
# them in its own service). To run SolarOps in the foreground instead (no
# service), use npm run serve.

set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=deploy/common.sh
source "$APP_DIR/deploy/common.sh"

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

COMMAND="${1:-}"

case "$COMMAND" in
  start | stop | restart) ;;
  *) usage ;;
esac

if ! command -v systemctl > /dev/null; then
  fail "systemctl not found: these commands drive the SolarOps service of a server. Here, use npm run dev or npm run serve."
fi

if ! service_installed; then
  fail "The solarops service is not installed: run npm run setup first."
fi

become_root "$@"

case "$COMMAND" in
  start)
    if systemctl is-active --quiet "$SERVICE"; then
      info "SolarOps is already running."
    else
      systemctl start "$SERVICE"
    fi

    wait_until_up || exit 1
    ;;
  stop)
    systemctl stop "$SERVICE"
    success "SolarOps stopped. The projects keep running (pm2): start it again with npm run start."
    ;;
  restart)
    systemctl restart "$SERVICE"
    wait_until_up || exit 1
    ;;
esac
