#!/bin/bash

# Required parameters:
# @raycast.schemaVersion 1
# @raycast.title Update Mailroom
# @raycast.mode compact

# Optional parameters:
# @raycast.icon ./mailroom.png
# @raycast.packageName Mailroom
# @raycast.description Install the newest mailroom*.zip from Downloads. Logins are kept.

MAILROOM_DIR="${MAILROOM_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ZIP="$(ls -t "${HOME}"/Downloads/mailroom*.zip 2>/dev/null | head -n 1)"
if [ -z "${ZIP}" ]; then
  echo "No mailroom*.zip in Downloads"
  exit 1
fi
TMP="$(mktemp -d)"
unzip -q -o "${ZIP}" -d "${TMP}" || { echo "Couldn't unzip ${ZIP}"; exit 1; }
SRC="${TMP}/mailroom"
[ -f "${SRC}/server.js" ] || { echo "Zip doesn't contain mailroom/server.js"; exit 1; }
# Copy everything except local data; the running server restarts itself when server.js changes.
rm -rf "${SRC}/.data"
( cd "${SRC}" && tar cf - . ) | ( cd "${MAILROOM_DIR}" && tar xf - ) || { echo "Copy failed"; exit 1; }
rm -rf "${TMP}"
mv "${ZIP}" "${HOME}/.Trash/" 2>/dev/null
echo "Mailroom updated from $(basename "${ZIP}")"
