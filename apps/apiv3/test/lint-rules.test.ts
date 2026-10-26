import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { afterEach, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root, "src/__lint__/sample.ts");

async function ruleIds(code: string): Promise<string[]> {
  mkdirSync(dirname(fixture), { recursive: true });
  writeFileSync(fixture, code);
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintFiles([fixture]);
  return (result?.messages ?? []).flatMap((m) => (m.ruleId ? [m.ruleId] : []));
}

afterEach(() => {
  rmSync(fixture, { force: true });
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

  it("accepts clean code", async () => {
    expect(await ruleIds("export const a = 1;\n")).toEqual([]);
  });
});
