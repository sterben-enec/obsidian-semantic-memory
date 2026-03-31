# obsidian-semantic-memory

Семантическая память для Obsidian — локальная индексация, semantic retrieval, FTS, сущности, факты и MCP-инструменты для агентов.

[![CI](https://github.com/sterben-enec/obsidian-semantic-memory/actions/workflows/ci.yml/badge.svg)](https://github.com/sterben-enec/obsidian-semantic-memory/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue.svg)](./LICENSE)

**[English version → README.md](README.md)**

## Что это

`obsidian-semantic-memory` превращает vault Obsidian в локальный слой памяти, который можно опрашивать из агентов и инструментов.

Он индексирует Markdown-заметки в SQLite + vector search и использует стек retrieval, который сочетает:

- семантическое сходство
- BM25 full-text search
- lookup по сущностям
- граф связей
- структурированные факты
- ранжирование с учётом свежести

Проект заточен под **local-first personal knowledge systems**, а не под облачные панели и SaaS-поиск.

## Зачем это нужно

- **Приватно по умолчанию** — локальные эмбеддинги, локальная БД, localhost API
- **Лучше, чем просто vector search** — semantic + FTS + graph + facts
- **Дружит с агентами** — MCP-инструменты для OpenClaw, Claude Code и других MCP-клиентов
- **Нативно для Obsidian** — работает прямо с Markdown и wikilinks
- **Живые обновления** — watcher переиндексирует изменения за секунды

## Возможности

- **Local-first эмбеддинги** через `@xenova/transformers`
- **Многосигнальный retrieval**: semantic vectors + BM25 FTS + graph/fact boosts
- **MCP-сервер** с 7 инструментами
- **HTTP API** для локальных интеграций
- **Структурированная память**: сущности, отношения, факты
- **`.semanticignore`** для исключения приватных и шумных путей

## Быстрый старт

```bash
git clone https://github.com/sterben-enec/obsidian-semantic-memory
cd obsidian-semantic-memory
cp .env.example .env
npm install
npm run build
```

Укажи `VAULT_PATH` в `.env`, затем:

```bash
# полный rebuild
node dist/cli.js rebuild

# инкрементальная индексация
node dist/cli.js index

# семантический поиск
node dist/cli.js search "что я знаю о проекте X"

# слежение за изменениями
node dist/cli.js watch

# локальный HTTP API
node dist/cli.js serve

# MCP server
node dist/cli.js mcp
```

## Архитектура

```text
Obsidian vault (.md файлы)
  → parse (frontmatter + body + wikilinks)
  → chunking по заголовкам / бюджету токенов
  → embeddings (local или OpenAI)
  → SQLite: notes, chunks, entities, facts, relations
  → FTS5 keyword index
  → sqlite-vec vector index
  → многосигнальный ranking
  → CLI / MCP / HTTP API
```

## Требования

- Node.js 18+
- Для локальных эмбеддингов: ~560 МБ кеша модели при первом запуске
- Для OpenAI-эмбеддингов: `OPENAI_API_KEY`

## Конфигурация

Всё задаётся через переменные окружения. Для локальной разработки можно начать с `.env.example`.

| Переменная | Обязательно | По умолчанию | Описание |
|-----------|-------------|--------------|----------|
| `VAULT_PATH` | да | — | Абсолютный путь к vault Obsidian |
| `EMBEDDING_PROVIDER` | нет | `openai` | `local` или `openai` |
| `EMBEDDING_MODEL` | нет | `Xenova/multilingual-e5-base` | Имя модели для local embeddings |
| `OPENAI_API_KEY` | если openai | — | OpenAI API key |
| `DB_PATH` | нет | `$VAULT_PATH/.semantic-memory/index.db` | Путь к SQLite базе |
| `MEMORY_DIR` | нет | `Memory/Daily` | Путь к daily memory note внутри vault |
| `CHUNK_MAX_TOKENS` | нет | `400` | Максимум токенов в чанке |
| `CHUNK_OVERLAP_TOKENS` | нет | `50` | Перекрытие токенов между чанками |
| `PRIORITY_PATHS` | нет | `""` | Пути для буста в ранжировании |
| `LLM_EXTRACTION` | нет | `false` | Включить LLM extraction фактов |
| `INDEX_CONCURRENCY` | нет | `5` | Количество воркеров индексации |

### Рекомендуемые локальные модели

| Модель | Dims | Размер | Примечание |
|--------|------|--------|------------|
| `Xenova/multilingual-e5-base` | 768 | ~560 МБ | Лучший дефолт, мультиязычная |
| `Xenova/multilingual-e5-small` | 384 | ~120 МБ | Быстрее и легче |
| `Xenova/all-MiniLM-L6-v2` | 384 | ~25 МБ | Только английский, очень быстрая |

E5-модели автоматически используют асимметричные префиксы `query:` / `passage:`.

## MCP-инструменты

MCP-сервер отдаёт 7 инструментов через stdio:

- `vault_search` — semantic retrieval
- `vault_fts` — BM25 keyword/phrase search
- `vault_entity` — поиск сущности по имени или alias
- `vault_facts` — факты о сущности
- `vault_status` — snapshot состояния индекса
- `vault_remember` — дописать текст в daily memory note
- `vault_store_fact` — записать структурированный факт

Пример MCP-конфига:

```json
{
  "mcpServers": {
    "obsidian-memory": {
      "command": "node",
      "args": ["/path/to/obsidian-semantic-memory/dist/cli.js", "mcp"],
      "env": {
        "VAULT_PATH": "/path/to/your/vault",
        "EMBEDDING_PROVIDER": "local",
        "EMBEDDING_MODEL": "Xenova/multilingual-e5-base"
      }
    }
  }
}
```

## HTTP API

HTTP API слушает только `127.0.0.1`.

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/retrieve-context` | Semantic retrieval `{ query, topK? }` |
| `GET` | `/search?q=...` | Короткий endpoint для retrieval |
| `GET` | `/entity/:name` | Поиск сущности по имени или alias |
| `GET` | `/facts/:entityId` | Факты для сущности |
| `POST` | `/memory/daily` | Дописать в daily note `{ date, text, source? }` |

## `.semanticignore`

Создай `.semanticignore` в корне vault, чтобы исключать файлы из индексации:

```text
# Secrets
config/secrets.md
private/env.md

# Directories
Templates/
Archive/old/
```

Паттерны сопоставляются с путями относительно корня vault.

## Пример launchd для macOS

Создай `~/Library/LaunchAgents/com.yourname.osm-watcher.plist` и запускай watcher при логине:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.yourname.osm-watcher</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/opt/node@24/bin/node</string>
      <string>/path/to/obsidian-semantic-memory/dist/cli.js</string>
      <string>watch</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>VAULT_PATH</key>
      <string>/path/to/your/vault</string>
      <key>EMBEDDING_PROVIDER</key>
      <string>local</string>
      <key>EMBEDDING_MODEL</key>
      <string>Xenova/multilingual-e5-base</string>
      <key>HOME</key>
      <string>/Users/yourname</string>
      <key>PATH</key>
      <string>/usr/local/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
  </dict>
</plist>
```

## Модель безопасности

- HTTP API слушает только `127.0.0.1`
- MCP transport — только stdio
- приватные заметки и секреты надо исключать через `.semanticignore`
- локальные `.env` нельзя коммитить

Подробности — в [SECURITY.md](SECURITY.md).

## Contributing

См. [CONTRIBUTING.md](CONTRIBUTING.md).

## GitHub About

Рекомендуемый description:

> Local-first semantic memory for Obsidian: SQLite + vector search + FTS + entities + facts + MCP tools.

Рекомендуемые topics:

`obsidian`, `semantic-search`, `mcp`, `knowledge-graph`, `sqlite`, `vector-search`, `local-first`, `typescript`

## License

ISC
