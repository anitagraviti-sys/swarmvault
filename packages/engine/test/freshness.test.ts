import { describe, expect, it } from "vitest";
import { applyDecayToPages, computeDecayScore, DEFAULT_STALE_THRESHOLD, markSuperseded, resetDecay } from "../src/freshness.js";
import type { GraphPage } from "../src/types.js";

const DAY_MS = 1000 * 60 * 60 * 24;

function buildPage(overrides: Partial<GraphPage> = {}): GraphPage {
  const base: GraphPage = {
    id: "source:test",
    path: "sources/test.md",
    title: "Test Page",
    kind: "source",
    sourceIds: ["test"],
    projectIds: [],
    nodeIds: ["source:test"],
    freshness: "fresh",
    status: "active",
    confidence: 1,
    backlinks: [],
    schemaHash: "schema",
    sourceHashes: { test: "hash" },
    sourceSemanticHashes: { test: "semantic" },
    relatedPageIds: [],
    relatedNodeIds: [],
    relatedSourceIds: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    compiledFrom: ["test"],
    managedBy: "system"
  };
  return { ...base, ...overrides };
}

describe("computeDecayScore", () => {
  it("returns 1 when lastConfirmedAt is missing", () => {
    const score = computeDecayScore(undefined, "first_party", {}, new Date());
    expect(score).toBe(1);
  });

  it("returns ~0.5 at one half-life of age", () => {
    const halfLifeDays = 100;
    const now = new Date("2024-06-01T00:00:00.000Z");
    const lastConfirmedAt = new Date(now.getTime() - halfLifeDays * DAY_MS).toISOString();
    const score = computeDecayScore(lastConfirmedAt, undefined, { defaultHalfLifeDays: halfLifeDays }, now);
    expect(score).toBeGreaterThan(0.49);
    expect(score).toBeLessThan(0.51);
  });

  it("returns near 0 after 10 half-lives", () => {
    const halfLifeDays = 30;
    const now = new Date("2024-06-01T00:00:00.000Z");
    const lastConfirmedAt = new Date(now.getTime() - 10 * halfLifeDays * DAY_MS).toISOString();
    const score = computeDecayScore(lastConfirmedAt, undefined, { defaultHalfLifeDays: halfLifeDays }, now);
    expect(score).toBeLessThan(0.01);
  });

  it("honors source-class half-life overrides", () => {
    const now = new Date("2024-06-01T00:00:00.000Z");
    const lastConfirmedAt = new Date(now.getTime() - 30 * DAY_MS).toISOString();
    const generatedScore = computeDecayScore(lastConfirmedAt, "generated", { halfLifeDaysBySourceClass: { generated: 30 } }, now);
    const firstPartyScore = computeDecayScore(lastConfirmedAt, "first_party", { halfLifeDaysBySourceClass: { first_party: 365 } }, now);
    expect(generatedScore).toBeLessThan(firstPartyScore);
    expect(generatedScore).toBeGreaterThan(0.49);
    expect(generatedScore).toBeLessThan(0.51);
  });
});

describe("applyDecayToPages", () => {
  it("marks pages stale when below the threshold", () => {
    const now = new Date("2024-06-01T00:00:00.000Z");
    const freshPage = buildPage({
      id: "fresh",
      lastConfirmedAt: now.toISOString(),
      sourceClass: "first_party"
    });
    const ancientPage = buildPage({
      id: "ancient",
      lastConfirmedAt: new Date(now.getTime() - 365 * 10 * DAY_MS).toISOString(),
      sourceClass: "generated"
    });
    const { updated, markedStale } = applyDecayToPages([freshPage, ancientPage], {}, now);
    expect(markedStale).toContain("ancient");
    expect(markedStale).not.toContain("fresh");
    const ancient = updated.find((page) => page.id === "ancient");
    const fresh = updated.find((page) => page.id === "fresh");
    expect(ancient?.freshness).toBe("stale");
    expect(ancient?.decayScore).toBeLessThan(DEFAULT_STALE_THRESHOLD);
    expect(fresh?.freshness).toBe("fresh");
  });

  it("upgrades a stale page back to fresh when the score is above the threshold and no supersession exists", () => {
    const now = new Date("2024-06-01T00:00:00.000Z");
    const page = buildPage({
      id: "recovered",
      freshness: "stale",
      lastConfirmedAt: now.toISOString()
    });
    const { updated } = applyDecayToPages([page], {}, now);
    const recovered = updated.find((item) => item.id === "recovered");
    expect(recovered?.freshness).toBe("fresh");
    expect(recovered?.decayScore).toBe(1);
  });
});

describe("resetDecay", () => {
  it("restores freshness and sets decayScore to 1", () => {
    const now = new Date("2024-06-01T00:00:00.000Z");
    const stalePage = buildPage({
      freshness: "stale",
      decayScore: 0.05,
      lastConfirmedAt: "2020-01-01T00:00:00.000Z"
    });
    const reset = resetDecay(stalePage, now);
    expect(reset.freshness).toBe("fresh");
    expect(reset.decayScore).toBe(1);
    expect(reset.lastConfirmedAt).toBe(now.toISOString());
  });

  it("keeps freshness stale when the page has been superseded", () => {
    const now = new Date();
    const page = buildPage({ supersededBy: "source:newer" });
    const reset = resetDecay(page, now);
    expect(reset.freshness).toBe("stale");
    expect(reset.decayScore).toBe(1);
  });
});

describe("markSuperseded", () => {
  it("sets stale, decay 0, and supersededBy", () => {
    const now = new Date("2024-06-01T00:00:00.000Z");
    const page = buildPage();
    const next = markSuperseded(page, "source:replacement", now);
    expect(next.supersededBy).toBe("source:replacement");
    expect(next.freshness).toBe("stale");
    expect(next.decayScore).toBe(0);
    expect(next.updatedAt).toBe(now.toISOString());
  });
});
