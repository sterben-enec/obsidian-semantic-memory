import fs from "fs/promises";
import path from "path";
import type { ParsedConversation } from "./types";
import { formatConversation, buildFilename } from "./formatter";

/**
 * Записывает разговор в файл markdown в хранилище.
 * @param vaultPath - корневой путь хранилища
 * @param conversationsDir - относительный путь к папке разговоров (например, "Claude Code/Conversations")
 * @param conv - распарсенный разговор
 * @returns абсолютный путь к созданному файлу
 * @throws Error если обнаружена попытка обхода пути
 */
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
