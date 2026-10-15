#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Open Mailroom
# @raycast.mode silent

# Optional parameters:
# @raycast.icon ./mailroom.png
# @raycast.packageName Mailroom
# @raycast.description Start the Mailroom server if it isn't running, then open it.

# Where the project lives. Defaults to the folder above this script.
MAILROOM_DIR="${MAILROOM_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PORT="${MAILROOM_PORT:-4747}"
URL="http://127.0.0.1:${PORT}"
LOG_DIR="${HOME}/.config/mailroom"

# Raycast runs scripts with a bare PATH, so look for node in the usual places.
export PATH="${HOME}/.homebrew/bin:/opt/homebrew/bin:/usr/local/bin:${HOME}/.volta/bin:${HOME}/.local/bin:${PATH}"
if ! command -v node >/dev/null 2>&1 && [ -s "${HOME}/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${HOME}/.nvm/nvm.sh" >/dev/null 2>&1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install it with: brew install node"
  exit 1
fi

# If something else is on the port (an old demo server, or a copy from another folder), stop it.
HEALTH="$(curl -fsS --max-time 1 "${URL}/health" 2>/dev/null)"
if [ -n "${HEALTH}" ]; then
  case "${HEALTH}" in
    *'"demo":false'*"\"dir\":\"${MAILROOM_DIR}\""*)
      # Same install: restart only if server.js changed since the server started (after an update).
      STARTED="$(printf '%s' "${HEALTH}" | sed -n 's/.*"started":\([0-9]*\).*/\1/p')"
      MTIME="$(stat -f %m "${MAILROOM_DIR}/server.js" 2>/dev/null || stat -c %Y "${MAILROOM_DIR}/server.js")"
      if [ -z "${STARTED}" ] || [ "$((MTIME * 1000))" -gt "${STARTED}" ]; then
        PIDS="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)"
        [ -n "${PIDS}" ] && kill ${PIDS} && sleep 0.5
      fi
      ;;
    *)
      PIDS="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)"
      [ -n "${PIDS}" ] && kill ${PIDS} && sleep 0.5
      ;;
  esac
fi

if ! curl -fsS --max-time 1 "${URL}/health" >/dev/null 2>&1; then
  mkdir -p "${LOG_DIR}"
  nohup node "${MAILROOM_DIR}/server.js" >>"${LOG_DIR}/server.log" 2>&1 &
  for _ in $(seq 1 50); do
    curl -fsS --max-time 1 "${URL}/health" >/dev/null 2>&1 && break
    sleep 0.1
  done
  if ! curl -fsS --max-time 1 "${URL}/health" >/dev/null 2>&1; then
    echo "Mailroom didn't start. See ${LOG_DIR}/server.log"
    exit 1
  fi
fi

# A Chrome app window feels like a real app (own Dock icon, no tabs). Set MAILROOM_BROWSER=default to skip it.
if [ "${MAILROOM_BROWSER:-app}" = "app" ] && [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="${URL}"
else
  open "${URL}"
fi
echo "Mailroom is open"
