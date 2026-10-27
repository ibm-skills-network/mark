import {
  abridgeTable,
  abridgeText,
  COST_CEILING_USD,
  estimateCallCostUsd,
  estimateCostUsd,
  estimateTextTokens,
  filePriority,
  MAX_TOKENS_PER_SUBMISSION,
  skipReason,
} from "./limits";

describe("skipReason", () => {
  it.each([
    "node_modules/react/index.js",
    "app/node_modules/x.js",
    ".git/config",
    "proj/.venv/lib/site.py",
    "venv/bin/python",
    "env/lib/x.py",
    "src/__pycache__/a.cpython-311.pyc",
    "nb/.ipynb_checkpoints/a-checkpoint.ipynb",
    "dist/bundle.js",
    "build/out.txt",
    "target/classes/A.class",
    ".next/server.js",
    "coverage/lcov.info",
    "vendor/lib.php",
    ".idea/workspace.xml",
    ".vscode/settings.json",
    "__MACOSX/._a.py",
    ".DS_Store",
    "sub/package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "Pipfile.lock",
    "static/app.min.js",
    "static/site.min.css",
    "static/app.js.map",
    "tool.exe",
    "lib.dll",
    "lib.so",
    "Main.class",
    "app.jar",
    "mod.pyc",
    "main.o",
    "app.wasm",
    "weights.h5",
    "model.pt",
    "model.pkl",
    "model.onnx",
    "blob.bin",
  ])("skips %s", (path) => {
    expect(skipReason(path)).toBeDefined();
  });

  it.each([
    "src/app.py",
    "README.md",
    "data/sales.csv",
    "notebook.ipynb",
    "environment.yml",
    "builder.py",
  ])("reads %s", (path) => {
    expect(skipReason(path)).toBeUndefined();
  });
});

describe("filePriority", () => {
  const question = "Upload sales_report.xlsx and the script that builds it.";
  it("puts files named in the question first, then code and docs, then data, then the rest", () => {
    expect(filePriority("work/sales_report.xlsx", question)).toBe(0);
    expect(filePriority("build.py", question)).toBe(1);
    expect(filePriority("notes.pdf", question)).toBe(1);
    expect(filePriority("raw.csv", question)).toBe(2);
    expect(filePriority("photo.png", question)).toBe(3);
  });
});

describe("abridging", () => {
  it("leaves short text alone", () => {
    expect(abridgeText("short", 100)).toBe("short");
  });

  it("keeps header, first 200 and last 20 rows of a table, with counts", () => {
    const rows = Array.from(
      { length: 1000 },
      (_, index) => `${index + 1},${"x".repeat(50)}`,
    );
    const text = abridgeTable(["n,v", ...rows].join("\n"), 10_000);
    expect(text.split("\n")[0]).toBe(
      "[abridged: 1000 data rows × 2 columns; rows 201–980 omitted]",
    );
    expect(text).toContain("\n200,");
    expect(text).not.toContain("\n201,");
    expect(text).toContain("\n981,");
    expect(text).toContain("[... rows 201–980 omitted ...]");
    expect(estimateTextTokens(text)).toBeLessThanOrEqual(10_000);
  });

  it("cuts other text to its start and end with a marker under the cap", () => {
    const text = abridgeText(`HEAD${"y".repeat(100_000)}TAIL`, 1000);
    expect(text.startsWith("[abridged:")).toBe(true);
    expect(text).toContain("HEAD");
    expect(text).toContain("TAIL");
    expect(estimateTextTokens(text)).toBeLessThanOrEqual(1000);
  });
});

describe("cost", () => {
  it("prices input, cached input and output", () => {
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      }),
    ).toBeCloseTo(0.1);
    expect(
      estimateCostUsd({
        inputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(0.01);
    expect(
      estimateCostUsd({ inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBeCloseTo(0.5);
  });

  it("fits a full-budget submission and its retry under the ceiling", () => {
    const first = estimateCallCostUsd(MAX_TOKENS_PER_SUBMISSION);
    expect(first).toBeLessThan(COST_CEILING_USD);
  });
});
