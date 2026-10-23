# Развёртывание

Плагин распространяется как исходный код и исполняется opencode напрямую — отдельного процесса развёртывания нет.

## Установка пользователями

### Из git-репозитория

```bash
opencode plugin github:diplatonib/opencode-remote-config
```

или в `opencode.json`:

```jsonc
{
  "plugin": [
    ["github:diplatonib/opencode-remote-config", {
      "address": "https://config.example.com/opencode.json"
    }]
  ]
}
```

### Из собранного файла

```bash
npm run build   # создаёт out/remote-config.js (бандл с README в докблоке)
```

```jsonc
{
  "plugin": ["plugins/remote-config.js"]
}
```

## Сервер конфигурации

Плагину нужен HTTP-эндпоинт, отдающий JSON удалённой конфигурации (формат — см. [ARCHITECTURE.md](./ARCHITECTURE.md#формат-удалённого-конфига)). Требования к серверу:

- Отвечает `200 OK` с `Content-Type: application/json`
- Отвечает быстрее 10 секунд (иначе таймаут и fallback на кэш)
- Доступен из сети пользователей

Адрес задаётся параметром `address` или переменной `OPENCODE_REMOTE_CONFIG_ADDRESS`.
