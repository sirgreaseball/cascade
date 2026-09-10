#!/usr/bin/env sh
# Cascade - one-command start on macOS / Linux:  ./start.sh
# Installs dependencies the first time, builds an optimised version, opens the browser.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get the LTS version from https://nodejs.org and run this again."; exit 1; }
[ -d node_modules ] || { echo "Installing dependencies - first run only..."; npm install --no-audit --no-fund; }
echo "Building Cascade..."
npm run build
echo "Starting Cascade at http://localhost:3000"
( sleep 3; command -v open >/dev/null 2>&1 && open http://localhost:3000 || xdg-open http://localhost:3000 >/dev/null 2>&1 || true ) &
npm run start
