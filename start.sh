#!/usr/bin/env sh
# macOS/Linux equivalent of start.bat (development convenience).
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/pip install -q -r backend/requirements.txt
if [ ! -f frontend/dist/index.html ] || [ "$1" = "--rebuild" ]; then
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi
[ -f .env ] || cp .env.example .env
exec .venv/bin/python backend/run.py
