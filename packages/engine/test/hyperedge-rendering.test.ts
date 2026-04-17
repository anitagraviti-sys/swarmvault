import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportGraphFormat, initVault, synthesizeHyperedgeHubs } from "../src/index.js";
import type { GraphArtifact, GraphHyperedge, GraphNode } from "../src/types.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-hyperedge-rendering-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeNode(overrides: Partial<GraphNode> & { id: string; type: string; label: string }): GraphNode {
  return {
    freshness: "fresh",
    confidence: 1,
    sourceIds: [],
    projectIds: [],
    sourceClass: "first_party",
    ...overrides
  };
}

function makeHyperedge(overrides: Partial<GraphHyperedge> & { id: string; nodeIds: string[] }): GraphHyperedge {
  return {
    label: "Group pattern",
    relation: "participate_in",
    evidenceClass: "inferred",
    confidence: 0.6,
    sourcePageIds: [],
    why: "co-occur",
    ...overrides
  };
}

async function writeGraph(rootDir: string, graph: GraphArtifact): Promise<void> {
  await fs.writeFile(path.join(rootDir, "state", "graph.json"), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

function sampleGraphWithHyperedges(): GraphArtifact {
  const nodes = [
    makeNode({ id: "node:alpha", type: "concept", label: "Alpha" }),
    makeNode({ id: "node:beta", type: "concept", label: "Beta" }),
    makeNode({ id: "node:gamma", type: "entity", label: "Gamma" }),
    makeNode({ id: "node:solo", type: "entity", label: "Solo" })
  ];
  const hyperedges = [
    makeHyperedge({ id: "hyper:participate-1", relation: "participate_in", nodeIds: ["node:alpha", "node:beta", "node:gamma"] }),
    makeHyperedge({ id: "hyper:implement-1", relation: "implement", nodeIds: ["node:alpha", "node:beta"] }),
    // Degenerate: one participant → must be skipped.
    makeHyperedge({ id: "hyper:form-lonely", relation: "form", nodeIds: ["node:solo"] })
  ];
  return {
    generatedAt: "2026-04-16T00:00:00.000Z",
    nodes,
    edges: [],
    hyperedges,
    communities: [],
    sources: [],
    pages: []
  };
}

describe("synthesizeHyperedgeHubs", () => {
  it("returns one hub per hyperedge and one edge per participant", () => {
    const graph = sampleGraphWithHyperedges();
    const { hubNodes, hubEdges } = synthesizeHyperedgeHubs(graph.hyperedges, graph.nodes);

    // 2 valid hyperedges (3-way + 2-way) — the 1-participant one is filtered.
    expect(hubNodes).toHaveLength(2);
    expect(hubEdges).toHaveLength(3 + 2);

    for (const hub of hubNodes) {
      const edgesForHub = hubEdges.filter((edge) => edge.hyperedgeId === hub.hyperedgeId);
      expect(edgesForHub).toHaveLength(hub.participantIds.length);
    }
  });

  it("skips degenerate hyperedges with fewer than two participants", () => {
    const graph = sampleGraphWithHyperedges();
    const { hubNodes } = synthesizeHyperedgeHubs(graph.hyperedges, graph.nodes);
    expect(hubNodes.some((hub) => hub.hyperedgeId === "hyper:form-lonely")).toBe(false);
  });

  it("skips participants that aren't in the visible node set", () => {
    const graph = sampleGraphWithHyperedges();
    // Only expose two nodes — the 3-way participate_in hyperedge should
    // degrade to a 2-participant hub instead of being skipped entirely.
    const visibleNodes = graph.nodes.filter((node) => node.id === "node:alpha" || node.id === "node:beta");
    const { hubNodes, hubEdges } = synthesizeHyperedgeHubs(graph.hyperedges, visibleNodes);
    const participateHub = hubNodes.find((hub) => hub.hyperedgeId === "hyper:participate-1");
    expect(participateHub?.participantIds).toEqual(["node:alpha", "node:beta"]);
    const participateEdges = hubEdges.filter((edge) => edge.hyperedgeId === "hyper:participate-1");
    expect(participateEdges).toHaveLength(2);
  });

  it("formats hub ids as hyper:<hyperedgeId> and uses the relation as the label", () => {
    const graph = sampleGraphWithHyperedges();
    const { hubNodes, hubEdges } = synthesizeHyperedgeHubs(graph.hyperedges, graph.nodes);

    const participateHub = hubNodes.find((hub) => hub.hyperedgeId === "hyper:participate-1");
    expect(participateHub?.id).toBe("hyper:hyper:participate-1");
    expect(participateHub?.label).toBe("participate_in");

    const implementHub = hubNodes.find((hub) => hub.hyperedgeId === "hyper:implement-1");
    expect(implementHub?.label).toBe("implement");

    // Hub edges reuse the hub id as the source and point at real participants.
    for (const edge of hubEdges) {
      expect(edge.source.startsWith("hyper:")).toBe(true);
      expect(edge.id.startsWith("hyper-edge:")).toBe(true);
    }
  });

  it("embeds hub nodes and hub edges in the standalone HTML export payload", async () => {
    const root = await createTempWorkspace();
    await initVault(root);
    const graph = sampleGraphWithHyperedges();
    await writeGraph(root, graph);

    const outputPath = path.join(root, "graph.html");
    await exportGraphFormat(root, "html-standalone", outputPath);
    const html = await fs.readFile(outputPath, "utf8");

    // The embedded JSON payload should mention the synthesized hub ids and the
    // relation labels. The vis.js inline JS keys on isHub/isHubEdge to style
    // them, so both flags should be serialized.
    expect(html).toContain(`"id":"hyper:hyper:participate-1"`);
    expect(html).toContain(`"id":"hyper:hyper:implement-1"`);
    expect(html).toContain(`"isHub":true`);
    expect(html).toContain(`"isHubEdge":true`);
    expect(html).toContain(`"label":"participate_in"`);
    // The degenerate one-participant hyperedge must not leak into the payload.
    expect(html).not.toContain("hyper:hyper:form-lonely");
  });
});
