#!/bin/bash
# Double-click in Finder to start Mailroom and open it.
cd "$(dirname "$0")" || exit 1
bash ./raycast/open-mailroom.sh
