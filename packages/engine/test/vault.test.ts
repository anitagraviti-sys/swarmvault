import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  compileVault,
  createMcpServer,
  importInbox,
  ingestInput,
  initVault,
  lintVault,
  queryVault,
  watchVault
} from "../src/index.js";

const tempDirs: string[] = [];
type ToolContent = Array<{ type?: string; text?: string }>;

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-engine-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition.");
}

describe("swarmvault workflow", () => {
  it("initializes the workspace and installs agent instructions", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    await expect(fs.access(path.join(rootDir, "swarmvault.config.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(rootDir, "inbox"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(rootDir, "AGENTS.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(rootDir, "CLAUDE.md"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(rootDir, ".cursor", "rules", "swarmvault.mdc"))).resolves.toBeUndefined();
  });

  it("ingests, compiles, queries, and lints using the heuristic provider", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const notePath = path.join(rootDir, "notes.md");
    await fs.writeFile(
      notePath,
      [
        "# Local-First SwarmVault",
        "",
        "SwarmVault keeps raw sources immutable while compiling a linked markdown wiki.",
        "The system does not rely on a hosted backend.",
        "Graph exports make provenance visible."
      ].join("\n"),
      "utf8"
    );

    const manifest = await ingestInput(rootDir, "notes.md");
    expect(manifest.sourceId).toContain("local-first-swarmvault");

    const compile = await compileVault(rootDir);
    expect(compile.pageCount).toBeGreaterThan(0);

    const query = await queryVault(rootDir, "What does SwarmVault optimize for?", true);
    expect(query.answer).toContain("Question:");
    expect(query.savedTo).toBeTruthy();

    const findings = await lintVault(rootDir);
    expect(findings.some((finding) => finding.code === "graph_missing")).toBe(false);
  });

  it("imports inbox markdown bundles with copied attachments", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    const inboxDir = path.join(rootDir, "inbox");
    const assetsDir = path.join(inboxDir, "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(
      path.join(inboxDir, "clip.md"),
      [
        "# Browser Clip",
        "",
        "SwarmVault can preserve image references from captured markdown.",
        "",
        "![Diagram](assets/diagram.png)"
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(path.join(assetsDir, "diagram.png"), Buffer.from([0, 1, 2, 3]));

    const result = await importInbox(rootDir);
    expect(result.imported).toHaveLength(1);
    expect(result.attachmentCount).toBe(1);
    expect(result.skipped.some((item) => item.reason === "referenced_attachment")).toBe(true);

    const manifest = result.imported[0];
    expect(manifest.attachments).toHaveLength(1);

    const storedMarkdown = await fs.readFile(path.join(rootDir, manifest.storedPath), "utf8");
    expect(storedMarkdown).toContain(`../assets/${manifest.sourceId}/assets/diagram.png`);
  });

  it("exposes vault operations through the MCP server", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const notePath = path.join(rootDir, "notes.md");
    await fs.writeFile(
      notePath,
      [
        "# MCP Test Note",
        "",
        "SwarmVault exposes wiki search and read operations through MCP."
      ].join("\n"),
      "utf8"
    );

    await ingestInput(rootDir, "notes.md");
    await compileVault(rootDir);

    const server = await createMcpServer(rootDir);
    const client = new Client({ name: "swarmvault-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "workspace_info")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "query_vault")).toBe(true);

    const workspaceInfo = await client.callTool({ name: "workspace_info", arguments: {} });
    const workspaceContent = workspaceInfo.content as ToolContent;
    expect(workspaceContent[0]?.type).toBe("text");
    expect(JSON.parse(workspaceContent[0]?.text ?? "{}").rootDir).toBe(rootDir);

    const searchResults = await client.callTool({ name: "search_pages", arguments: { query: "wiki search", limit: 5 } });
    const searchContent = searchResults.content as ToolContent;
    const parsedSearchResults = JSON.parse(searchContent[0]?.text ?? "[]") as Array<{ title?: string; path?: string }>;
    expect(parsedSearchResults.length).toBeGreaterThan(0);
    expect(typeof parsedSearchResults[0]?.title).toBe("string");
    expect(typeof parsedSearchResults[0]?.path).toBe("string");

    const configResource = await client.readResource({ uri: "swarmvault://config" });
    expect(configResource.contents[0]?.uri).toBe("swarmvault://config");
    expect((configResource.contents[0] as { text: string }).text).toContain("\"inboxDir\"");

    await client.close();
    await server.close();
  });

  it("watches the inbox and records automation runs", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);
    const controller = await watchVault(rootDir, { lint: true, debounceMs: 100 });

    try {
      await fs.writeFile(
        path.join(rootDir, "inbox", "watch.md"),
        [
          "# Watch Note",
          "",
          "SwarmVault should import and compile this file when watch mode is running."
        ].join("\n"),
        "utf8"
      );

      await waitFor(async () => {
        const graphPath = path.join(rootDir, "state", "graph.json");
        const jobsPath = path.join(rootDir, "state", "jobs.ndjson");
        return (await fs.stat(graphPath).then(() => true).catch(() => false))
          && (await fs.stat(jobsPath).then(() => true).catch(() => false));
      });

      const jobsLog = await fs.readFile(path.join(rootDir, "state", "jobs.ndjson"), "utf8");
      const runs = jobsLog
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { success: boolean; importedCount: number });

      expect(runs.length).toBeGreaterThan(0);
      expect(runs.at(-1)?.success).toBe(true);
      expect(runs.at(-1)?.importedCount).toBe(1);
    } finally {
      await controller.close();
    }
  });
});
