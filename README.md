# @diplatonib/opencode-remote-config

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Плагин OpenCode для автоматической загрузки организационной конфигурации с HTTP-сервера и объединения с локальным конфигом при каждом запуске.

Плагин решает задачу централизованного управления конфигурацией opencode в команде: администратор публикует JSON-конфиг на HTTP-сервере, а плагин при каждом запуске opencode подтягивает его и объединяет с локальным конфигом пользователя. Локальные значения имеют приоритет — пользовательские переопределения не затираются.

## Возможности

- **Автоматическая загрузка** — конфиг скачивается при каждом запуске через `config` хук
- **Кэширование** — локальный кэш с TTL 30 минут
- **Graceful fallback** — при недоступности сервера используется кэшированный конфиг (включая устаревший)
- **Deep-merge** — вложенные объекты (`provider`, `mcp`) сливаются рекурсивно с приоритетом локальных значений
- **Исключения** — dot-notation пути, недоступные для перезаписи из удалённого конфига

## Быстрый старт

```bash
# 1. Установить плагин
opencode plugin github:diplatonib/opencode-remote-config

# 2. Указать адрес сервера конфигурации
export OPENCODE_REMOTE_CONFIG_ADDRESS="https://config.example.com/opencode.json"

# 3. Запустить opencode — конфиг применится автоматически
opencode
```

Проверка: `opencode debug config` покажет итоговую конфигурацию.

## Установка

### Через CLI

```bash
opencode plugin github:diplatonib/opencode-remote-config
```

### Из git-репозитория

```jsonc
// opencode.json или opencode.jsonc
{
  "plugin": [
    "github:diplatonib/opencode-remote-config"
  ]
}
```

### Из отдельного файла

```jsonc
// opencode.json или opencode.jsonc
{
  "plugin": [
    "plugins/remote-config.js"
  ]
}
```

## Настройка

### Параметры плагина

Параметры передаются вторым элементом массива в `"plugin"`:

```jsonc
// opencode.json или opencode.jsonc
{
  "plugin": [
    ["github:diplatonib/opencode-remote-config", {
      "address": "http://custom-server/opencode.json",
      "exclude": ["provider.example.apiKey"],
      "cache": true
    }]
  ]
}
```

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| `address` | `string` | — | URL сервера с удалённой конфигурацией (обязателен, если не задан `OPENCODE_REMOTE_CONFIG_ADDRESS`). Переопределяет `OPENCODE_REMOTE_CONFIG_ADDRESS` |
| `exclude` | `string[]` | `[]` | Dot-notation пути, исключаемые из слияния. Пример: `["provider.example.apiKey", "mcp.searxng.args"]` |
| `cache` | `boolean` | `true` | Включить/отключить кэширование. При `false` плагин всегда загружает свежую конфигурацию и не пишет в кэш |

### Переменные окружения

| Переменная | Описание |
|----------|----------|
| `OPENCODE_REMOTE_CONFIG_ADDRESS` | URL удалённой конфигурации (переопределяется параметром `address`) |

## Структура проекта

```
src/
├── main.ts        # Точка входа плагина (config hook)
└── utils.ts       # Загрузка, кэширование, deep-merge
tests/
├── unit/          # Unit-тесты утилит
└── e2e/           # Интеграционные тесты (локальный mock-сервер)
docs/
├── ARCHITECTURE.md
├── DEVELOPMENT.md
├── DEPLOYMENT.md
└── CHANGELOG.md
```

## Технологии

- **TypeScript** — исполняется opencode напрямую, без билд-шага
- **es-toolkit** — deep-merge (`toMerged`)
- **Vitest** — unit- и e2e-тесты (локальный mock-сервер `node:http`)
- **esbuild** — сборка бандла для дистрибуции файлом

## Документация

- [Архитектура](./docs/ARCHITECTURE.md) — поток конфигурации, реализация кэша, стратегия слияния, формат удалённого конфига, отладка
- [Разработка](./docs/DEVELOPMENT.md) — настройка окружения и запуск тестов
- [Развёртывание](./docs/DEPLOYMENT.md) — установка и требования к серверу конфигурации
- [История изменений](./docs/CHANGELOG.md)

## Участие в проекте

PR и issues приветствуются — см. [CONTRIBUTING.md](./CONTRIBUTING.md).

Сообщения об уязвимостях — [SECURITY.md](./SECURITY.md).

## Лицензия

[MIT](./LICENSE) © Dmitry Platonov
