#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Stop Mailroom
# @raycast.mode silent

# Optional parameters:
# @raycast.icon ./mailroom.png
# @raycast.packageName Mailroom
# @raycast.description Stop the local Mailroom server.

PORT="${MAILROOM_PORT:-4747}"
PIDS="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)"
if [ -z "${PIDS}" ]; then
  echo "Mailroom isn't running"
  exit 0
fi
kill ${PIDS}
echo "Mailroom stopped"
