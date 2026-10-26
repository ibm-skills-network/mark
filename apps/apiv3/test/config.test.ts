import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/shared/config.js";

const base = { DATABASE_URL: "postgresql://localhost:5432/db" };

describe("loadConfig", () => {
  it("parses a minimal env with defaults", () => {
    expect(loadConfig(base)).toEqual({
      serviceName: "mark-v3",
      port: 3000,
      logLevel: "info",
      databaseUrl: base.DATABASE_URL,
      validateResponses: false,
      consumeWork: false,
      dispatchExternalEffects: false,
      workerHealthPort: 8081,
    });
  });

  it("throws ConfigError naming DATABASE_URL when missing", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => loadConfig({ DATABASE_URL: "mysql://x" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("lists every invalid key", () => {
    expect(() =>
      loadConfig({ ...base, PORT: "abc", LOG_LEVEL: "loud" }),
    ).toThrow(/PORT.*LOG_LEVEL|LOG_LEVEL.*PORT/);
  });

  it("treats only the literal 'true' as true", () => {
    expect(loadConfig({ ...base, V3_CONSUME_WORK: "1" }).consumeWork).toBe(
      false,
    );
    expect(loadConfig({ ...base, V3_CONSUME_WORK: "TRUE" }).consumeWork).toBe(
      false,
    );
    expect(loadConfig({ ...base, V3_CONSUME_WORK: "true" }).consumeWork).toBe(
      true,
    );
    expect(
      loadConfig({ ...base, V3_DISPATCH_EXTERNAL_EFFECTS: "true" })
        .dispatchExternalEffects,
    ).toBe(true);
    expect(
      loadConfig({ ...base, V3_VALIDATE_RESPONSES: "true" }).validateResponses,
    ).toBe(true);
  });
});
