# Conversation Logger — Design Spec

**Date:** 2026-04-03
**Project:** obsidian-semantic-memory
**Status:** Approved

---

## Goal

Automatically record every Claude Code session as a structured Markdown note in the Obsidian vault so that conversations are searchable via semantic search.

---

## Architecture

Add a `log-conversation` CLI command to `obsidian-semantic-memory`. A Claude Code `Stop` hook triggers it at the end of every session.

### New modules

```
src/
  conversation/
    parser.ts     — reads Claude Code JSONL, extracts messages and tool calls
    formatter.ts  — formats parsed data into Obsidian Markdown
    writer.ts     — writes .md file to vault
  cli.ts          — add log-conversation subcommand
```

### Data flow

```
Claude Code Stop hook
  → stdin: { session_id, cwd, ... }
  → node dist/cli.js log-conversation
    → locate ~/.claude/projects/<encoded-cwd>/<session_id>.jsonl
    → parser.ts: extract ai-title, time_start, user/assistant messages, relevant tool calls
    → formatter.ts: build Markdown with frontmatter
    → writer.ts: save to vault at CONVERSATIONS_DIR/YYYY-MM-DD HH-mm - <title>.md
    → existing watcher picks up the new file → re-indexes → semantic search works
```

### Configuration

New env var (added to `.env.example`):

```
CONVERSATIONS_DIR=Main/10. Cora/Claude Code/Conversations
```

Default: `Claude Code/Conversations`.

### Stop hook (settings.json)

```json
"Stop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory/dist/cli.js log-conversation",
        "async": true
      }
    ]
  }
]
```

`async: true` so the hook does not block Claude Code from exiting.

---

## Output format

**Filename:** `YYYY-MM-DD HH-mm - <AI-title>.md`
Example: `2026-04-03 14-32 - Debug authorization methods code cleanup.md`

**Content:**

````markdown
---
kind: conversation
date: 2026-04-03
time_start: 14:32
session_id: 0069c9ea-b646-45a0-8f9b-e7afa21ef4f9
project: /Users/jmassa/Aperta/ID
title: Debug authorization methods code cleanup
---

**User:** Привет, хочу почистить код метода авторизации...

**Assistant:** Давай начнём с чтения файла.

> **Edit** `apps/api/src/backend/auth/auth.service.ts`
>
> ```diff
> - old line
> + new line
> ```

**Assistant:** Готово. Вот что изменил...

> **Write** `apps/api/src/backend/auth/new-file.ts`

> **Bash** `npm run migration:run`

**User:** ...
````

### Tool call inclusion rules

| Tool               | Include | What to show                 |
| ------------------ | ------- | ---------------------------- |
| Edit               | Yes     | File path + full diff        |
| Write              | Yes     | File path only (no content)  |
| Bash               | Yes     | Command only (no output)     |
| Read / Glob / Grep | No      | Too noisy, read-only         |
| All others         | No      | Not relevant to code changes |

---

## JSONL parsing

Claude Code stores sessions at:

```
~/.claude/projects/<encoded-cwd>/<session_id>.jsonl
```

`encoded-cwd`: working directory with `/` replaced by `-` and leading `/` dropped.
Example: `/Users/jmassa/Aperta/ID` → `-Users-jmassa-Aperta-ID`

The Stop hook delivers JSON on stdin with fields: `session_id`, `cwd` (and others).

Relevant JSONL entry types to extract:

- `ai-title` → `aiTitle` field = note title
- User messages → entries where `message.role === "user"`, text content blocks only
- Assistant messages → entries where `message.role === "assistant"`, text content blocks + tool_use blocks for Edit/Write/Bash
- Edit tool_use blocks → diff built from `input.old_string` (prefixed `-`) and `input.new_string` (prefixed `+`), `input.file_path` for the header

`time_start`: taken from the `timestamp` of the first `queue-operation` entry with `operation: "dequeue"`.

---

## Error handling

- If JSONL file not found → log warning to stderr, exit 0 (don't block Claude Code)
- If vault write fails → log warning to stderr, exit 0
- If `ai-title` missing → use `session_id` as fallback title
- If `time_start` cannot be determined → use current time

---

## Testing

- Unit tests for `parser.ts`: given sample JSONL fixture → correct messages + tool calls extracted
- Unit tests for `formatter.ts`: given parsed data → correct Markdown output
- Integration test: end-to-end with real fixture file → correct `.md` written to temp vault dir

Fixtures go in `fixtures/conversation/`.

---

## Commit and push

After implementation: commit to `obsidian-semantic-memory` repo and push to remote.
