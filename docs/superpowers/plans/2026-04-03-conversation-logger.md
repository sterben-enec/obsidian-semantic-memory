# Conversation Logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `log-conversation` CLI command that reads a Claude Code session JSONL file and writes a structured Markdown note to the Obsidian vault, triggered automatically by a Claude Code `Stop` hook.

**Architecture:** Three focused modules (`parser` → `formatter` → `writer`) under `src/conversation/`, a shell wrapper script with env vars, and one new CLI command. The `Stop` hook calls the wrapper; the existing vault watcher auto-indexes the new file.

**Tech Stack:** TypeScript (Node16), Vitest, Node.js fs/promises, Commander.js (existing CLI framework)

---

## File Map

| Action | Path                                   | Responsibility                                       |
| ------ | -------------------------------------- | ---------------------------------------------------- |
| Create | `src/conversation/types.ts`            | ParsedConversation, ConversationTurn, ToolCall types |
| Create | `src/conversation/parser.ts`           | Read + parse Claude Code JSONL → ParsedConversation  |
| Create | `src/conversation/formatter.ts`        | ParsedConversation → Markdown string + filename      |
| Create | `src/conversation/writer.ts`           | Write .md file to vault                              |
| Create | `fixtures/conversation/sample.jsonl`   | Test fixture: representative session                 |
| Create | `tests/conversation/parser.test.ts`    | Unit tests for parser                                |
| Create | `tests/conversation/formatter.test.ts` | Unit tests for formatter                             |
| Create | `tests/conversation/writer.test.ts`    | Unit tests for writer                                |
| Create | `scripts/log-conversation.sh`          | Env-configured wrapper for Stop hook                 |
| Modify | `src/cli.ts`                           | Add `log-conversation` command                       |
| Modify | `~/.claude/settings.json`              | Add `Stop` hook                                      |
| Modify | `.env.example`                         | Document CONVERSATIONS_DIR                           |

---

## Task 1: Types

**Files:**

- Create: `src/conversation/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/conversation/types.ts

export interface ToolCallEdit {
  kind: "edit";
  filePath: string;
  oldString: string;
  newString: string;
}

export interface ToolCallWrite {
  kind: "write";
  filePath: string;
}

export interface ToolCallBash {
  kind: "bash";
  command: string;
}

export type ToolCall = ToolCallEdit | ToolCallWrite | ToolCallBash;

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  toolCalls: ToolCall[];
}

export interface ParsedConversation {
  sessionId: string;
  title: string;
  timeStart: string; // ISO 8601 timestamp
  project: string; // cwd from Stop hook
  turns: ConversationTurn[];
}
```

- [ ] **Step 2: Build to verify types compile**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm run build
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/conversation/types.ts
git commit -m "feat(conversation): add ParsedConversation types"
```

---

## Task 2: Fixture + Parser (TDD)

**Files:**

- Create: `fixtures/conversation/sample.jsonl`
- Create: `src/conversation/parser.ts`
- Create: `tests/conversation/parser.test.ts`

- [ ] **Step 1: Create fixture JSONL**

Create `fixtures/conversation/sample.jsonl` with the following content (each object on its own line):

```jsonl
{"type":"ai-title","sessionId":"test-session-001","aiTitle":"Fix auth bug"}
{"type":"queue-operation","operation":"dequeue","timestamp":"2026-04-03T10:30:00.000Z","sessionId":"test-session-001"}
{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Please fix the authentication bug"}]},"uuid":"msg-001","timestamp":"2026-04-03T10:30:01.000Z","isMeta":false,"userType":"external","entrypoint":"cli","cwd":"/Users/test/project","sessionId":"test-session-001","version":"2.1.86"}
{"parentUuid":"msg-001","isSidechain":false,"message":{"model":"claude-sonnet-4-6","id":"resp-001","type":"message","role":"assistant","content":[{"type":"text","text":"I'll fix it now."},{"type":"tool_use","id":"tool-001","name":"Edit","input":{"file_path":"src/auth.ts","old_string":"return false;","new_string":"return true;"}}]},"type":"assistant","uuid":"msg-002","timestamp":"2026-04-03T10:30:05.000Z","userType":"external","entrypoint":"cli","cwd":"/Users/test/project","sessionId":"test-session-001","version":"2.1.86"}
{"parentUuid":"msg-002","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-001","content":[{"type":"text","text":"File edited successfully"}]}]},"uuid":"msg-003","timestamp":"2026-04-03T10:30:06.000Z","isMeta":false,"userType":"external","entrypoint":"cli","cwd":"/Users/test/project","sessionId":"test-session-001","version":"2.1.86"}
{"parentUuid":"msg-003","isSidechain":false,"message":{"model":"claude-sonnet-4-6","id":"resp-002","type":"message","role":"assistant","content":[{"type":"text","text":"Done! I've fixed the bug."},{"type":"tool_use","id":"tool-002","name":"Bash","input":{"command":"npm test"}}]},"type":"assistant","uuid":"msg-004","timestamp":"2026-04-03T10:30:07.000Z","userType":"external","entrypoint":"cli","cwd":"/Users/test/project","sessionId":"test-session-001","version":"2.1.86"}
{"parentUuid":"msg-004","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Thanks!"}]},"uuid":"msg-005","timestamp":"2026-04-03T10:30:10.000Z","isMeta":false,"userType":"external","entrypoint":"cli","cwd":"/Users/test/project","sessionId":"test-session-001","version":"2.1.86"}
{"parentUuid":"msg-005","isSidechain":false,"message":{"model":"claude-sonnet-4-6","id":"resp-003","type":"message","role":"assistant","content":[{"type":"text","text":"You're welcome!"},{"type":"tool_use","id":"tool-003","name":"Write","input":{"file_path":"CHANGELOG.md","content":"## Fixed\n- auth bug"}}]},"type":"assistant","uuid":"msg-006","timestamp":"2026-04-03T10:30:12.000Z","userType":"external","entrypoint":"cli","cwd":"/Users/test/project","sessionId":"test-session-001","version":"2.1.86"}
{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"<local-command-stdout>some internal output</local-command-stdout>"}]},"uuid":"msg-skip-001","timestamp":"2026-04-03T10:30:03.000Z","isMeta":false,"userType":"external","entrypoint":"cli","cwd":"/Users/test/project","sessionId":"test-session-001","version":"2.1.86"}
{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"internal meta"}]},"uuid":"msg-skip-002","timestamp":"2026-04-03T10:30:04.000Z","isMeta":true,"userType":"external","entrypoint":"cli","cwd":"/Users/test/project","sessionId":"test-session-001","version":"2.1.86"}
```

- [ ] **Step 2: Write failing tests**

```typescript
// tests/conversation/parser.test.ts
import { describe, it, expect } from "vitest";
import path from "path";
import {
  parseConversation,
  encodeProjectPath,
  resolveJSONLPath,
} from "../../src/conversation/parser";

const FIXTURE = path.join(process.cwd(), "fixtures/conversation/sample.jsonl");
const SESSION_ID = "test-session-001";
const CWD = "/Users/test/project";

describe("encodeProjectPath", () => {
  it("replaces slashes with dashes", () => {
    expect(encodeProjectPath("/Users/jmassa/Aperta/ID")).toBe(
      "-Users-jmassa-Aperta-ID",
    );
  });
  it("handles paths without leading slash", () => {
    expect(encodeProjectPath("Users/foo")).toBe("Users-foo");
  });
});

describe("resolveJSONLPath", () => {
  it("builds correct path", () => {
    const result = resolveJSONLPath("abc-123", "/Users/jmassa/Aperta/ID");
    expect(result).toContain("-Users-jmassa-Aperta-ID");
    expect(result).toContain("abc-123.jsonl");
    expect(result).toContain(".claude/projects");
  });
});

describe("parseConversation", () => {
  it("extracts title from ai-title entry", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    expect(result.title).toBe("Fix auth bug");
  });

  it("extracts timeStart from first queue dequeue", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    expect(result.timeStart).toBe("2026-04-03T10:30:00.000Z");
  });

  it("extracts session_id and project", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.project).toBe(CWD);
  });

  it("includes real user messages", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    const userTurns = result.turns.filter((t) => t.role === "user");
    expect(userTurns.map((t) => t.text)).toContain(
      "Please fix the authentication bug",
    );
    expect(userTurns.map((t) => t.text)).toContain("Thanks!");
  });

  it("skips tool_result-only user messages", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    const userTexts = result.turns
      .filter((t) => t.role === "user")
      .map((t) => t.text);
    expect(userTexts).not.toContain("File edited successfully");
  });

  it("skips meta user messages", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    const userTexts = result.turns
      .filter((t) => t.role === "user")
      .map((t) => t.text);
    expect(userTexts).not.toContain("internal meta");
  });

  it("skips local-command user messages", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    const userTexts = result.turns
      .filter((t) => t.role === "user")
      .map((t) => t.text);
    expect(userTexts.some((t) => t.includes("<local-command"))).toBe(false);
  });

  it("extracts assistant text", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    const assistantTurns = result.turns.filter((t) => t.role === "assistant");
    expect(assistantTurns[0].text).toBe("I'll fix it now.");
  });

  it("extracts Edit tool call with diff", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    const assistantTurns = result.turns.filter((t) => t.role === "assistant");
    const editCall = assistantTurns[0].toolCalls.find(
      (tc) => tc.kind === "edit",
    );
    expect(editCall).toBeDefined();
    expect((editCall as any).filePath).toBe("src/auth.ts");
    expect((editCall as any).oldString).toBe("return false;");
    expect((editCall as any).newString).toBe("return true;");
  });

  it("extracts Bash tool call", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    const assistantTurns = result.turns.filter((t) => t.role === "assistant");
    const bashCall = assistantTurns[1].toolCalls.find(
      (tc) => tc.kind === "bash",
    );
    expect(bashCall).toBeDefined();
    expect((bashCall as any).command).toBe("npm test");
  });

  it("extracts Write tool call with only file path", async () => {
    const result = await parseConversation(FIXTURE, SESSION_ID, CWD);
    const assistantTurns = result.turns.filter((t) => t.role === "assistant");
    const writeCall = assistantTurns[2].toolCalls.find(
      (tc) => tc.kind === "write",
    );
    expect(writeCall).toBeDefined();
    expect((writeCall as any).filePath).toBe("CHANGELOG.md");
  });

  it("uses session_id as fallback title when ai-title missing", async () => {
    // Create a temp JSONL without ai-title entry
    const os = await import("os");
    const fs = await import("fs/promises");
    const tmp = path.join(os.tmpdir(), "no-title.jsonl");
    await fs.writeFile(
      tmp,
      '{"type":"queue-operation","operation":"dequeue","timestamp":"2026-04-03T10:00:00.000Z"}\n{"parentUuid":null,"isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello"}]},"uuid":"x","isMeta":false}\n',
      "utf8",
    );
    const result = await parseConversation(tmp, "fallback-id", "/test");
    expect(result.title).toBe("fallback-id");
    await fs.rm(tmp);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm test -- tests/conversation/parser.test.ts
```

Expected: FAIL — `Cannot find module '../../src/conversation/parser'`

- [ ] **Step 4: Implement parser**

```typescript
// src/conversation/parser.ts
import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ParsedConversation, ConversationTurn, ToolCall } from "./types";

export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

export function resolveJSONLPath(sessionId: string, cwd: string): string {
  const encoded = encodeProjectPath(cwd);
  return path.join(
    os.homedir(),
    ".claude",
    "projects",
    encoded,
    `${sessionId}.jsonl`,
  );
}

// Фильтрует внутренние сообщения Claude Code (команды, системные уведомления)
function isInternalUserMessage(content: any[]): boolean {
  if (content.length === 0) return true;
  // Только tool_result блоки — ответ инструмента, не пользователь
  if (content.every((b: any) => b.type === "tool_result")) return true;
  // Внутренние теги Claude Code CLI
  const firstText = content.find((b: any) => b.type === "text")?.text ?? "";
  if (
    firstText.startsWith("<local-command") ||
    firstText.startsWith("<command-name>")
  )
    return true;
  return false;
}

export async function parseConversation(
  jsonlPath: string,
  sessionId: string,
  cwd: string,
): Promise<ParsedConversation> {
  const raw = await fs.readFile(jsonlPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());

  let title = sessionId;
  let timeStart = new Date().toISOString();
  let timeStartFound = false;
  const turns: ConversationTurn[] = [];

  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "ai-title" && entry.aiTitle) {
      title = entry.aiTitle;
      continue;
    }

    if (
      !timeStartFound &&
      entry.type === "queue-operation" &&
      entry.operation === "dequeue"
    ) {
      timeStart = entry.timestamp;
      timeStartFound = true;
      continue;
    }

    if (entry.isMeta) continue;

    if (entry.type === "user" && entry.message?.role === "user") {
      const content: any[] = Array.isArray(entry.message.content)
        ? entry.message.content
        : [];
      if (isInternalUserMessage(content)) continue;
      const text = content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text as string)
        .join("\n")
        .trim();
      if (!text) continue;
      turns.push({ role: "user", text, toolCalls: [] });
      continue;
    }

    if (entry.type === "assistant" && entry.message?.role === "assistant") {
      const content: any[] = Array.isArray(entry.message.content)
        ? entry.message.content
        : [];
      const text = content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text as string)
        .join("\n")
        .trim();

      const toolCalls: ToolCall[] = [];
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        if (block.name === "Edit" && block.input?.file_path) {
          toolCalls.push({
            kind: "edit",
            filePath: block.input.file_path,
            oldString: block.input.old_string ?? "",
            newString: block.input.new_string ?? "",
          });
        } else if (block.name === "Write" && block.input?.file_path) {
          toolCalls.push({ kind: "write", filePath: block.input.file_path });
        } else if (block.name === "Bash" && block.input?.command) {
          toolCalls.push({ kind: "bash", command: block.input.command });
        }
      }

      if (!text && toolCalls.length === 0) continue;
      turns.push({ role: "assistant", text, toolCalls });
    }
  }

  return { sessionId, title, timeStart, project: cwd, turns };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm test -- tests/conversation/parser.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add fixtures/conversation/sample.jsonl src/conversation/parser.ts tests/conversation/parser.test.ts
git commit -m "feat(conversation): add JSONL parser with tests"
```

---

## Task 3: Formatter (TDD)

**Files:**

- Create: `src/conversation/formatter.ts`
- Create: `tests/conversation/formatter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/conversation/formatter.test.ts
import { describe, it, expect } from "vitest";
import {
  formatConversation,
  buildFilename,
} from "../../src/conversation/formatter";
import type { ParsedConversation } from "../../src/conversation/types";

const SAMPLE: ParsedConversation = {
  sessionId: "abc-123",
  title: "Fix auth bug",
  timeStart: "2026-04-03T10:30:00.000Z",
  project: "/Users/jmassa/Aperta/ID",
  turns: [
    { role: "user", text: "Please fix the bug", toolCalls: [] },
    {
      role: "assistant",
      text: "I'll fix it.",
      toolCalls: [
        {
          kind: "edit",
          filePath: "src/auth.ts",
          oldString: "return false;",
          newString: "return true;",
        },
      ],
    },
    {
      role: "assistant",
      text: "Running tests.",
      toolCalls: [{ kind: "bash", command: "npm test" }],
    },
    {
      role: "assistant",
      text: "Creating file.",
      toolCalls: [{ kind: "write", filePath: "CHANGELOG.md" }],
    },
    { role: "user", text: "Thanks!", toolCalls: [] },
  ],
};

describe("buildFilename", () => {
  it("formats as YYYY-MM-DD HH-mm - title.md", () => {
    const name = buildFilename("Fix auth bug", "2026-04-03T10:30:00.000Z");
    expect(name).toBe("2026-04-03 10-30 - Fix auth bug.md");
  });

  it("sanitizes slashes in title", () => {
    const name = buildFilename("feat/auth fix", "2026-04-03T10:30:00.000Z");
    expect(name).not.toContain("/");
  });

  it("sanitizes colons in title", () => {
    const name = buildFilename("fix: auth bug", "2026-04-03T10:30:00.000Z");
    expect(name).not.toContain(":");
  });
});

describe("formatConversation", () => {
  it("includes kind: conversation in frontmatter", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("kind: conversation");
  });

  it("includes date in frontmatter", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("date: 2026-04-03");
  });

  it("includes time_start in frontmatter", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("time_start: 10:30");
  });

  it("includes session_id in frontmatter", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("session_id: abc-123");
  });

  it("includes project in frontmatter", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("project: /Users/jmassa/Aperta/ID");
  });

  it("includes title in frontmatter", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain('title: "Fix auth bug"');
  });

  it("does NOT repeat title as H1", () => {
    const md = formatConversation(SAMPLE);
    expect(md).not.toMatch(/^# Fix auth bug/m);
  });

  it("formats user turns with **User:** prefix", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("**User:** Please fix the bug");
  });

  it("formats assistant turns with **Assistant:** prefix", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("**Assistant:** I'll fix it.");
  });

  it("formats Edit tool call as blockquote diff", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("> **Edit** `src/auth.ts`");
    expect(md).toContain("> - return false;");
    expect(md).toContain("> + return true;");
  });

  it("formats Bash tool call as one-line blockquote", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("> **Bash** `npm test`");
  });

  it("formats Write tool call as one-line blockquote", () => {
    const md = formatConversation(SAMPLE);
    expect(md).toContain("> **Write** `CHANGELOG.md`");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm test -- tests/conversation/formatter.test.ts
```

Expected: FAIL — `Cannot find module '../../src/conversation/formatter'`

- [ ] **Step 3: Implement formatter**

```typescript
// src/conversation/formatter.ts
import type { ParsedConversation, ConversationTurn, ToolCall } from "./types";

// Возвращает YYYY-MM-DD из ISO-строки
function isoToDate(iso: string): string {
  return iso.substring(0, 10);
}

// Возвращает HH:mm из ISO-строки
function isoToTime(iso: string): string {
  return iso.substring(11, 16);
}

// Убирает символы, недопустимые в именах файлов
function sanitizeTitle(title: string): string {
  return title.replace(/[/\\:*?"<>|]/g, "-").trim();
}

export function buildFilename(title: string, isoTime: string): string {
  const date = isoToDate(isoTime);
  const time = isoToTime(isoTime).replace(":", "-");
  return `${date} ${time} - ${sanitizeTitle(title)}.md`;
}

function formatToolCall(tc: ToolCall): string {
  if (tc.kind === "edit") {
    const diffLines = [
      ...tc.oldString.split("\n").map((l) => `> - ${l}`),
      ...tc.newString.split("\n").map((l) => `> + ${l}`),
    ].join("\n");
    return `> **Edit** \`${tc.filePath}\`\n> \`\`\`diff\n${diffLines}\n> \`\`\``;
  }
  if (tc.kind === "write") {
    return `> **Write** \`${tc.filePath}\``;
  }
  return `> **Bash** \`${tc.command}\``;
}

function formatTurn(turn: ConversationTurn): string {
  const parts: string[] = [];
  if (turn.text) {
    const label = turn.role === "user" ? "User" : "Assistant";
    parts.push(`**${label}:** ${turn.text}`);
  }
  for (const tc of turn.toolCalls) {
    parts.push(formatToolCall(tc));
  }
  return parts.join("\n\n");
}

export function formatConversation(conv: ParsedConversation): string {
  const date = isoToDate(conv.timeStart);
  const timeStart = isoToTime(conv.timeStart);

  const frontmatter = [
    "---",
    "kind: conversation",
    `date: ${date}`,
    `time_start: ${timeStart}`,
    `session_id: ${conv.sessionId}`,
    `project: ${conv.project}`,
    `title: "${conv.title}"`,
    "---",
  ].join("\n");

  const body = conv.turns.map(formatTurn).filter(Boolean).join("\n\n");

  return `${frontmatter}\n\n${body}\n`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm test -- tests/conversation/formatter.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/conversation/formatter.ts tests/conversation/formatter.test.ts
git commit -m "feat(conversation): add Markdown formatter with tests"
```

---

## Task 4: Writer (TDD)

**Files:**

- Create: `src/conversation/writer.ts`
- Create: `tests/conversation/writer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/conversation/writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { writeConversation } from "../../src/conversation/writer";
import type { ParsedConversation } from "../../src/conversation/types";

const SAMPLE: ParsedConversation = {
  sessionId: "abc-123",
  title: "Fix auth bug",
  timeStart: "2026-04-03T10:30:00.000Z",
  project: "/Users/test/project",
  turns: [{ role: "user", text: "Please fix it", toolCalls: [] }],
};

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("writeConversation", () => {
  it("creates conversations dir if missing", async () => {
    await writeConversation(tmp, "Claude Code/Conversations", SAMPLE);
    expect(fs.existsSync(path.join(tmp, "Claude Code", "Conversations"))).toBe(
      true,
    );
  });

  it("creates file with correct name", async () => {
    const filePath = await writeConversation(
      tmp,
      "Claude Code/Conversations",
      SAMPLE,
    );
    expect(path.basename(filePath)).toBe("2026-04-03 10-30 - Fix auth bug.md");
  });

  it("returns absolute path to created file", async () => {
    const filePath = await writeConversation(
      tmp,
      "Claude Code/Conversations",
      SAMPLE,
    );
    expect(path.isAbsolute(filePath)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("file content includes kind: conversation frontmatter", async () => {
    const filePath = await writeConversation(
      tmp,
      "Claude Code/Conversations",
      SAMPLE,
    );
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("kind: conversation");
    expect(content).toContain('title: "Fix auth bug"');
  });

  it("file content includes user turn", async () => {
    const filePath = await writeConversation(
      tmp,
      "Claude Code/Conversations",
      SAMPLE,
    );
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("**User:** Please fix it");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm test -- tests/conversation/writer.test.ts
```

Expected: FAIL — `Cannot find module '../../src/conversation/writer'`

- [ ] **Step 3: Implement writer**

```typescript
// src/conversation/writer.ts
import fs from "fs/promises";
import path from "path";
import type { ParsedConversation } from "./types";
import { formatConversation, buildFilename } from "./formatter";

export async function writeConversation(
  vaultPath: string,
  conversationsDir: string,
  conv: ParsedConversation,
): Promise<string> {
  const filename = buildFilename(conv.title, conv.timeStart);
  const dir = path.join(vaultPath, conversationsDir);

  // Защита от path traversal через имя файла
  const filePath = path.join(dir, filename);
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(dir);
  if (
    !resolvedPath.startsWith(resolvedBase + path.sep) &&
    resolvedPath !== resolvedBase
  ) {
    throw new Error("Path traversal detected in conversation filename");
  }

  await fs.mkdir(dir, { recursive: true });
  const content = formatConversation(conv);
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm test -- tests/conversation/writer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/conversation/writer.ts tests/conversation/writer.test.ts
git commit -m "feat(conversation): add vault writer with tests"
```

---

## Task 5: CLI Command

**Files:**

- Modify: `src/cli.ts`

- [ ] **Step 1: Add imports to cli.ts**

At the top of `src/cli.ts`, after the existing imports, add:

```typescript
import { parseConversation, resolveJSONLPath } from "./conversation/parser";
import { writeConversation } from "./conversation/writer";
```

- [ ] **Step 2: Add log-conversation command before `program.parse()`**

```typescript
program
  .command("log-conversation")
  .description(
    "Log a Claude Code session to Obsidian vault (invoked by Stop hook)",
  )
  .action(async () => {
    const vaultPath = process.env.VAULT_PATH;
    const conversationsDir =
      process.env.CONVERSATIONS_DIR ?? "Claude Code/Conversations";

    if (!vaultPath) {
      process.stderr.write("log-conversation: VAULT_PATH not set\n");
      process.exit(0);
      return;
    }

    // Читаем JSON-пейлоад Stop hook из stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8").trim();

    let sessionId: string | undefined;
    let cwd: string | undefined;
    try {
      const payload = JSON.parse(raw);
      sessionId = payload.session_id;
      cwd = payload.cwd;
    } catch {
      process.stderr.write("log-conversation: invalid JSON on stdin\n");
      process.exit(0);
      return;
    }

    if (!sessionId || !cwd) {
      process.stderr.write(
        "log-conversation: missing session_id or cwd in payload\n",
      );
      process.exit(0);
      return;
    }

    const jsonlPath = resolveJSONLPath(sessionId, cwd);
    try {
      const conv = await parseConversation(jsonlPath, sessionId, cwd);
      const filePath = await writeConversation(
        vaultPath,
        conversationsDir,
        conv,
      );
      process.stdout.write(`Conversation saved: ${filePath}\n`);
    } catch (err) {
      process.stderr.write(`log-conversation: ${err}\n`);
      process.exit(0);
    }
  });
```

- [ ] **Step 3: Build**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm run build
```

Expected: no errors, `dist/cli.js` updated.

- [ ] **Step 4: Smoke test the command**

```bash
echo '{"session_id":"test","cwd":"/nonexistent"}' | \
  VAULT_PATH="/tmp/vault-test" node dist/cli.js log-conversation
```

Expected: stderr `log-conversation: ENOENT` (file not found) — exit 0, no crash.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(conversation): add log-conversation CLI command"
```

---

## Task 6: Shell Wrapper Script

**Files:**

- Create: `scripts/log-conversation.sh`

- [ ] **Step 1: Create wrapper script**

```bash
#!/bin/bash
# Wrapper для Stop hook — устанавливает env vars и запускает log-conversation

export VAULT_PATH="/Users/jmassa/Library/Mobile Documents/iCloud~md~obsidian/Documents"
export CONVERSATIONS_DIR="Main/10. Cora/Claude Code/Conversations"
export HOME=/Users/jmassa
export PATH="/usr/local/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin"

exec /usr/local/opt/node@24/bin/node \
  /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory/dist/cli.js \
  log-conversation
```

Save as `scripts/log-conversation.sh`.

- [ ] **Step 2: Make executable**

```bash
chmod +x /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory/scripts/log-conversation.sh
```

- [ ] **Step 3: Smoke test the wrapper**

```bash
echo '{"session_id":"test","cwd":"/nonexistent"}' | \
  /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory/scripts/log-conversation.sh
```

Expected: stderr with ENOENT error, exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/log-conversation.sh
git commit -m "feat(conversation): add Stop hook wrapper script"
```

---

## Task 7: Claude Code Stop Hook + .env.example

**Files:**

- Modify: `~/.claude/settings.json`
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example**

Add to `.env.example` after `MEMORY_DIR`:

```bash
# CONVERSATIONS_DIR=Claude Code/Conversations
```

- [ ] **Step 2: Add Stop hook to ~/.claude/settings.json**

Read current `settings.json`, then add the `Stop` key to the `hooks` section (or create a `hooks` key if it doesn't exist). The final file should contain:

```json
{
  "enabledPlugins": { ... },
  "effortLevel": "medium",
  "mcpServers": { ... },
  "model": "sonnet",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/jmassa/.openclaw/workspace/obsidian-semantic-memory/scripts/log-conversation.sh",
            "async": true
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Commit .env.example**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
git add .env.example
git commit -m "docs: document CONVERSATIONS_DIR env var"
```

---

## Task 8: Full Test Run, Push

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
npm test
```

Expected: all tests PASS. Current suite: ~all existing + new conversation tests.

- [ ] **Step 2: Build final dist**

```bash
npm run build
```

Expected: no errors.

- [ ] **Step 3: Push to remote**

```bash
cd /Users/jmassa/.openclaw/workspace/obsidian-semantic-memory
git push
```

Expected: push succeeds.

- [ ] **Step 4: Verify hook works with a real session**

Start a new Claude Code session in any project, say something, exit. Then check:

```bash
ls "/Users/jmassa/Library/Mobile Documents/iCloud~md~obsidian/Documents/Main/10. Cora/Claude Code/Conversations/"
```

Expected: a new `.md` file with today's date and the session title.
