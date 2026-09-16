/**
 * @jest-environment jsdom
 */

import { normalizeQuillHtml } from "rich-text";

/**
 * The shared package takes its HTML parser from the caller so that no Node DOM
 * implementation can be pulled into the browser bundle. In a browser it falls
 * back to the platform's own `DOMParser`, and that fallback is only exercised
 * here — the package's own suite injects a parser, because that is the path the
 * database backfill takes.
 */
describe("normalizeQuillHtml in a browser", () => {
  it("converts stored markup without being given a parser", () => {
    const { html, changes, rulesFired } = normalizeQuillHtml(
      '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>Alpha</li></ol>',
    );

    expect(html).toBe("<ul><li>Alpha</li></ul>");
    expect(changes).toBeGreaterThan(0);
    expect(rulesFired).toEqual(
      expect.arrayContaining(["strip-editor-chrome", "lists"]),
    );
  });

  it("leaves content the current editor already produces untouched", () => {
    const source = "<p>Hello</p><ul><li>Alpha</li></ul>";
    const result = normalizeQuillHtml(source);

    expect(result.html).toBe(source);
    expect(result.changes).toBe(0);
  });
});
