# AGENTS.md — @diplatonib/opencode-remote-config

## Архитектура и поведение

- **Кэш хранится в `~/.cache/opencode/remote-config/config.json`** — реальный путь пользователя, не temp. Все тесты (unit и e2e) пишут/чтут этот файл. Чистить кэш в `beforeEach/afterEach` обязательно.
- **`mergeRemoteConfig` делает deep-merge для `provider` и `mcp`** — вложенные объекты сливаются рекурсивно с приоритетом локальных значений. Скаляры и массивы не перезаписываются, если уже есть в local.
- **Remote = base, local = priority** — remote заполняет только те поля, которых нет в local (`localConfig[field] === undefined`). Local никогда не перезаписывается.
- **Порядок config-хука**: сначала применяется кэш (remote as base), потом fetch (remote as base). При падении fetch кэш уже влился — это intentional fallback.
- **`process.env.OPENCODE_REMOTE_CONFIG_ADDRESS`** — единственный способ переопределить URL сервера. В тестах восстанавливать через `try/finally`.

## Тестирование

- **`AbortSignal.timeout` мокать отдельно от `fetch`** — таймаут 5s в `loadRemoteConfig`. Для теста таймаута: `vi.spyOn(AbortSignal, 'timeout').mockReturnValue(abortController.signal)`.
- **`vi.restoreAllMocks()` в `beforeEach`** обязателен — без него моки `AbortSignal.timeout` и `globalThis.fetch` утекают между тестами.
- **`sequence.concurrent: false` в vitest.config.ts критичен** — тесты кэша гонятся за одним файлом; без флага — race condition.
- **`@/` alias в vitest.config.ts** маппит на `src/` — импорты в тестах используют `@/utils`, `@/main`.
- **E2E-тесты поднимают локальный mock-сервер** (`node:http`, случайный порт, адрес через `OPENCODE_REMOTE_CONFIG_ADDRESS`) — внешняя сеть не требуется.

## Разработка

- **Opencode исполнит TypeScript напрямую** — `"main": "src/main.ts"`, без билд-шага. Не нужно компилировать в JS.
- **Локальный тест плагина**: `opencode.json` в корне репозитория с `"plugin": ["."]` загружает плагин без установки.
- **`npm test` = `vitest run`**, **`npm run watch:test` = `vitest`** (watch-режим).

## Файлы, которые должны изменяться вместе

- `src/utils.ts` `fieldsToMerge` ↔ `tests/unit/plugin.test.ts` merge-тесты — добавление нового поля требует обновления обоих
- `src/utils.ts` `CACHE_TTL_MS` ↔ `tests/unit/plugin.test.ts` expire-тест — изменение TTL ломает тайминг теста
