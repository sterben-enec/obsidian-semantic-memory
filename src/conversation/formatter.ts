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
  const safeTitle = conv.title.replace(/"/g, '\\"');

  const frontmatter = [
    "---",
    "kind: conversation",
    `date: ${date}`,
    `time_start: ${timeStart}`,
    `session_id: ${conv.sessionId}`,
    `project: ${conv.project}`,
    `title: "${safeTitle}"`,
    "---",
  ].join("\n");

  const body = conv.turns.map(formatTurn).filter(Boolean).join("\n\n");

  return `${frontmatter}\n\n${body}\n`;
}
