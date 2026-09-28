/**
 * @jest-environment jsdom
 */

import { normalizeQuillHtml } from "rich-text";

import { sanitizeHtml } from "@/lib/sanitize-html";

import { prepareStoredHtml } from "../prepare-stored-html";

const calls: string[] = [];

jest.mock("rich-text", () => {
  const actual = jest.requireActual<typeof import("rich-text")>("rich-text");
  return {
    ...actual,
    normalizeQuillHtml: jest.fn(
      (...args: Parameters<typeof actual.normalizeQuillHtml>) => {
        calls.push("normalize");
        return actual.normalizeQuillHtml(...args);
      },
    ),
  };
});

jest.mock("@/lib/sanitize-html", () => {
  const actual = jest.requireActual<typeof import("@/lib/sanitize-html")>(
    "@/lib/sanitize-html",
  );
  return {
    ...actual,
    sanitizeHtml: jest.fn((html: string) => {
      calls.push("sanitize");
      return actual.sanitizeHtml(html);
    }),
  };
});

describe("prepareStoredHtml", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  // The sanitizer's output has to be final: normalizing re-serializes, and
  // doing that after sanitizing is the round trip mutation XSS relies on.
  it("sanitizes last, on the normalized markup", () => {
    const stored =
      '<ol><li data-list="bullet"><img src=x onerror=alert(1)>Alpha</li></ol>';

    const prepared = prepareStoredHtml(stored);

    expect(calls).toEqual(["normalize", "sanitize"]);
    expect(sanitizeHtml).toHaveBeenCalledWith(
      jest.mocked(normalizeQuillHtml).mock.results[0].value.html,
    );
    expect(prepared).toContain("<ul>");
    expect(prepared).not.toMatch(/onerror/i);
  });
});
