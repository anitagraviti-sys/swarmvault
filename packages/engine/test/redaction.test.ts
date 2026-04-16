import { describe, expect, it } from "vitest";
import { buildConfiguredRedactor, buildRedactor, DEFAULT_REDACTION_PATTERNS, resolveRedactionPatterns } from "../src/redaction.js";

describe("buildRedactor", () => {
  it("is a no-op when no patterns are supplied", () => {
    const redactor = buildRedactor([]);
    const result = redactor.redact("AKIAIOSFODNN7EXAMPLE is an AWS access key id.");
    expect(result.text).toBe("AKIAIOSFODNN7EXAMPLE is an AWS access key id.");
    expect(result.matches).toEqual([]);
  });

  it("redacts an AWS Access Key ID with default patterns", () => {
    const redactor = buildRedactor(DEFAULT_REDACTION_PATTERNS);
    const result = redactor.redact("AWS key: AKIAIOSFODNN7EXAMPLE in config.");
    expect(result.text).toContain("[REDACTED]");
    expect(result.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.matches.some((match) => match.patternId === "aws_access_key_id" && match.count === 1)).toBe(true);
  });

  it("redacts a JWT token", () => {
    const redactor = buildRedactor(DEFAULT_REDACTION_PATTERNS);
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactor.redact(`Bearer token stored: ${jwt}`);
    expect(result.text).not.toContain(jwt);
    expect(result.matches.some((match) => match.patternId === "jwt" && match.count === 1)).toBe(true);
  });

  it("returns accurate per-pattern counts when multiple matches exist", () => {
    const redactor = buildRedactor(DEFAULT_REDACTION_PATTERNS);
    const text = [
      "first: AKIAIOSFODNN7EXAMPLE",
      "second: AKIAJKLMNOPQRSTUVWXY",
      "openai: sk-FIXTUREFIXTUREFIXTUREFIXTUREFIXTUREFI",
      `stripe: sk_${"li"}ve_FIXTUREFIXTUREFIXTUREFIXT`
    ].join("\n");
    const result = redactor.redact(text);
    const awsMatch = result.matches.find((entry) => entry.patternId === "aws_access_key_id");
    const openAiMatch = result.matches.find((entry) => entry.patternId === "openai_api_key");
    const stripeMatch = result.matches.find((entry) => entry.patternId === "stripe_live_key");
    expect(awsMatch?.count).toBe(2);
    expect(openAiMatch?.count).toBe(1);
    expect(stripeMatch?.count).toBe(1);
  });

  it("applies custom string-source patterns resolved from config", () => {
    const resolved = resolveRedactionPatterns({
      enabled: true,
      useDefaults: false,
      patterns: [
        {
          id: "employee_id",
          pattern: "EMP-\\d{6}",
          flags: "g",
          description: "Internal employee identifier"
        }
      ]
    });
    const redactor = buildRedactor(resolved.patterns, resolved.placeholder);
    const result = redactor.redact("Owner: EMP-123456 filed the report.");
    expect(result.text).toContain("[REDACTED]");
    expect(result.text).not.toContain("EMP-123456");
    expect(result.matches).toEqual([{ patternId: "employee_id", count: 1 }]);
  });

  it("preserves the capture-group prefix when redacting Authorization headers", () => {
    const redactor = buildRedactor(DEFAULT_REDACTION_PATTERNS);
    const result = redactor.redact("Authorization: Bearer abc.def.ghi-secret-token-value");
    expect(result.text.toLowerCase()).toContain("authorization: bearer ");
    expect(result.text).toContain("[REDACTED]");
    expect(result.text).not.toContain("abc.def.ghi-secret-token-value");
  });

  it("fails fast with a helpful error when a config pattern is invalid regex", () => {
    expect(() =>
      resolveRedactionPatterns({
        enabled: true,
        useDefaults: false,
        patterns: [{ id: "bad", pattern: "(unclosed" }]
      })
    ).toThrow(/Invalid redaction pattern `bad`/);
  });
});

describe("buildConfiguredRedactor", () => {
  it("returns null when redaction is explicitly disabled", () => {
    const redactor = buildConfiguredRedactor({ enabled: false });
    expect(redactor).toBeNull();
  });

  it("builds a redactor with defaults when no config is provided", () => {
    const redactor = buildConfiguredRedactor(undefined);
    expect(redactor).not.toBeNull();
    const result = redactor?.redact("leaked key: AKIAIOSFODNN7EXAMPLE");
    expect(result?.matches.length).toBe(1);
  });
});
