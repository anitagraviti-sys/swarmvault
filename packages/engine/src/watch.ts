import path from "node:path";
import chokidar from "chokidar";
import { initWorkspace } from "./config.js";
import { importInbox } from "./ingest.js";
import { appendWatchRun } from "./logs.js";
import type { WatchController, WatchOptions } from "./types.js";
import { compileVault, lintVault } from "./vault.js";

export async function watchVault(rootDir: string, options: WatchOptions = {}): Promise<WatchController> {
  const { paths } = await initWorkspace(rootDir);
  const debounceMs = options.debounceMs ?? 900;

  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let pending = false;
  let closed = false;
  const reasons = new Set<string>();

  const watcher = chokidar.watch(paths.inboxDir, {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: Math.max(250, Math.floor(debounceMs / 2)),
      pollInterval: 100
    }
  });

  const schedule = (reason: string) => {
    if (closed) {
      return;
    }

    reasons.add(reason);
    pending = true;
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      void runCycle();
    }, debounceMs);
  };

  const runCycle = async () => {
    if (running || closed || !pending) {
      return;
    }

    pending = false;
    running = true;
    const startedAt = new Date();
    const runReasons = [...reasons];
    reasons.clear();

    let importedCount = 0;
    let scannedCount = 0;
    let attachmentCount = 0;
    let changedPages: string[] = [];
    let lintFindingCount: number | undefined;
    let success = true;
    let error: string | undefined;

    try {
      const imported = await importInbox(rootDir, paths.inboxDir);
      importedCount = imported.imported.length;
      scannedCount = imported.scannedCount;
      attachmentCount = imported.attachmentCount;

      const compile = await compileVault(rootDir);
      changedPages = compile.changedPages;

      if (options.lint) {
        const findings = await lintVault(rootDir);
        lintFindingCount = findings.length;
      }
    } catch (caught) {
      success = false;
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      const finishedAt = new Date();
      await appendWatchRun(rootDir, {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        inputDir: paths.inboxDir,
        reasons: runReasons,
        importedCount,
        scannedCount,
        attachmentCount,
        changedPages,
        lintFindingCount,
        success,
        error
      });

      running = false;
      if (pending && !closed) {
        schedule("queued");
      }
    }
  };

  watcher
    .on("add", (filePath) => schedule(`add:${toWatchReason(paths.inboxDir, filePath)}`))
    .on("change", (filePath) => schedule(`change:${toWatchReason(paths.inboxDir, filePath)}`))
    .on("unlink", (filePath) => schedule(`unlink:${toWatchReason(paths.inboxDir, filePath)}`))
    .on("addDir", (dirPath) => schedule(`addDir:${toWatchReason(paths.inboxDir, dirPath)}`))
    .on("unlinkDir", (dirPath) => schedule(`unlinkDir:${toWatchReason(paths.inboxDir, dirPath)}`))
    .on("error", (caught) => schedule(`error:${caught instanceof Error ? caught.message : String(caught)}`));

  return {
    close: async () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
      }
      await watcher.close();
    }
  };
}

function toWatchReason(baseDir: string, targetPath: string): string {
  return path.relative(baseDir, targetPath) || ".";
}
