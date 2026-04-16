import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { afterEach, describe, expect, it } from "vitest";
import { runConsolidation } from "../src/consolidate.js";
import { compileVault, consolidateVault, initVault, lintVault } from "../src/index.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-consolidate-cli-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeInsight(
  rootDir: string,
  params: {
    slug: string;
    title: string;
    nodeIds: string[];
    updatedAt: string;
    tier?: string;
  }
): Promise<void> {
  const insightsDir = path.join(rootDir, "wiki", "insights");
  await fs.mkdir(insightsDir, { recursive: true });
  const pageId = `insight:${params.slug}`;
  const frontmatter: Record<string, unknown> = {
    page_id: pageId,
    title: params.title,
    kind: "insight",
    node_ids: params.nodeIds,
    source_ids: params.nodeIds.map((id) => id.replace(/^[^:]+:/, "")),
    related_page_ids: [],
    related_node_ids: params.nodeIds,
    related_source_ids: [],
    project_ids: [],
    source_hashes: {},
    source_semantic_hashes: {},
    schema_hash: "",
    status: "active",
    managed_by: "system",
    freshness: "fresh",
    confidence: 1,
    backlinks: [],
    compiled_from: [],
    created_at: params.updatedAt,
    updated_at: params.updatedAt
  };
  if (params.tier) {
    frontmatter.tier = params.tier;
  }
  const body = `# ${params.title}\n\nInsight body.\n`;
  await fs.writeFile(path.join(insightsDir, `${params.slug}.md`), matter.stringify(body, frontmatter), "utf8");
}

describe("swarmvault consolidate CLI surface", () => {
  it("consolidateVault invokes the engine and writes tier pages", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    for (let index = 0; index < 3; index += 1) {
      await writeInsight(rootDir, {
        slug: `cli-${index}`,
        title: `CLI Note ${index}`,
        nodeIds: ["concept:shared-a", "concept:shared-b", `concept:unique-${index}`],
        updatedAt: `2026-04-16T0${index}:00:00.000Z`
      });
    }

    const result = await consolidateVault(rootDir);
    expect(result.newPages.length).toBeGreaterThan(0);
    const episodicDir = path.join(rootDir, "wiki", "insights", "episodic");
    const episodicFiles = await fs.readdir(episodicDir);
    expect(episodicFiles.length).toBeGreaterThan(0);
  });

  it("dry-run invocation returns decisions without writing", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    for (let index = 0; index < 3; index += 1) {
      await writeInsight(rootDir, {
        slug: `dry-${index}`,
        title: `Dry ${index}`,
        nodeIds: ["concept:alpha", "concept:beta", "concept:gamma"],
        updatedAt: `2026-04-16T0${index}:00:00.000Z`
      });
    }
    const result = await runConsolidation(rootDir, {}, undefined, {
      dryRun: true,
      now: new Date("2026-04-16T12:00:00.000Z")
    });
    expect(result.decisions.length).toBeGreaterThan(0);
    const episodicDir = path.join(rootDir, "wiki", "insights", "episodic");
    const dirExists = await fs
      .stat(episodicDir)
      .then(() => true)
      .catch(() => false);
    expect(dirExists).toBe(false);
  });
});

describe("swarmvault lint --tiers surface", () => {
  it("flags working-tier insight pages older than the session window", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    // Seed a compile so there's a graph. Write one old working-tier insight
    // that postdates compile into wiki/insights/.
    await fs.writeFile(path.join(rootDir, "seed.md"), "# Seed\n\nSeed corpus.\n", "utf8");
    await (await import("../src/index.js")).ingestInput(rootDir, "seed.md");
    await compileVault(rootDir, {});

    const stale = "2020-01-01T00:00:00.000Z";
    await writeInsight(rootDir, {
      slug: "stale-working-page",
      title: "Stale Working Page",
      nodeIds: ["concept:alpha"],
      updatedAt: stale
    });
    // Refresh the compiled graph so the insight is picked up.
    await compileVault(rootDir, {});

    // Backdate the graph-stored page updatedAt so the lint classifies it as stale.
    const graphPath = path.join(rootDir, "state", "graph.json");
    const graphRaw = await fs.readFile(graphPath, "utf8");
    const graph = JSON.parse(graphRaw);
    graph.pages = graph.pages.map((page: { id: string; updatedAt?: string }) =>
      page.id === "insight:stale-working-page" ? { ...page, updatedAt: stale } : page
    );
    await fs.writeFile(graphPath, JSON.stringify(graph), "utf8");

    const findings = await lintVault(rootDir, { tiers: true });
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain("stale_working_tier");
  });
});
