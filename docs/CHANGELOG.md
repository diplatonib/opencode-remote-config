# Changelog

Все заметные изменения проекта документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версионирование — [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

## [0.1.0] — 2026-10-23

### Added

- Загрузка организационной конфигурации с HTTP-сервера через `config` хук
- Deep-merge удалённой конфигурации с локальной (приоритет локальных значений)
- Кэш с TTL 30 минут и graceful fallback при недоступности сервера
- Параметр `exclude` — dot-notation пути, исключаемые из слияния
- Параметр `cache` — отключение кэширования
