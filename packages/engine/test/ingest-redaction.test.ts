import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ingestInputDetailed, initVault } from "../src/index.js";

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swarmvault-redaction-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const SECRETS_FIXTURE = [
  "# Secrets Notebook",
  "",
  "This note captures a handful of leaked credentials that should never end up",
  "inside the raw/ store or compiled wiki pages.",
  "",
  "- AWS access key: AKIAIOSFODNN7EXAMPLE",
  "- OpenAI key: sk-FIXTUREFIXTUREFIXTUREFIXTUREFIXTUREFI",
  "- Header value: Authorization: Bearer abc.def.ghi-secret-token-value",
  ""
].join("\n");

describe("ingest redaction", () => {
  it("replaces matched secrets in raw/ and logs a redact entry", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    const inputPath = path.join(rootDir, "notes.md");
    await fs.writeFile(inputPath, SECRETS_FIXTURE, "utf8");

    const result = await ingestInputDetailed(rootDir, inputPath);
    const manifest = [...result.created, ...result.updated][0];
    expect(manifest).toBeDefined();

    const rawSourcePath = path.resolve(rootDir, manifest.storedPath);
    const rawContent = await fs.readFile(rawSourcePath, "utf8");
    expect(rawContent).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(rawContent).not.toContain("sk-FIXTUREFIXTUREFIXTUREFIXTUREFIXTUREFI");
    expect(rawContent).not.toContain("abc.def.ghi-secret-token-value");
    expect(rawContent).toContain("[REDACTED]");

    if (manifest.extractedTextPath) {
      const extractedText = await fs.readFile(path.resolve(rootDir, manifest.extractedTextPath), "utf8");
      expect(extractedText).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(extractedText).toContain("[REDACTED]");
    }

    expect(result.redactions).toBeDefined();
    expect(result.redactions?.length).toBeGreaterThanOrEqual(1);
    const patternIds = (result.redactions ?? []).flatMap((entry) => entry.matches.map((match) => match.patternId));
    expect(patternIds).toContain("aws_access_key_id");
    expect(patternIds).toContain("openai_api_key");

    const logPath = path.join(rootDir, "wiki", "log.md");
    const logContent = await fs.readFile(logPath, "utf8");
    expect(logContent).toContain("redact");
    expect(logContent).toContain("aws_access_key_id=");
  });

  it("honors `redact: false` to skip redaction for this run", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    const inputPath = path.join(rootDir, "notes.md");
    await fs.writeFile(inputPath, SECRETS_FIXTURE, "utf8");

    const result = await ingestInputDetailed(rootDir, inputPath, { redact: false });
    const manifest = [...result.created, ...result.updated][0];
    expect(manifest).toBeDefined();

    const rawSourcePath = path.resolve(rootDir, manifest.storedPath);
    const rawContent = await fs.readFile(rawSourcePath, "utf8");
    expect(rawContent).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(rawContent).not.toContain("[REDACTED]");
    expect(result.redactions).toBeUndefined();
  });

  it("respects `redaction: { enabled: false }` in config", async () => {
    const rootDir = await createTempWorkspace();
    await initVault(rootDir);

    const configPath = path.join(rootDir, "swarmvault.config.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    config.redaction = { enabled: false };
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const inputPath = path.join(rootDir, "notes.md");
    await fs.writeFile(inputPath, SECRETS_FIXTURE, "utf8");

    const result = await ingestInputDetailed(rootDir, inputPath);
    const manifest = [...result.created, ...result.updated][0];
    expect(manifest).toBeDefined();

    const rawSourcePath = path.resolve(rootDir, manifest.storedPath);
    const rawContent = await fs.readFile(rawSourcePath, "utf8");
    expect(rawContent).toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.redactions).toBeUndefined();
  });
});
