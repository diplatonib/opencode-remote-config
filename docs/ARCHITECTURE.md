# Плагин Remote Config — Подробная документация

## Архитектура

### Структура модулей

```
src/
├── main.ts           # Точка входа плагина (экспорт по умолчанию)
└── utils.ts          # Внутренние утилиты (именованные экспорты для тестирования)

tests/
├── unit/
│   └── plugin.test.ts      # Unit-тесты (функции утилит)
└── e2e/
    ├── plugin.e2e.test.ts  # E2E-тесты (полный поток плагина)
    └── opencode.json       # Конфигурация для E2E-тестов
```

### Псевдонимы путей

Все внутренние импорты используют псевдоним `@/`, который разрешается в `src/`:

```typescript
// src/main.ts
import { fetchRemoteConfig } from "@/utils";

// tests/unit/plugin.test.ts
import { deepMergeConfigs } from "@/utils";

// tests/e2e/plugin.e2e.test.ts
import createPlugin from "@/main";
```

Псевдоним настроен как в `tsconfig.json` (`paths`), так и в `vitest.config.ts` (`resolve.alias`).

Разделение служит двум целям:
1. **Чистый публичный API** — `main.ts` экспортирует только `createPlugin` как экспорт по умолчанию
2. **Тестируемость** — `utils.ts` экспортирует отдельные функции для unit-тестирования

### Архитектурные решения

#### Почему hook `config`, а не hook `tool`?

Hook `config` вызывается OpenCode в процессе запуска при слиянии (merge) источников конфигурации. Это позволяет плагину изменять объединённую конфигурацию **до** её применения, делая удалённую конфигурацию прозрачной для пользователя.

Первоначальный подход с hook `tool` требовал ручного вызова (`opencode config pull`) и отдельного шага перезапуска, что было отклонено в пользу автоматического слияния.

#### Почему мутация на месте (in-place)?

Hook `config` получает объединённый объект конфигурации (`cfg`). Мутация на месте — это ожидаемый паттерн: OpenCode предполагает, что hook модифицирует конфигурацию напрямую, а не возвращает новый объект.

#### Почему кэш на основе mtime вместо metadata.json?

Первоначальный дизайн использовал отдельный `metadata.json` с полями `fetched_at`, `etag` и `ttl`. Это было упрощено до использования `mtime` файла для проверки TTL, что сократило количество операций ввода/вывода и устранило потенциальный источник несогласованности между двумя файлами.

## Поток конфигурации

### Последовательность выполнения

1. **OpenCode инициализирует плагины**
   - Вызывает `createPlugin()` из экспорта по умолчанию
   - Плагин выводит сообщение об инициализации в лог

2. **OpenCode объединяет источники конфигурации**
   - Встроенные значения по умолчанию → конфигурация пользователя → конфигурация проекта
   - Формирует промежуточный объединённый объект конфигурации

3. **OpenCode вызывает hook `config`**
   - Передаёт объединённый объект конфигурации в hook
   - Плагин выполняет следующую последовательность:

4. **Проверка кэша**
   - Считывает `~/.cache/opencode/remote-config/config.json`
   - Проверяет `mtime` файла относительно TTL в 30 минут
   - Если валиден: объединяет закэшированную конфигурацию в `cfg`

5. **Загрузка с удалённого сервера**
   - Загружает JSON из `OPENCODE_REMOTE_CONFIG_ADDRESS` (или значения по умолчанию)
   - Таймаут 10 секунд через `AbortSignal.timeout()`
   - При успехе: кэширует ответ, объединяет в `cfg`
   - При ошибке: выводит ошибку в лог, продолжает работу с тем, что было объединено на шаге 4

6. **OpenCode продолжает запуск**
   - Использует изменённый объект `cfg`
   - Пользователь не замечает разницы — удалённая конфигурация прозрачна

## Реализация кэша

### Расположение

```
~/.cache/opencode/remote-config/config.json
```

### Политика TTL

| Параметр | Значение |
|-----------|-------|
| TTL | 30 минут (1800 секунд) |
| Метод проверки | `mtime` файла через `fs.stat()` |
| Инвалидация | Автоматическая (истечение TTL) или ручная (удаление файла) |

### Поток попадания в кэш (cache hit)

```
loadCachedConfig()
  ├─ fs.stat() → получить mtime
  ├─ Date.now() - mtimeMs > 1800000?
  │   ├─ Да  → вернуть null (истёк)
  │   └─ Нет → readFile() → JSON.parse() → вернуть
  └─ catch → вернуть null (файл отсутствует, ошибка прав доступа и т.д.)
```

### Сценарии промаха кэша (cache miss)

| Сценарий | Результат |
|----------|--------|
| Первый запуск (файл кэша отсутствует) | `null` → загрузить с удалённого сервера |
| Кэш истёк (>5 мин) | `null` → загрузить с удалённого сервера |
| Отказ в доступе при чтении кэша | `null` → загрузить с удалённого сервера |
| Повреждённый JSON в файле кэша | `null` → загрузить с удалённого сервера |

## Стратегия слияния

### Семантика слияния

Слияние выполняется через `deepMergeConfigs` (es-toolkit `toMerged`): удалённая конфигурация служит базой, локальная — приоритетом.

Скалярные поля и массивы используют стратегию **заполнения (fill)** — удалённое значение применяется только если локальное отсутствует (`localConfig[field] === undefined`). Локальные значения никогда не перезаписываются.

Вложенные объекты (`provider`, `mcp`) сливаются **рекурсивно** с приоритетом локальных значений.

```typescript
// До слияния
cfg = { model: "local/model", provider: { local: {...} } }
remote = { model: "remote/model", provider: { remote: {...} } }

// После слияния
cfg = { model: "local/model", provider: { local: {...}, remote: {...} } }
// ← model сохранён (локальный приоритет), provider объединён рекурсивно
```

### Исключения из слияния (exclude)

Параметр `exclude` позволяет указать dot-notation пути, которые не должны быть затронуты удалённой конфигурацией. Исключённые пути сохраняются из локального конфига (или пропускаются, если локального значения нет).

```json
{
  "plugin": [["opencode-remote-config", {
    "exclude": ["provider.example.apiKey", "mcp.searxng.args"]
  }]]
}
```

| Сценарий | Поведение |
|----------|-----------|
| `provider.example.apiKey` есть в local | Значение local сохранено, remote проигнорировано |
| `provider.example.apiKey` только в remote | Ключ не добавлен в результат |
| `provider` целиком в `exclude` | Всё поле `provider` пропущено |
| Остальные пути | Мержатся как обычно |

### Локальные поля

Локальная конфигурация полностью сохраняется: поля, которых нет в удалённом конфиге, остаются нетронутыми — слияние не ограничено списком полей.

```typescript
// Локальная конфигурация содержит дополнительное поле
cfg = { model: "local/model", shell: "/bin/zsh" }
remote = { model: "remote/model" }
// → cfg.model сохранён (локальный приоритет), cfg.shell сохранён
```

## Обработка ошибок

### Ошибки загрузки

| Тип ошибки | Причина | Поведение |
|------------|-------|----------|
| `AbortSignal.timeout` | Сервер не ответил за 10 с | Перехвачено, записано в лог, fallback |
| `DOMException` | Сеть недоступна | Перехвачено, записано в лог, fallback |
| `Error: Failed to fetch remote config: 404` | Неверный URL | Перехвачено, записано в лог, fallback |
| `Error: Failed to fetch remote config: 500` | Ошибка сервера | Перехвачено, записано в лог, fallback |
| `SyntaxError` | Недействительный JSON в ответе | Перехвачено, записано в лог, fallback |

### Ошибки записи в кэш

Тихий сбой — `cacheRemoteConfig` перехватывает и выводит ошибки в лог, но никогда не выбрасывает исключение. Неудачная запись в кэш не влияет на текущую сессию.

### Полный поток обработки ошибок

```
config(cfg)
  ├─ loadCachedConfig()
  │   └─ успех → deepMergeConfigs(cfg, cached)
  │   └─ null  → пропустить
  │
  ├─ fetchRemoteConfig(url)
  │   ├─ успех → cacheRemoteConfig(remote)
  │   │          → deepMergeConfigs(cfg, remote)
  │   └─ ошибка → console.error(...)
  │                → продолжить (cfg неизменён на этом шаге)
  │
  └─ return (cfg может содержать закэшированные значения, удалённые значения или ни того, ни другого)
```

## Тестирование

### Unit-тесты (`tests/unit/plugin.test.ts`)

| Группа тестов | Тестов | Покрытие |
|------------|-------|----------|
| `fetchRemoteConfig` | 8 | Мок fetch, таймаут, 404, 500, сеть |
| `deepMergeConfigs` | 12 | Приоритет local, fill недостающих, exclude-пути, массивы |
| Операции с кэшем | 5 | Запись/чтение, пустой кэш, истечение TTL, повреждённый JSON |

### E2E-тесты (`tests/e2e/plugin.e2e.test.ts`)

Десять интеграционных тестов на локальном mock-сервере (`node:http`): полный поток config hook, graceful fallback, кэширование, отключение кэша, отсутствие адреса, запуск `opencode debug config`.

### Запуск тестов

```bash
npm test                    # Все тесты
npx vitest run tests/unit/  # Только unit-тесты
npx vitest run tests/e2e/   # Только E2E-тесты
```

## Переменные окружения

| Переменная | По умолчанию | Описание |
|----------|---------|-------------|
| `OPENCODE_REMOTE_CONFIG_ADDRESS` | — | URL удалённой конфигурации (переопределяется параметром `address`). Дефолта нет: адрес обязателен через env или параметр |

## Логирование

Весь вывод использует префикс `[opencode-remote-config]`:

```
[opencode-remote-config] Плагин инициализирован              # info
[opencode-remote-config] Используется закэшированная конфигурация  # info
[opencode-remote-config] Конфигурация успешно объединена       # info
[opencode-remote-config] Не удалось загрузить удалённую конфигурацию: ...  # error
[opencode-remote-config] Не удалось закэшировать конфигурацию: ...  # error
```

## Устранение неполадок

### Плагин не загружается

Проверьте логи запуска на наличие `[opencode-remote-config] Plugin initialized`. Если отсутствует, убедитесь:
- Массив `"plugin"` в конфигурации opencode указывает на правильный путь
- В `src/main.ts` есть `export default createPlugin`

### Конфигурация не объединяется

Ищите `[opencode-remote-config] Failed to load remote config:` в stderr. Распространённые причины:
- Сервер недоступен (проверьте сеть, убедитесь в правильности URL)
- Недействительный JSON в ответе (проверьте вывод сервера)
- Таймаут (сервер отвечает более 10 с)

### Кэш не работает

Проверьте наличие файла кэша и актуальность mtime:
```bash
ls -la ~/.cache/opencode/remote-config/config.json
stat ~/.cache/opencode/remote-config/config.json
```

Для принудительного обновления удалите кэш:
```bash
rm ~/.cache/opencode/remote-config/config.json
```

## Формат удалённого конфига

Удалённый сервер должен возвращать JSON со следующей структурой:

```json
{
  "model": "example/pro",
  "small_model": "example/fast",
  "default_agent": "plan",
  "share": "disabled",
  "enabled_providers": ["example"],
  "provider": {
    "example": {
      "name": "EXAMPLE 🔒",
      "apiBase": "https://api.example.com",
      "apiKey": "${EXAMPLE_API_KEY}"
    }
  },
  "mcp": {
    "searxng": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-searxng"]
    },
    "context7": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-context7"]
    }
  }
}
```

### Поддерживаемые поля

| Поле | Описание | Поведение merge |
|------|----------|-----------------|
| `model` | Основная модель | Override — заменяет локальное значение |
| `small_model` | Быстрая модель для простых задач | Override — заменяет локальное значение |
| `default_agent` | Агент по умолчанию | Override — заменяет локальное значение |
| `share` | Настройки шаринга сессий | Override — заменяет локальное значение |
| `provider` | Конфигурация провайдеров моделей | Override — заменяет локальное значение |
| `enabled_providers` | Список разрешённых провайдеров | Override — заменяет локальное значение |
| `mcp` | Конфигурация MCP-серверов | Override — заменяет локальное значение |

Все остальные поля из удалённого конфига игнорируются. Локальные поля, не входящие в список выше, сохраняются без изменений.

## API плагина

### `createPlugin()`

Функция-фабрика плагина. Возвращает объект с `config` хуком.

```typescript
import type { Plugin } from "@opencode-ai/plugin";

async function createPlugin(): Promise<Plugin>
```

**Возвращает:**
```typescript
{
  config: async (cfg: Record<string, unknown>) => void
}
```

### Внутренние утилиты (`utils.ts`)

Эти функции не экспортируются из `main.ts` и предназначены для внутреннего использования:

#### `fetchRemoteConfig(url: string): Promise<RemoteConfig>`

Загружает JSON-конфиг с HTTP-сервера. Таймаут 10 секунд.

#### `loadCachedConfig(): Promise<RemoteConfig | null>`

Читает кэшированный конфиг. Возвращает `null`, если кэш пуст или истёк TTL.

#### `cacheRemoteConfig(config: RemoteConfig): Promise<void>`

Сохраняет конфиг в файл кэша. Создаёт директорию, если не существует.

#### `deepMergeConfigs(localConfig, remoteConfig): void`

Объединяет удалённый конфиг с локальным **in-place**. Модифицирует `localConfig`.

## Отладка

### Проверка работы плагина

После установки плагина проверьте, что он корректно загружается и объединяет конфигурацию:

```bash
# Показать полностью решённую конфигурацию (включая merged remote config)
opencode debug config

# Показать информацию о запущенном окружении и загруженных плагинах
opencode debug info

# Показать глобальные пути (data, config, cache, state)
opencode debug paths
```

### Пример вывода `opencode debug config`

При успешной работе плагина в выводе `opencode debug config` должны присутствовать поля, загруженные с удалённого сервера:

```json
{
  "model": "example/pro",
  "small_model": "example/fast",
  "default_agent": "plan",
  "share": "disabled",
  "enabled_providers": ["example"],
  "provider": {
    "example": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "EXAMPLE 🔒",
      "options": {
        "baseURL": "http://localhost:8080/v1",
        "apiKey": "sk-your-key"
      },
      "models": {
        "pro": { "name": "Pro", ... },
        "fast": { "name": "Fast", ... }
      }
    }
  },
  "mcp": {
    "searxng": { "type": "remote", "url": "http://localhost:8889/mcp", "enabled": true },
    "context7": { "type": "remote", "url": "http://localhost:8890/mcp", "enabled": true }
  }
}
```

### Пример вывода `opencode debug info`

```
opencode version: 1.14.50
os: Linux 6.8.0-111-generic x64
terminal: xterm-256color
plugins:
- file:///path/to/opencode-remote-config
```

### Пример вывода `opencode debug paths`

```
home       ~/
data       ~/.local/share/opencode
bin        ~/.cache/opencode/bin
log        ~/.local/share/opencode/log
repos      ~/.local/share/opencode/repos
cache      ~/.cache/opencode
config     ~/.config/opencode
state      ~/.local/state/opencode
tmp        /tmp/opencode
```

### Логи запуска плагина

При запуске `opencode debug config` или любого другого подкоманды, плагин выводит логи в stdout/stderr:

```
[opencode-remote-config] Plugin initialized
[opencode-remote-config] Using cached config
[opencode-remote-config] Config merged successfully
```

Если сервер недоступен, будет выведено предупреждение в stderr:

```
[opencode-remote-config] Plugin initialized
[opencode-remote-config] Failed to load remote config: DOMException [TimeoutError]: The operation was aborted due to timeout
```

В этом случае используется закэшированная конфигурация (если она есть) или локальная конфигурация без изменений.

### Запуск с отладочным логированием

```bash
# Вывести логи opencode в stderr
opencode debug config --print-logs

# Установить уровень логирования DEBUG
opencode debug config --log-level DEBUG
```

## Разработка

### Установка зависимостей

```bash
npm install
```

### Команды

```bash
npm run test           # Запустить все тесты (unit + e2e)
npm run watch:test     # Watch-режим тестов
npm run typecheck      # Проверка типов TypeScript
```

### Тестовый сервер

Интеграционные тесты поднимают локальный mock-сервер (`node:http`, случайный порт) и передают его адрес через `OPENCODE_REMOTE_CONFIG_ADDRESS` — внешняя сеть не требуется.

## Лицензия

MIT
