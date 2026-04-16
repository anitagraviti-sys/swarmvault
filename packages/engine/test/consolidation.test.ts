import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { afterEach, describe, expect, it } from "vitest";
import { runConsolidation } from "../src/consolidate.js";
import { initVault } from "../src/index.js";
import { loadInsightPages, parseStoredPage } from "../src/pages.js";
import type { GraphPage } from "../src/types.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-consolidation-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

interface InsightInput {
  slug: string;
  title: string;
  nodeIds: string[];
  sourceIds?: string[];
  updatedAt?: string;
  tier?: string;
  consolidatedFromPageIds?: string[];
  projectIds?: string[];
}

async function writeInsight(rootDir: string, input: InsightInput): Promise<void> {
  const insightsDir = path.join(rootDir, "wiki", "insights");
  await fs.mkdir(insightsDir, { recursive: true });
  const relativePath = `insights/${input.slug}.md`;
  const pageId = `insight:${input.slug}`;
  const frontmatter: Record<string, unknown> = {
    page_id: pageId,
    title: input.title,
    kind: "insight",
    node_ids: input.nodeIds,
    source_ids: input.sourceIds ?? input.nodeIds.map((id) => id.replace(/^[^:]+:/, "")),
    related_page_ids: [],
    related_node_ids: input.nodeIds,
    related_source_ids: input.sourceIds ?? [],
    project_ids: input.projectIds ?? [],
    source_hashes: {},
    source_semantic_hashes: {},
    schema_hash: "",
    status: "active",
    managed_by: "system",
    freshness: "fresh",
    confidence: 1,
    backlinks: [],
    compiled_from: input.sourceIds ?? [],
    created_at: input.updatedAt ?? "2026-04-16T00:00:00.000Z",
    updated_at: input.updatedAt ?? "2026-04-16T00:00:00.000Z"
  };
  if (input.tier) {
    frontmatter.tier = input.tier;
  }
  if (input.consolidatedFromPageIds) {
    frontmatter.consolidated_from_page_ids = input.consolidatedFromPageIds;
  }
  const body = `# ${input.title}\n\nSeed insight body.\n`;
  await fs.writeFile(path.join(rootDir, "wiki", relativePath), matter.stringify(body, frontmatter), "utf8");
  void relativePath;
}

describe("runConsolidation — working to episodic", () => {
  it("rolls up working pages that share nodes inside the session window", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    for (let index = 0; index < 3; index += 1) {
      await writeInsight(rootDir, {
        slug: `note-${index}`,
        title: `Note ${index}`,
        nodeIds: ["concept:alpha", "concept:beta", "concept:gamma"],
        sourceIds: [`source-${index}`],
        updatedAt: `2026-04-16T0${index}:00:00.000Z`
      });
    }

    const result = await runConsolidation(rootDir, {}, undefined, {
      now: new Date("2026-04-16T12:00:00.000Z")
    });
    expect(result.newPages.some((page) => page.tier === "episodic")).toBe(true);
    expect(result.promoted.filter((item) => item.toTier === "episodic").length).toBeGreaterThanOrEqual(3);

    const loaded = await loadInsightPages(path.join(rootDir, "wiki"));
    const episodic = loaded.find((stored) => stored.page.tier === "episodic");
    expect(episodic).toBeDefined();
    expect(episodic?.page.consolidatedFromPageIds?.length).toBe(3);
    const worker = loaded.find((stored) => stored.page.path === "insights/note-0.md");
    expect(worker?.page.supersededBy).toBe(episodic?.page.id);
  });

  it("does not roll up when fewer than minPages working pages match", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    for (let index = 0; index < 2; index += 1) {
      await writeInsight(rootDir, {
        slug: `note-${index}`,
        title: `Note ${index}`,
        nodeIds: ["concept:alpha", "concept:beta"],
        sourceIds: [`source-${index}`],
        updatedAt: `2026-04-16T0${index}:00:00.000Z`
      });
    }

    const result = await runConsolidation(rootDir, {}, undefined, {
      now: new Date("2026-04-16T12:00:00.000Z")
    });
    expect(result.newPages.filter((page) => page.tier === "episodic")).toHaveLength(0);
  });

  it("keeps low-overlap working pages in separate groups", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    // Two triples of pages, each triple shares four common nodes within the
    // triple (so a triple groups together) but zero nodes across triples.
    const firstNodes = ["concept:a1", "concept:a2", "concept:a3", "concept:a4"];
    const secondNodes = ["concept:b1", "concept:b2", "concept:b3", "concept:b4"];
    for (let index = 0; index < 3; index += 1) {
      await writeInsight(rootDir, {
        slug: `first-${index}`,
        title: `First ${index}`,
        nodeIds: firstNodes,
        sourceIds: [`first-${index}`],
        updatedAt: `2026-04-16T0${index}:00:00.000Z`
      });
    }
    for (let index = 0; index < 3; index += 1) {
      await writeInsight(rootDir, {
        slug: `second-${index}`,
        title: `Second ${index}`,
        nodeIds: secondNodes,
        sourceIds: [`second-${index}`],
        // Still inside the 24h session window but disjoint nodes -> different group.
        updatedAt: `2026-04-16T1${index}:00:00.000Z`
      });
    }

    const result = await runConsolidation(rootDir, {}, undefined, {
      now: new Date("2026-04-16T23:00:00.000Z")
    });
    const episodicPages = result.newPages.filter((page) => page.tier === "episodic");
    expect(episodicPages.length).toBeGreaterThanOrEqual(2);
    // No episodic page should mix sources from both disjoint triples.
    for (const page of episodicPages) {
      const sourceIds = page.sourceIds;
      const hasFirst = sourceIds.some((id) => id.startsWith("first-"));
      const hasSecond = sourceIds.some((id) => id.startsWith("second-"));
      expect(hasFirst && hasSecond).toBe(false);
    }
  });
});

describe("runConsolidation — episodic to semantic", () => {
  it("promotes a recurring node to a semantic page", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    for (let index = 0; index < 3; index += 1) {
      await writeInsight(rootDir, {
        slug: `episode-${index}`,
        title: `Episode ${index}`,
        nodeIds: ["concept:recurring-hero", `concept:unique-${index}`],
        sourceIds: [`episode-${index}`],
        updatedAt: `2026-04-1${index + 1}T00:00:00.000Z`,
        tier: "episodic",
        consolidatedFromPageIds: [`insight:from-${index}`]
      });
    }

    const result = await runConsolidation(rootDir, {}, undefined, {
      now: new Date("2026-04-16T00:00:00.000Z")
    });
    expect(result.newPages.some((page) => page.tier === "semantic")).toBe(true);
  });
});

describe("runConsolidation — semantic to procedural", () => {
  it("rolls up a workflow sequence when titles carry a shared action verb", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    const verbs = ["Deploy service A", "Deploy service B", "Deploy service C"];
    for (let index = 0; index < verbs.length; index += 1) {
      await writeInsight(rootDir, {
        slug: `deploy-${index}`,
        title: verbs[index] ?? `Deploy ${index}`,
        nodeIds: ["concept:deploy", `concept:service-${index}`],
        sourceIds: [`deploy-${index}`],
        updatedAt: `2026-04-1${index + 1}T00:00:00.000Z`,
        tier: "semantic",
        consolidatedFromPageIds: [`insight:ep-${index}`]
      });
    }

    const result = await runConsolidation(rootDir, {}, undefined, {
      now: new Date("2026-04-16T00:00:00.000Z")
    });
    expect(result.newPages.some((page) => page.tier === "procedural")).toBe(true);
  });
});

describe("runConsolidation — dry run", () => {
  it("returns decisions without writing files", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    for (let index = 0; index < 3; index += 1) {
      await writeInsight(rootDir, {
        slug: `dry-note-${index}`,
        title: `Dry Note ${index}`,
        nodeIds: ["concept:alpha", "concept:beta", "concept:gamma"],
        sourceIds: [`source-${index}`],
        updatedAt: `2026-04-16T0${index}:00:00.000Z`
      });
    }

    const result = await runConsolidation(rootDir, {}, undefined, {
      dryRun: true,
      now: new Date("2026-04-16T12:00:00.000Z")
    });
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.newPages.length).toBeGreaterThan(0);
    const episodicDir = path.join(rootDir, "wiki", "insights", "episodic");
    const exists = await fs
      .stat(episodicDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

describe("runConsolidation — disabled", () => {
  it("is a no-op when config.enabled is false", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    await writeInsight(rootDir, {
      slug: `disabled-note-1`,
      title: `Disabled 1`,
      nodeIds: ["concept:alpha"],
      updatedAt: "2026-04-16T01:00:00.000Z"
    });

    const result = await runConsolidation(rootDir, { enabled: false });
    expect(result.promoted).toHaveLength(0);
    expect(result.newPages).toHaveLength(0);
    expect(result.decisions.some((decision) => decision.includes("disabled"))).toBe(true);
  });
});

describe("tier defaults and frontmatter round-trip", () => {
  it("defaults missing tier to working in memory", () => {
    const content = matter.stringify("# Title\n", {
      page_id: "insight:round-trip",
      title: "Round Trip",
      kind: "insight",
      source_ids: [],
      node_ids: [],
      source_hashes: {},
      source_semantic_hashes: {},
      schema_hash: "",
      freshness: "fresh",
      status: "active",
      managed_by: "system",
      confidence: 1,
      backlinks: [],
      compiled_from: [],
      created_at: "2026-04-16T00:00:00.000Z",
      updated_at: "2026-04-16T00:00:00.000Z",
      related_page_ids: [],
      related_node_ids: [],
      related_source_ids: []
    });
    const page = parseStoredPage("insights/legacy.md", content);
    expect(page.tier).toBe("working");
  });

  it("round-trips tier, consolidated_from_page_ids, and consolidation_confidence", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const insightsDir = path.join(rootDir, "wiki", "insights", "episodic");
    await fs.mkdir(insightsDir, { recursive: true });
    const body = "# Rolled Up\n\nRolled-up digest body.\n";
    const frontmatter: Record<string, unknown> = {
      page_id: "insight:episodic-test",
      title: "Rolled Up",
      kind: "insight",
      tier: "episodic",
      consolidated_from_page_ids: ["insight:a", "insight:b", "insight:c"],
      consolidation_confidence: 0.75,
      source_ids: ["src-1"],
      node_ids: ["concept:shared"],
      source_hashes: {},
      source_semantic_hashes: {},
      schema_hash: "",
      freshness: "fresh",
      status: "active",
      managed_by: "system",
      confidence: 1,
      backlinks: [],
      compiled_from: ["src-1"],
      created_at: "2026-04-16T00:00:00.000Z",
      updated_at: "2026-04-16T00:00:00.000Z",
      related_page_ids: [],
      related_node_ids: [],
      related_source_ids: []
    };
    const filePath = path.join(insightsDir, "episodic-test.md");
    await fs.writeFile(filePath, matter.stringify(body, frontmatter), "utf8");

    const loaded = await loadInsightPages(path.join(rootDir, "wiki"));
    const stored = loaded.find((entry) => entry.page.path.endsWith("episodic-test.md"));
    expect(stored).toBeDefined();
    expect(stored?.page.tier).toBe("episodic");
    expect(stored?.page.consolidatedFromPageIds).toEqual(["insight:a", "insight:b", "insight:c"]);
    expect(stored?.page.consolidationConfidence).toBeCloseTo(0.75, 5);
  });
});

describe("runConsolidation — legacy insights default to working", () => {
  it("rolls up insight pages with no tier field as if they were working", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    for (let index = 0; index < 3; index += 1) {
      // Omit the tier field entirely; writeInsight only sets tier when provided.
      await writeInsight(rootDir, {
        slug: `legacy-${index}`,
        title: `Legacy ${index}`,
        nodeIds: ["concept:alpha", "concept:beta", "concept:gamma"],
        sourceIds: [`legacy-${index}`],
        updatedAt: `2026-04-16T0${index}:00:00.000Z`
      });
    }

    const result = await runConsolidation(rootDir, {}, undefined, {
      now: new Date("2026-04-16T12:00:00.000Z"),
      dryRun: true
    });
    const episodic = result.newPages.filter((page) => page.tier === "episodic");
    expect(episodic.length).toBeGreaterThanOrEqual(1);
    void ({} as GraphPage);
  });
});
