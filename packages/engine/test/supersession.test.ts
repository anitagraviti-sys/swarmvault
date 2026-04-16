import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import matter from "gray-matter";
import { afterEach, describe, expect, it } from "vitest";
import { compileVault, createSupersessionEdge, ingestInput, initVault, lintVault } from "../src/index.js";
import type { GraphArtifact } from "../src/types.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-supersede-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function readGraph(rootDir: string): Promise<GraphArtifact> {
  const raw = await fs.readFile(path.join(rootDir, "state", "graph.json"), "utf8");
  return JSON.parse(raw) as GraphArtifact;
}

describe("graph supersession", () => {
  it("writes a superseded_by edge and marks the old page stale on disk", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    await fs.writeFile(
      path.join(rootDir, "first.md"),
      [
        "# First Claim",
        "",
        "SwarmVault initially considered manifests to be the single source of truth.",
        "That assumption does not match the current compile flow."
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(rootDir, "second.md"),
      [
        "# Second Claim",
        "",
        "SwarmVault compiles manifests into graph-backed pages.",
        "Multiple manifests can feed a single compiled page."
      ].join("\n"),
      "utf8"
    );

    const first = await ingestInput(rootDir, "first.md");
    const second = await ingestInput(rootDir, "second.md");
    await compileVault(rootDir);

    const result = await createSupersessionEdge(rootDir, `source:${first.sourceId}`, `source:${second.sourceId}`);
    expect(result.oldPageId).toBe(`source:${first.sourceId}`);
    expect(result.newPageId).toBe(`source:${second.sourceId}`);
    expect(result.edgeId).toContain("superseded_by");

    const graph = await readGraph(rootDir);
    const edge = graph.edges.find((candidate) => candidate.relation === "superseded_by");
    expect(edge).toBeDefined();
    expect(edge?.provenance).toEqual([`source:${first.sourceId}`, `source:${second.sourceId}`]);
    const supersededPage = graph.pages.find((page) => page.id === `source:${first.sourceId}`);
    expect(supersededPage?.supersededBy).toBe(`source:${second.sourceId}`);
    expect(supersededPage?.freshness).toBe("stale");

    const oldPageOnDisk = matter(await fs.readFile(path.join(rootDir, "wiki", "sources", `${first.sourceId}.md`), "utf8"));
    expect(oldPageOnDisk.data.superseded_by).toBe(`source:${second.sourceId}`);
    expect(oldPageOnDisk.data.freshness).toBe("stale");
    expect(oldPageOnDisk.data.decay_score).toBe(0);
  });

  it("surfaces a broken_supersession lint finding when supersededBy points to a missing page", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    await fs.writeFile(
      path.join(rootDir, "only.md"),
      ["# Only Claim", "", "SwarmVault tracks raw/ as the immutable source input."].join("\n"),
      "utf8"
    );
    const only = await ingestInput(rootDir, "only.md");
    await compileVault(rootDir);

    // Tamper with the graph to simulate a dangling supersededBy reference.
    const graphPath = path.join(rootDir, "state", "graph.json");
    const graph = JSON.parse(await fs.readFile(graphPath, "utf8")) as GraphArtifact;
    const pageId = `source:${only.sourceId}`;
    const nextPages = graph.pages.map((page) =>
      page.id === pageId ? { ...page, supersededBy: "source:ghost", freshness: "stale" as const } : page
    );
    await fs.writeFile(graphPath, JSON.stringify({ ...graph, pages: nextPages }, null, 2), "utf8");

    const findings = await lintVault(rootDir, { decay: true });
    const codes = findings.map((finding) => finding.code);
    expect(codes).toContain("broken_supersession");
  });

  it("flags decayed pages without supersession via the decay lint", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    // Write a very short half-life into config so our pages decay past the threshold immediately.
    const configPath = path.join(rootDir, "swarmvault.config.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    config.freshness = {
      defaultHalfLifeDays: 0.0001,
      staleThreshold: 0.5,
      halfLifeDaysBySourceClass: {
        first_party: 0.0001,
        third_party: 0.0001,
        resource: 0.0001,
        generated: 0.0001
      }
    };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    await fs.writeFile(
      path.join(rootDir, "note.md"),
      ["# Note Claim", "", "SwarmVault keeps the wiki freshness metadata alongside decay scores."].join("\n"),
      "utf8"
    );
    const note = await ingestInput(rootDir, "note.md");
    await compileVault(rootDir);

    // Backdate lastConfirmedAt so the decay drops well below the configured threshold.
    const graphPath = path.join(rootDir, "state", "graph.json");
    const graph = JSON.parse(await fs.readFile(graphPath, "utf8")) as GraphArtifact;
    const pageId = `source:${note.sourceId}`;
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString();
    const nextPages = graph.pages.map((page) =>
      page.id === pageId ? { ...page, lastConfirmedAt: past, decayScore: 0.0001, freshness: "stale" as const } : page
    );
    await fs.writeFile(graphPath, JSON.stringify({ ...graph, pages: nextPages }, null, 2), "utf8");

    const findings = await lintVault(rootDir, { decay: true });
    const decayed = findings.filter((finding) => finding.code === "decayed-pages");
    expect(decayed.length).toBeGreaterThanOrEqual(1);
    expect(decayed[0]?.relatedPageIds?.[0]).toBe(pageId);
  });
});
