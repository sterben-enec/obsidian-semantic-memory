# obsidian-semantic-memory

Семантический слой памяти для хранилищ Obsidian. Индексирует заметки в локальную SQLite-базу с векторными эмбеддингами и обеспечивает многосигнальный поиск: семантическое сходство + FTS по ключевым словам + граф сущностей + структурированные факты + спад актуальности по времени.

**[English version → README.md](README.md)**

## Возможности

- **Локально и автономно** — эмбеддинги через `@xenova/transformers`, без API-ключей
- **Многосигнальный поиск** — векторный поиск + BM25 FTS + граф сущностей + факты + recency
- **MCP-сервер** — 7 инструментов для агентов (Claude, OpenClaw, любой MCP-клиент)
- **Живой watcher** — изменения в vault индексируются за секунды через chokidar
- **Структурированная память** — сущности, отношения, факты (субъект–предикат–объект)
- **`.semanticignore`** — исключение файлов с секретами или шумом из индекса

## Архитектура

```
Obsidian vault (.md файлы)
  → парсинг (frontmatter + тело + wikilinks)
  → чанкинг по заголовкам / бюджету токенов (gpt-tokenizer)
  → эмбеддинги (локально multilingual-e5-base или OpenAI)
  → SQLite: notes, chunks, entities, facts, relations
  → FTS5 виртуальная таблица (BM25 поиск по словам)
  → sqlite-vec виртуальная таблица (векторное сходство)
  → многосигнальный ранжировщик (semantic + FTS + entity + graph + facts + recency)
  → MCP-сервер / CLI / HTTP API
```

## Требования

- Node.js 18+
- Для локальных эмбеддингов: ~560 МБ под кеш модели (скачивается при первом запуске)
- Для OpenAI-эмбеддингов: `OPENAI_API_KEY`

## Установка

```bash
git clone https://github.com/sterben-enec/obsidian-semantic-memory
cd obsidian-semantic-memory
npm install
npm run build
```

## Конфигурация

Всё настраивается через переменные окружения.

| Переменная | Обязательно | По умолчанию | Описание |
|-----------|-------------|--------------|----------|
| `VAULT_PATH` | да | — | Абсолютный путь к хранилищу Obsidian |
| `EMBEDDING_PROVIDER` | нет | `openai` | `local` или `openai` |
| `EMBEDDING_MODEL` | нет | `Xenova/multilingual-e5-base` | Имя модели (для local) |
| `OPENAI_API_KEY` | если openai | — | Ключ OpenAI API |
| `DB_PATH` | нет | `$VAULT_PATH/.semantic-memory/index.db` | Путь к SQLite-базе |
| `MEMORY_DIR` | нет | `Memory/Daily` | Путь к папке с ежедневными заметками памяти |
| `CHUNK_MAX_TOKENS` | нет | `400` | Максимум токенов в чанке |
| `CHUNK_OVERLAP_TOKENS` | нет | `50` | Перекрытие токенов между чанками |
| `PRIORITY_PATHS` | нет | `""` | Пути в vault для буста в результатах (через запятую) |
| `LLM_EXTRACTION` | нет | `false` | Извлечение фактов через LLM (требует `OPENAI_API_KEY`) |
| `INDEX_CONCURRENCY` | нет | `5` | Параллельные воркеры индексации (1–20) |

### Локальные модели эмбеддингов

| Модель | Dims | Размер | Примечание |
|--------|------|--------|------------|
| `Xenova/multilingual-e5-base` | 768 | ~560 МБ | По умолчанию. Лучшее качество, мультиязычная |
| `Xenova/multilingual-e5-small` | 384 | ~120 МБ | Быстрее, меньше RAM |
| `Xenova/all-MiniLM-L6-v2` | 384 | ~25 МБ | Только английский, очень быстрая |

E5-модели автоматически используют асимметричные префиксы `query:` / `passage:` — дополнительной настройки не нужно.

## Использование

```bash
export VAULT_PATH="/путь/к/хранилищу"
export EMBEDDING_PROVIDER=local
export EMBEDDING_MODEL=Xenova/multilingual-e5-base

# Полный пересчёт (первый запуск или после изменения схемы)
node dist/cli.js rebuild

# Инкрементальная индексация (только изменённые файлы)
node dist/cli.js index

# Семантический поиск
node dist/cli.js search "что я знаю о проекте X"
node dist/cli.js search "проект X" --topK 10

# Слежение за изменениями (работает непрерывно)
node dist/cli.js watch

# HTTP API (localhost:3456)
node dist/cli.js serve
node dist/cli.js serve -p 8080

# MCP-сервер (stdio транспорт)
node dist/cli.js mcp
```

## MCP-сервер

7 инструментов через stdio-транспорт. Совместим с Claude Code, OpenClaw и любым MCP-клиентом.

```json
{
  "mcpServers": {
    "obsidian-memory": {
      "command": "node",
      "args": ["/путь/к/obsidian-semantic-memory/dist/cli.js", "mcp"],
      "env": {
        "VAULT_PATH": "/путь/к/хранилищу",
        "EMBEDDING_PROVIDER": "local",
        "EMBEDDING_MODEL": "Xenova/multilingual-e5-base"
      }
    }
  }
}
```

| Инструмент | Описание |
|-----------|----------|
| `vault_search` | Семантический поиск — ранжируется по сходству + сущности + граф + факты + свежесть |
| `vault_fts` | Поиск по ключевым словам (BM25). Для точных слов и фраз |
| `vault_entity` | Поиск сущности по имени или псевдониму (поддерживает частичное совпадение) |
| `vault_facts` | Все структурированные факты о сущности |
| `vault_status` | Статистика индекса: заметки / чанки / сущности / факты / отношения |
| `vault_remember` | Добавить текст в ежедневную заметку памяти |
| `vault_store_fact` | Сохранить структурированный факт: субъект → предикат → объект |

## HTTP API

Слушает только `127.0.0.1` (localhost, без доступа из сети).

| Метод | Путь | Описание |
|-------|------|----------|
| `POST` | `/retrieve-context` | Семантический поиск. Тело: `{ query, topK? }` |
| `GET` | `/search?q=...` | Сокращение для retrieve-context |
| `GET` | `/entity/:name` | Поиск сущности по имени или псевдониму |
| `GET` | `/facts/:entityId` | Факты для сущности |
| `POST` | `/memory/daily` | Добавить в ежедневную заметку. Тело: `{ date, text, source? }` |

## Автозапуск на macOS (launchd)

Создайте `~/Library/LaunchAgents/com.yourname.osm-watcher.plist`:

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
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/local/opt/node@24/bin/node</string>
      <string>/путь/к/obsidian-semantic-memory/dist/cli.js</string>
      <string>watch</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>VAULT_PATH</key>
      <string>/путь/к/хранилищу</string>
      <key>EMBEDDING_PROVIDER</key>
      <string>local</string>
      <key>EMBEDDING_MODEL</key>
      <string>Xenova/multilingual-e5-base</string>
      <key>HOME</key>
      <string>/Users/yourname</string>
      <key>PATH</key>
      <string>/usr/local/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>/путь/к/логам/osm-watcher.log</string>
    <key>StandardErrorPath</key>
    <string>/путь/к/логам/osm-watcher.err.log</string>
  </dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.yourname.osm-watcher.plist
```

`KeepAlive: true` — автоматически перезапускает watcher при падении. `RunAtLoad: true` — запускает при входе в систему.

## Исключение файлов из индекса

Создайте `.semanticignore` в корне хранилища, чтобы исключить файлы из индексации (работает и для `rebuild`/`index`, и для живого watcher):

```
# Секреты и учётные данные
path/to/env.md
config/secrets.md

# Директории (исключают всё внутри)
Templates/
Archive/old/
```

Паттерны сопоставляются с путями относительно корня vault.

## Безопасность

- API-сервер слушает только `127.0.0.1` — недоступен из сети
- Используйте `.semanticignore` для файлов с секретами и приватными данными
- MCP-сервер работает через stdio — сетевой порт не открывается

## Хранение данных

- SQLite-база: `$VAULT_PATH/.semantic-memory/index.db`
- Кеш моделей: `~/.cache/osm-memory/models/`
- Добавьте `.semantic-memory/` в `.gitignore`

## Лицензия

ISC
