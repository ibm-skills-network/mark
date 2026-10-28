import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ESLint } from "eslint";

// Contract: v3 stays segregated from legacy code, free of Express, and its
// tests assert observable results. Fixtures are written inside the linted
// trees (gitignored __lint__ folders) and removed afterwards.
jest.setTimeout(60_000);

const root = join(__dirname, "../..");
const fixtures = {
  v3: join(root, "src/v3/__lint__/sample.ts"),
  legacy: join(root, "src/__lint__/sample.ts"),
  v3test: join(root, "test/v3/__lint__/sample.spec.ts"),
};

const eslint = new ESLint({ cwd: root });

async function ruleIds(where: keyof typeof fixtures, code: string) {
  const file = fixtures[where];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
  const [result] = await eslint.lintFiles([file]);
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

afterEach(() => {
  for (const dir of ["src/v3/__lint__", "src/__lint__", "test/v3/__lint__"]) {
    rmSync(join(root, dir), { recursive: true, force: true });
  }
});

describe("v3 source boundaries", () => {
  it.each([
    [
      'import { x } from "src/api/assignment/v2/services/assignment.service";\nexport { x };',
      "legacy module by alias",
    ],
    [
      'import { x } from "../../api/attempt/attempt.module";\nexport { x };',
      "legacy module by relative path",
    ],
    [
      'import { Roles } from "src/auth/role/roles.global.guard";\nexport { Roles };',
      "legacy auth",
    ],
    [
      'import type { Request } from "express";\nexport type R = Request;',
      "express",
    ],
    [
      'import { ExpressAdapter } from "@nestjs/platform-express";\nexport { ExpressAdapter };',
      "platform-express",
    ],
    [
      'import { IsString } from "class-validator";\nexport { IsString };',
      "class-validator",
    ],
  ])("rejects %s (%s)", async (code) => {
    expect(await ruleIds("v3", code)).toContain("no-restricted-imports");
  });

  it.each([
    [
      'import { Controller, Get, Req } from "@nestjs/common";\n@Controller()\nexport class C { @Get() g(@Req() r: unknown) { return r; } }',
      "@Req()",
    ],
    [
      'import { Controller, Get, Res } from "@nestjs/common";\n@Controller()\nexport class C { @Get() g(@Res() r: unknown) { return r; } }',
      "@Res()",
    ],
    [
      "export function f(): void { try { f(); } catch { /* ignore */ } }",
      "empty catch",
    ],
  ])("rejects %s", async (code, _why) => {
    const ids = await ruleIds("v3", code);
    expect(
      ids.some((id) => id === "no-restricted-syntax" || id === "no-empty"),
    ).toBe(true);
  });

  it.each([
    ["export const a: any = 1;", "@typescript-eslint/no-explicit-any"],
    ["console.log(1);", "no-console"],
  ])("rejects %s", async (code, rule) => {
    expect(await ruleIds("v3", code)).toContain(rule);
  });

  it("accepts the shared infrastructure allowlist", async () => {
    const ids = await ruleIds(
      "v3",
      [
        'import { Injectable } from "@nestjs/common";',
        'import { z } from "zod";',
        'import { PrismaService } from "src/database/prisma.service";',
        "@Injectable()",
        "export class S { constructor(readonly p: PrismaService) {} schema = z.string(); }",
        "",
      ].join("\n"),
    );
    expect(ids).not.toContain("no-restricted-imports");
  });
});

describe("legacy code does not import v3", () => {
  it("rejects a legacy file importing v3", async () => {
    expect(
      await ruleIds(
        "legacy",
        'import { V3Module } from "src/v3/v3.module";\nexport { V3Module };',
      ),
    ).toContain("no-restricted-imports");
  });

  it("allows the v3 scope marker in legacy code", async () => {
    expect(
      await ruleIds(
        "legacy",
        'import { isV3Route } from "src/common/v3-scope";\nexport { isV3Route };',
      ),
    ).not.toContain("no-restricted-imports");
  });
});

describe("v3 tests", () => {
  const header = 'import { z } from "zod";\nconst m = jest.fn();\n';
  it.each([
    ["expect(1).toBeDefined();", "existence-only"],
    ["expect(1).toBeTruthy();", "truthiness-only"],
    ["expect(m).toHaveBeenCalled();", "mock was called"],
    ["expect(m).toHaveBeenCalledWith(1);", "mock called with"],
    ['jest.mock("../../src/v3/core/v3-logger");', "mocking a v3 module"],
  ])("rejects %s (%s)", async (body) => {
    expect(
      await ruleIds("v3test", `${header}${body}\nexport const s = z;\n`),
    ).toContain("no-restricted-syntax");
  });

  it("accepts exact values, call counts, absent calls and external mocks", async () => {
    const ids = await ruleIds(
      "v3test",
      [
        header,
        "expect(1).toBe(1);",
        "expect(m).toHaveBeenCalledTimes(1);",
        "expect(m).not.toHaveBeenCalled();",
        'jest.mock("openai");',
        "export const s = z;",
        "",
      ].join("\n"),
    );
    expect(ids).not.toContain("no-restricted-syntax");
    expect(ids.filter((id) => id.startsWith("fatal:"))).toEqual([]);
  });
});

describe("v3 source layout", () => {
  // The import ban is configured per directory depth under src/v3 (0-4).
  it("keeps every v3 file within the depths the lint config covers", () => {
    const tooDeep: string[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "__lint__") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, depth + 1);
        else if (depth > 4) tooDeep.push(path);
      }
    };
    walk(join(root, "src/v3"), 0);
    expect(tooDeep).toEqual([]);
  });
});
