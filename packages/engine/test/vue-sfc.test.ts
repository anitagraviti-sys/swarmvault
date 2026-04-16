import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetTreeSitterLanguageCacheForTests } from "../src/code-tree-sitter.js";
import { compileVault, ingestInput, initVault } from "../src/index.js";
import type { GraphArtifact } from "../src/types.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-vue-sfc-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  resetTreeSitterLanguageCacheForTests();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("Vue SFC script nest-parsing", () => {
  it('extracts imports and symbols from <script setup lang="ts">', async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    // Sibling module that the SFC imports from, so the local import edge has
    // a resolvable target in the code index.
    await fs.mkdir(path.join(rootDir, "vue"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "vue", "bar.ts"),
      ["export const foo = 42;", "export function greet(name: string): string { return 'hi ' + name; }"].join("\n"),
      "utf8"
    );

    await fs.writeFile(
      path.join(rootDir, "vue", "Widget.vue"),
      [
        '<script setup lang="ts">',
        "import { foo } from './bar';",
        "",
        "function greet(): string {",
        "  return 'count=' + String(foo);",
        "}",
        "</script>",
        "",
        "<template>",
        "  <div>{{ greet() }}</div>",
        "</template>"
      ].join("\n"),
      "utf8"
    );

    await ingestInput(rootDir, "vue/bar.ts");
    const widgetManifest = await ingestInput(rootDir, "vue/Widget.vue");
    expect(widgetManifest.language).toBe("vue");

    await compileVault(rootDir);

    const graph = JSON.parse(await fs.readFile(path.join(rootDir, "state", "graph.json"), "utf8")) as GraphArtifact;

    // The outer SFC module node plus the filename-derived component symbol.
    expect(graph.nodes.some((node) => node.type === "module" && node.language === "vue")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "symbol" && node.label === "Widget")).toBe(true);

    // The nested TS analyzer should contribute a function symbol for greet.
    expect(graph.nodes.some((node) => node.type === "symbol" && node.label === "greet")).toBe(true);

    // The nested TS analyzer should add an import edge from the Vue module to
    // the sibling bar.ts module (same relation the TS analyzer produces for
    // any other file).
    const vueModule = graph.nodes.find((node) => node.type === "module" && node.language === "vue");
    expect(vueModule).toBeDefined();
    const importEdges = graph.edges.filter((edge) => edge.source === vueModule?.id && edge.relation === "imports");
    expect(importEdges.length).toBeGreaterThan(0);
  });

  it("parses both <script> and <script setup> blocks in the same SFC", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    await fs.mkdir(path.join(rootDir, "vue"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "vue", "DualWidget.vue"),
      [
        '<script lang="ts">',
        "export function classicHelper(): number { return 1; }",
        "</script>",
        "",
        '<script setup lang="ts">',
        "function setupHelper(): number { return 2; }",
        "</script>",
        "",
        "<template><div /></template>"
      ].join("\n"),
      "utf8"
    );

    await ingestInput(rootDir, "vue/DualWidget.vue");
    await compileVault(rootDir);

    const graph = JSON.parse(await fs.readFile(path.join(rootDir, "state", "graph.json"), "utf8")) as GraphArtifact;
    expect(graph.nodes.some((node) => node.type === "symbol" && node.label === "classicHelper")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "symbol" && node.label === "setupHelper")).toBe(true);
  });

  it("handles Vue SFCs with no <script> block without crashing", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    await fs.mkdir(path.join(rootDir, "vue"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "vue", "TemplateOnly.vue"),
      ["<template>", '  <div id="shell"><SubWidget /></div>', "</template>"].join("\n"),
      "utf8"
    );

    const manifest = await ingestInput(rootDir, "vue/TemplateOnly.vue");
    expect(manifest.language).toBe("vue");

    await compileVault(rootDir);

    const graph = JSON.parse(await fs.readFile(path.join(rootDir, "state", "graph.json"), "utf8")) as GraphArtifact;
    // Outer Vue pass still produces the filename-derived component symbol and
    // the id= anchor and PascalCase component reference.
    expect(graph.nodes.some((node) => node.type === "module" && node.language === "vue")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "symbol" && node.label === "TemplateOnly")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "symbol" && node.label === "shell")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "symbol" && node.label === "SubWidget")).toBe(true);
  });
});
