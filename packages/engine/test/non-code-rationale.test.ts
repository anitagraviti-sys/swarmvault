import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileVault, ingestInput, initVault } from "../src/index.js";
import { extractRationaleFromMarkdown, extractRationaleFromPlainText } from "../src/markdown-ast.js";
import type { GraphArtifact } from "../src/types.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-non-code-rationale-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("non-code rationale extraction", () => {
  it("extracts rationales from markdown blockquotes and list items under a heading", () => {
    const content = [
      "# Design Notes",
      "",
      "> NOTE: This component is deprecated as of 2026-04.",
      "",
      "- WHY: keep the legacy endpoint for iOS 14 users.",
      ""
    ].join("\n");

    const rationales = extractRationaleFromMarkdown(content, "source-123");

    expect(rationales).toHaveLength(2);
    const note = rationales.find((entry) => entry.kind === "note");
    const why = rationales.find((entry) => entry.kind === "why");
    expect(note).toBeDefined();
    expect(note?.symbolName).toBe("Design Notes");
    expect(note?.text).toBe("This component is deprecated as of 2026-04.");
    expect(note?.citation).toBe("source-123");
    expect(why).toBeDefined();
    expect(why?.symbolName).toBe("Design Notes");
    expect(why?.text).toBe("keep the legacy endpoint for iOS 14 users.");
  });

  it("returns zero rationales when a markdown source has no prefix markers", () => {
    const content = [
      "# Release Plan",
      "",
      "This document outlines the upcoming release cadence and owners.",
      "",
      "> A quoted sentence without any marker prefix.",
      "",
      "- Regular list item describing a deliverable."
    ].join("\n");

    const rationales = extractRationaleFromMarkdown(content, "source-456");
    expect(rationales).toHaveLength(0);
  });

  it("skips non-marker prefixes like `Note that` prose without a colon", () => {
    const content = [
      "# Notes",
      "",
      "> Note that this pattern is fine; the prefix check requires a colon.",
      "",
      "- Regular item discussing rationale work without any leading marker."
    ].join("\n");

    // Neither block begins with one of the fixed marker tokens followed by
    // `:` / `-` / `—`, so the walker emits nothing. This keeps the parser
    // honest: the prefix check never runs on text that has not already been
    // narrowed to a blockquote or list item and it does not false-positive
    // on prose that merely starts with a capitalized marker word.
    const rationales = extractRationaleFromMarkdown(content, "source-789");
    expect(rationales).toHaveLength(0);
  });

  it("matches markers case-insensitively (lowercase `why:` is still a why marker)", () => {
    const content = ["# Heading", "", "- why: keep the retry budget small."].join("\n");
    const rationales = extractRationaleFromMarkdown(content, "source-case");
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("why");
    expect(rationales[0]?.text).toBe("keep the retry budget small.");
  });

  it("anchors later rationales to the most recent heading", () => {
    const content = ["# First", "", "> NOTE: one", "", "## Second", "", "- WHY: two"].join("\n");

    const rationales = extractRationaleFromMarkdown(content, "source-abc");
    expect(rationales).toHaveLength(2);
    expect(rationales[0]?.kind).toBe("note");
    expect(rationales[0]?.symbolName).toBe("First");
    expect(rationales[1]?.kind).toBe("why");
    expect(rationales[1]?.symbolName).toBe("Second");
  });

  it("extracts a single rationale from a plain-text paragraph beginning with HACK:", () => {
    const content = [
      "Background context paragraph with no prefix.",
      "",
      "HACK: bypass retry logic until the upstream API stabilizes.",
      "",
      "Another paragraph without any marker."
    ].join("\n");

    const rationales = extractRationaleFromPlainText(content, "source-xyz", "notes");
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("hack");
    expect(rationales[0]?.text).toBe("bypass retry logic until the upstream API stabilizes.");
    expect(rationales[0]?.symbolName).toBe("notes");
  });

  it("ingests a markdown fixture and exposes rationale nodes and edges in the compiled graph", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    await fs.mkdir(path.join(rootDir, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "docs", "design-notes.md"),
      [
        "# Design Notes",
        "",
        "Introduction paragraph.",
        "",
        "> NOTE: This component is deprecated as of 2026-04.",
        "",
        "- WHY: keep the legacy endpoint for iOS 14 users.",
        ""
      ].join("\n"),
      "utf8"
    );

    const manifest = await ingestInput(rootDir, "docs/design-notes.md");
    expect(manifest.sourceKind).toBe("markdown");

    await compileVault(rootDir);

    const graph = JSON.parse(await fs.readFile(path.join(rootDir, "state", "graph.json"), "utf8")) as GraphArtifact;

    const rationaleNodes = graph.nodes.filter((node) => node.type === "rationale");
    expect(rationaleNodes.length).toBeGreaterThanOrEqual(2);

    const labels = rationaleNodes.map((node) => node.label);
    expect(labels.some((label) => label.includes("deprecated"))).toBe(true);
    expect(labels.some((label) => label.includes("legacy endpoint"))).toBe(true);

    const sourceNodeId = `source:${manifest.sourceId}`;
    const rationaleEdges = graph.edges.filter((edge) => edge.relation === "rationale_for" && edge.target === sourceNodeId);
    expect(rationaleEdges.length).toBeGreaterThanOrEqual(2);
  });
});
