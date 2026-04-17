import { describe, expect, it } from "vitest";
import { lookupPresetCapabilities, OPENAI_COMPATIBLE_CAPABILITY_MATRIX, withCapabilityFallback } from "../src/index.js";
import type { ProviderAdapter, ProviderCapability } from "../src/types.js";

describe("OpenAI-compatible capability matrix", () => {
  it("declares every known preset", () => {
    const presets = ["openai", "openai-compatible", "openrouter", "groq", "together", "xai", "cerebras", "ollama"];
    for (const preset of presets) {
      expect(OPENAI_COMPATIBLE_CAPABILITY_MATRIX[preset]).toBeDefined();
    }
  });

  it("returns null for unknown preset ids", () => {
    expect(lookupPresetCapabilities("nope")).toBeNull();
  });

  it("reports chat capability for every OpenAI-family preset", () => {
    for (const entry of Object.values(OPENAI_COMPATIBLE_CAPABILITY_MATRIX)) {
      expect(entry.capabilities).toContain("chat");
    }
  });

  it("only claims audio capability for providers that actually have Whisper-style endpoints", () => {
    expect(OPENAI_COMPATIBLE_CAPABILITY_MATRIX.openai.capabilities).toContain("audio");
    expect(OPENAI_COMPATIBLE_CAPABILITY_MATRIX.groq.capabilities).toContain("audio");
    expect(OPENAI_COMPATIBLE_CAPABILITY_MATRIX.ollama.capabilities).toContain("audio");
    expect(OPENAI_COMPATIBLE_CAPABILITY_MATRIX.openrouter.capabilities).not.toContain("audio");
    expect(OPENAI_COMPATIBLE_CAPABILITY_MATRIX.cerebras.capabilities).not.toContain("audio");
    expect(OPENAI_COMPATIBLE_CAPABILITY_MATRIX.xai.capabilities).not.toContain("audio");
  });

  it("only OpenAI claims the responses API capability out of the matrix", () => {
    const withResponses = Object.values(OPENAI_COMPATIBLE_CAPABILITY_MATRIX).filter((entry) => entry.capabilities.includes("responses"));
    expect(withResponses).toHaveLength(1);
    expect(withResponses[0].presetId).toBe("openai");
  });
});

function makeProviderStub(capabilities: ProviderCapability[]): Pick<ProviderAdapter, "capabilities" | "type"> {
  return { capabilities: new Set(capabilities), type: "openai-compatible" };
}

describe("withCapabilityFallback", () => {
  it("runs the primary path when the capability is advertised", async () => {
    const outcome = await withCapabilityFallback(
      makeProviderStub(["chat", "vision"]),
      "vision",
      async () => "primary",
      () => "fallback"
    );
    expect(outcome).toEqual({ supported: true, reason: null, value: "primary" });
  });

  it("falls back and reports unsupported when the capability is absent", async () => {
    const outcome = await withCapabilityFallback(
      makeProviderStub(["chat"]),
      "vision",
      async () => "primary",
      () => "fallback"
    );
    expect(outcome).toEqual({ supported: false, reason: "unsupported", value: "fallback" });
  });

  it("awaits async fallbacks", async () => {
    const outcome = await withCapabilityFallback(
      makeProviderStub(["chat"]),
      "audio",
      async () => "primary",
      async () => "async-fallback"
    );
    expect(outcome.value).toBe("async-fallback");
  });
});
