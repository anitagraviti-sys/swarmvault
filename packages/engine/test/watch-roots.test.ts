import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addWatchedRoot, initVault, listWatchedRoots, removeWatchedRoot, resolveWatchedRepoRoots } from "../src/index.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-watch-roots-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function readConfig(rootDir: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(rootDir, "swarmvault.config.json"), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function writeConfig(rootDir: string, patch: Record<string, unknown>): Promise<void> {
  const current = await readConfig(rootDir);
  await fs.writeFile(path.join(rootDir, "swarmvault.config.json"), `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`, "utf8");
}

describe("watch root resolution", () => {
  it("falls back to auto-discovery when config.watch is absent", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const roots = await resolveWatchedRepoRoots(rootDir);
    expect(roots).toEqual([]);
  });

  it("returns the explicit config.watch.repoRoots list when set", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const repoOne = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-repoOne-"));
    const repoTwo = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-repoTwo-"));
    tempDirs.push(repoOne, repoTwo);
    await writeConfig(rootDir, { watch: { repoRoots: [repoOne, repoTwo] } });
    const roots = await resolveWatchedRepoRoots(rootDir);
    expect(roots).toEqual([path.resolve(repoOne), path.resolve(repoTwo)].sort((left, right) => left.localeCompare(right)));
  });

  it("honors excludeRepoRoots deny list", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const keep = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-keep-"));
    const drop = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-drop-"));
    tempDirs.push(keep, drop);
    await writeConfig(rootDir, { watch: { repoRoots: [keep, drop], excludeRepoRoots: [drop] } });
    const roots = await resolveWatchedRepoRoots(rootDir);
    expect(roots).toEqual([path.resolve(keep)]);
  });

  it("uses overrideRoots verbatim and skips config and discovery", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const custom = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-custom-"));
    tempDirs.push(custom);
    await writeConfig(rootDir, { watch: { repoRoots: ["/should/be/ignored"], excludeRepoRoots: [custom] } });
    const roots = await resolveWatchedRepoRoots(rootDir, { overrideRoots: [custom] });
    expect(roots).toEqual([path.resolve(custom)]);
  });

  it("resolves relative paths in config.watch.repoRoots against the vault root", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const nested = path.join(rootDir, "nested-repo");
    await fs.mkdir(nested, { recursive: true });
    await writeConfig(rootDir, { watch: { repoRoots: ["nested-repo"] } });
    const roots = await resolveWatchedRepoRoots(rootDir);
    expect(roots).toEqual([path.resolve(nested)]);
  });

  it("listWatchedRoots matches resolveWatchedRepoRoots output", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-repo-"));
    tempDirs.push(repo);
    await writeConfig(rootDir, { watch: { repoRoots: [repo] } });
    const [a, b] = await Promise.all([listWatchedRoots(rootDir), resolveWatchedRepoRoots(rootDir)]);
    expect(a).toEqual(b);
  });
});

describe("watch root persistence", () => {
  it("addWatchedRoot writes a deduped path into swarmvault.config.json", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-add-"));
    tempDirs.push(repo);
    const added = await addWatchedRoot(rootDir, repo);
    expect(added).toBe(path.resolve(repo));
    const stored = (await readConfig(rootDir)) as { watch?: { repoRoots?: string[] } };
    expect(stored.watch?.repoRoots).toEqual([path.resolve(repo)]);
    await addWatchedRoot(rootDir, repo);
    const storedAgain = (await readConfig(rootDir)) as { watch?: { repoRoots?: string[] } };
    expect(storedAgain.watch?.repoRoots).toEqual([path.resolve(repo)]);
  });

  it("removeWatchedRoot removes the path and returns true", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-remove-"));
    tempDirs.push(repo);
    await addWatchedRoot(rootDir, repo);
    const removed = await removeWatchedRoot(rootDir, repo);
    expect(removed).toBe(true);
    const stored = (await readConfig(rootDir)) as { watch?: { repoRoots?: string[] } };
    expect(stored.watch?.repoRoots).toBeUndefined();
  });

  it("removeWatchedRoot is a no-op when the path was not persisted", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const removed = await removeWatchedRoot(rootDir, "/does/not/exist");
    expect(removed).toBe(false);
  });
});
