import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Type-aware rules only lint files inside the tsconfig project, so fixtures
// live under src/ (gitignored) rather than in a temp directory.
const fixtureDirs = {
  src: resolve(root, "src/__lint__"),
  module: resolve(root, "src/modules/__lint__"),
  test: resolve(root, "test/__lint__"),
};

async function ruleIds(
  code: string,
  where: keyof typeof fixtureDirs = "src",
): Promise<string[]> {
  const fixture = resolve(fixtureDirs[where], "sample.ts");
  mkdirSync(dirname(fixture), { recursive: true });
  writeFileSync(fixture, code);
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintFiles([fixture]);
  return (result?.messages ?? []).flatMap((m) => (m.ruleId ? [m.ruleId] : []));
}

afterEach(() => {
  for (const dir of Object.values(fixtureDirs)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("architecture lint rules", () => {
  it.each([
    [
      'import x from "../../api/src/app.module"; export { x };',
      "no-restricted-imports",
    ],
    [
      'import { Injectable } from "@nestjs/common"; export { Injectable };',
      "no-restricted-imports",
    ],
    [
      'import x from "../../api/dist/main"; export { x };',
      "no-restricted-imports",
    ],
    ['import x from "../../api"; export { x };', "no-restricted-imports"],
    ['import "api";', "no-restricted-imports"],
    ['import "jobs/src/x";', "no-restricted-imports"],
    ['import "web";', "no-restricted-imports"],
    [
      "export const a = {} as Foo; interface Foo { b: number }",
      "@typescript-eslint/consistent-type-assertions",
    ],
    ['import "reflect-metadata";', "no-restricted-imports"],
    [
      "function d(..._a: unknown[]): void {}\n@d export class C {}",
      "no-restricted-syntax",
    ],
    [
      'export async function f(): Promise<unknown> { return import("../../api"); }',
      "no-restricted-syntax",
    ],
    [
      'export async function f(): Promise<unknown> { return import("../../jobs/src/x.js"); }',
      "no-restricted-syntax",
    ],
    [
      'export function f(g: () => void, log: { warn(m: string): void }): void { try { g(); } catch { log.warn("x"); } }',
      "no-restricted-syntax",
    ],
    ["export const a: any = 1;", "@typescript-eslint/no-explicit-any"],
    ["export const a = 1 as unknown as string;", "no-restricted-syntax"],
    ["export function f(): void { try { f(); } catch {} }", "no-empty"],
    ["console.log(1);", "no-console"],
  ])("rejects %s", async (code, rule) => {
    expect(await ruleIds(code)).toContain(rule);
  });

  it("accepts apiv3's own api module and a plain `as unknown`", async () => {
    const ids = await ruleIds(
      'import { x } from "../modules/api/routes.js";\nexport const y = x as unknown;\n',
    );
    expect(ids).not.toContain("no-restricted-imports");
    expect(ids).not.toContain("no-restricted-syntax");
  });

  it("rejects a module importing another module's repo", async () => {
    expect(
      await ruleIds(
        'import { r } from "../other/repo.js";\nexport { r };\n',
        "module",
      ),
    ).toContain("no-restricted-imports");
    expect(await ruleIds('import "../other/repo";\n', "module")).toContain(
      "no-restricted-imports",
    );
  });

  it("accepts a module importing another module's schema", async () => {
    expect(
      await ruleIds(
        'import { s } from "../other/schema.js";\nexport { s };\n',
        "module",
      ),
    ).not.toContain("no-restricted-imports");
  });

  it("accepts a dynamic import of apiv3's own modules", async () => {
    expect(
      await ruleIds(
        'export async function f(): Promise<unknown> { return import("../modules/api/routes.js"); }\n',
      ),
    ).not.toContain("no-restricted-syntax");
  });

  it("accepts a catch that logs and then returns", async () => {
    expect(
      await ruleIds(
        'export function f(g: () => number, log: { warn(m: string): void }): number { try { return g(); } catch { log.warn("x"); return 0; } }\n',
      ),
    ).not.toContain("no-restricted-syntax");
  });

  it("accepts clean code", async () => {
    expect(await ruleIds("export const a = 1;\n")).toEqual([]);
  });

  const mock = "declare const m: { (): void; not: unknown };\n";
  it.each([
    ["expect(1).toBeDefined();", "existence-only assertion"],
    ["expect(1).toBeTruthy();", "truthiness-only assertion"],
    [`${mock}expect(m).toHaveBeenCalled();`, "mock-was-called assertion"],
    [`${mock}expect(m).toHaveBeenCalledWith(1);`, "mock-called-with assertion"],
    ['vi.mock("../../src/shared/config.js");', "mocking an apiv3 module"],
  ])("rejects in tests: %s (%s)", async (body, _why) => {
    const code = `import { expect, vi } from "vitest";\nvoid vi;\n${body}\n`;
    expect(await ruleIds(code, "test")).toContain("no-restricted-syntax");
  });

  it("accepts in tests: exact values, call counts, absent calls, external mocks", async () => {
    const code = [
      'import { expect, vi } from "vitest";',
      "declare const m: () => void;",
      "expect(1).toBe(1);",
      "expect(m).toHaveBeenCalledTimes(1);",
      "expect(m).not.toHaveBeenCalled();",
      'vi.mock("openai");',
      "",
    ].join("\n");
    expect(await ruleIds(code, "test")).not.toContain("no-restricted-syntax");
  });

  it("allows existence checks in src", async () => {
    expect(
      await ruleIds(
        "export const f = (x: { toBeDefined(): void }) => x.toBeDefined();\n",
      ),
    ).not.toContain("no-restricted-syntax");
  });
});
