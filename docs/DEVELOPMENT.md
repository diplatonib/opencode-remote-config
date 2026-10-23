# Разработка

## Требования

- Node.js >= 18
- npm

## Установка зависимостей

```bash
npm install
```

## Команды

| Команда | Описание |
|---------|----------|
| `npm test` | Все тесты (unit + e2e) |
| `npm run watch:test` | Watch-режим тестов |
| `npm run typecheck` | Проверка типов TypeScript |
| `npm run build` | Сборка бандла в `out/` (esbuild) |

## Тестирование

Unit- и e2e-тесты не требуют внешней сети: e2e-тесты поднимают локальный mock-сервер (`node:http`, случайный порт) и передают его адрес через `OPENCODE_REMOTE_CONFIG_ADDRESS`.

```bash
npx vitest run tests/unit/   # только unit
npx vitest run tests/e2e/    # только e2e
```

Кэш плагина пишется в реальный пользовательский путь `~/.cache/opencode/remote-config/config.json` — тесты чистят его в `beforeEach/afterEach`.

## Локальный запуск плагина

`opencode.json` в корне репозитория с `"plugin": ["."]` загружает плагин без установки:

```bash
OPENCODE_REMOTE_CONFIG_ADDRESS=http://localhost:8080/opencode.json opencode
```

## Соглашения

- Opencode исполняет TypeScript напрямую (`"main": "src/main.ts"`) — билд-шаг не нужен для работы плагина
- Внутренние импорты используют алиас `@/` → `src/` (настроен в `tsconfig.json` и `vitest.config.ts`)
- Ветки: `feat/<name>`, `fix/<name>` от `main`; коммиты — Conventional Commits
