import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ensureDir, fileExists, readJsonFile, writeJsonFile } from "./utils.js";
import { providerCapabilitySchema, providerTypeSchema, type ResolvedPaths, type VaultConfig } from "./types.js";

const PRIMARY_CONFIG_FILENAME = "swarmvault.config.json";
const LEGACY_CONFIG_FILENAME = "vault.config.json";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const providerConfigSchema = z.object({
  type: providerTypeSchema,
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  module: z.string().min(1).optional(),
  capabilities: z.array(providerCapabilitySchema).optional(),
  apiStyle: z.enum(["responses", "chat"]).optional()
});

const vaultConfigSchema = z.object({
  workspace: z.object({
    rawDir: z.string().min(1),
    wikiDir: z.string().min(1),
    stateDir: z.string().min(1),
    agentDir: z.string().min(1)
  }),
  providers: z.record(z.string(), providerConfigSchema),
  tasks: z.object({
    compileProvider: z.string().min(1),
    queryProvider: z.string().min(1),
    lintProvider: z.string().min(1),
    visionProvider: z.string().min(1)
  }),
  viewer: z.object({
    port: z.number().int().positive()
  }),
  agents: z.array(z.enum(["codex", "claude", "cursor"])).default(["codex", "claude", "cursor"])
});

export function defaultVaultConfig(): VaultConfig {
  return {
    workspace: {
      rawDir: "raw",
      wikiDir: "wiki",
      stateDir: "state",
      agentDir: "agent"
    },
    providers: {
      local: {
        type: "heuristic",
        model: "heuristic-v1",
        capabilities: ["chat", "structured", "vision", "local"]
      }
    },
    tasks: {
      compileProvider: "local",
      queryProvider: "local",
      lintProvider: "local",
      visionProvider: "local"
    },
    viewer: {
      port: 4123
    },
    agents: ["codex", "claude", "cursor"]
  };
}

async function findConfigPath(rootDir: string): Promise<string> {
  const primaryPath = path.join(rootDir, PRIMARY_CONFIG_FILENAME);
  if (await fileExists(primaryPath)) {
    return primaryPath;
  }

  const legacyPath = path.join(rootDir, LEGACY_CONFIG_FILENAME);
  if (await fileExists(legacyPath)) {
    return legacyPath;
  }

  return primaryPath;
}

export function resolvePaths(rootDir: string, config?: VaultConfig, configPath = path.join(rootDir, PRIMARY_CONFIG_FILENAME)): ResolvedPaths {
  const effective = config ?? defaultVaultConfig();
  const rawDir = path.resolve(rootDir, effective.workspace.rawDir);
  const wikiDir = path.resolve(rootDir, effective.workspace.wikiDir);
  const stateDir = path.resolve(rootDir, effective.workspace.stateDir);
  const agentDir = path.resolve(rootDir, effective.workspace.agentDir);

  return {
    rootDir,
    rawDir,
    wikiDir,
    stateDir,
    agentDir,
    manifestsDir: path.join(stateDir, "manifests"),
    extractsDir: path.join(stateDir, "extracts"),
    analysesDir: path.join(stateDir, "analyses"),
    viewerDistDir: path.resolve(moduleDir, "viewer"),
    graphPath: path.join(stateDir, "graph.json"),
    searchDbPath: path.join(stateDir, "search.sqlite"),
    compileStatePath: path.join(stateDir, "compile-state.json"),
    configPath
  };
}

export async function loadVaultConfig(rootDir: string): Promise<{ config: VaultConfig; paths: ResolvedPaths }> {
  const configPath = await findConfigPath(rootDir);
  const raw = await readJsonFile<unknown>(configPath);
  const parsed = vaultConfigSchema.parse(raw ?? defaultVaultConfig());
  return {
    config: parsed,
    paths: resolvePaths(rootDir, parsed, configPath)
  };
}

export async function initWorkspace(rootDir: string): Promise<{ config: VaultConfig; paths: ResolvedPaths }> {
  const configPath = await findConfigPath(rootDir);
  const config = (await fileExists(configPath)) ? (await loadVaultConfig(rootDir)).config : defaultVaultConfig();
  const paths = resolvePaths(rootDir, config, configPath);

  await Promise.all([
    ensureDir(paths.rawDir),
    ensureDir(paths.wikiDir),
    ensureDir(paths.stateDir),
    ensureDir(paths.agentDir),
    ensureDir(paths.manifestsDir),
    ensureDir(paths.extractsDir),
    ensureDir(paths.analysesDir)
  ]);

  if (!(await fileExists(configPath))) {
    await writeJsonFile(configPath, config);
  }

  return { config, paths };
}
