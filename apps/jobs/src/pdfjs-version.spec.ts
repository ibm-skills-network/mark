/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Regression guard for the mark-jobs PDF text-extraction outage.
 *
 * mark-jobs declares no pdfjs-dist of its own, so at runtime it resolves the
 * hoisted top-level version. When the repo root pinned pdfjs-dist ^4.x, the
 * jobs image bundled 4.10.38, which silently returns ZERO text items for some
 * PDFs (e.g. tall single-page design exports) — they graded 0 / "no text".
 * pdfjs 5.x extracts them correctly. This test fails if the version the jobs
 * runtime resolves ever regresses below 5.
 */
describe("pdfjs-dist runtime version (mark-jobs resolution)", () => {
  it("resolves to pdfjs-dist >= 5", () => {
    const { version } = require("pdfjs-dist/package.json") as {
      version: string;
    };
    const major = Number(version.split(".")[0]);
    expect(Number.isFinite(major)).toBe(true);
    expect(major).toBeGreaterThanOrEqual(5);
  });
});
