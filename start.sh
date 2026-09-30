#!/usr/bin/env sh
# Последний поезд: локальный сервер
cd "$(dirname "$0")"
PORT=${PORT:-8080}
URL="http://localhost:$PORT/"
( sleep 2; (command -v xdg-open >/dev/null && xdg-open "$URL") || (command -v open >/dev/null && open "$URL") ) >/dev/null 2>&1 &
if command -v python3 >/dev/null; then exec python3 -m http.server "$PORT"; fi
if command -v npx >/dev/null; then exec npx --yes http-server -p "$PORT" -c-1 .; fi
echo "Нужен Python 3 или Node.js"
