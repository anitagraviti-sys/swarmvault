import fs from "node:fs/promises";
import path from "node:path";
import { initWorkspace } from "./config.js";
import type { WatchRunRecord } from "./types.js";
import { appendJsonLine, ensureDir, fileExists } from "./utils.js";

export async function appendLogEntry(rootDir: string, action: string, title: string, lines: string[] = []): Promise<void> {
  const { paths } = await initWorkspace(rootDir);
  await ensureDir(paths.wikiDir);
  const logPath = path.join(paths.wikiDir, "log.md");
  const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const entry = [`## [${timestamp}] ${action} | ${title}`, ...lines.map((line) => `- ${line}`), ""].join("\n");
  const existing = (await fileExists(logPath)) ? await fs.readFile(logPath, "utf8") : "# Log\n\n";
  await fs.writeFile(logPath, `${existing}${entry}\n`, "utf8");
}

export async function appendWatchRun(rootDir: string, run: WatchRunRecord): Promise<void> {
  const { paths } = await initWorkspace(rootDir);
  await appendJsonLine(paths.jobsLogPath, run);
}
