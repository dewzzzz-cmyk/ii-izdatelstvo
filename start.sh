#!/bin/bash
# ИИ-Издательство v2.0 — стартовый скрипт для Linux/macOS
set -e

PORT="${PORT:-8787}"

echo "ИИ-Издательство v2.0"
echo "Запуск на http://localhost:$PORT"
echo "Для остановки: Ctrl+C"
echo ""

# Проверяем Node.js
if ! command -v node &> /dev/null; then
  echo "Ошибка: Node.js не найден. Установите с https://nodejs.org"
  exit 1
fi

NODE_VERSION=$(node --version | cut -d. -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Предупреждение: рекомендуется Node.js 18+, у вас $(node --version)"
fi

# Открываем браузер (не блокируем)
(sleep 2 && {
  if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:$PORT"
  elif command -v open &> /dev/null; then
    open "http://localhost:$PORT"
  fi
}) &

# Запускаем сервер
node server.js
