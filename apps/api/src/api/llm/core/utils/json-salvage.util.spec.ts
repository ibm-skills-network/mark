import { extractJsonPayload, sanitizeJsonResponse } from "./json-salvage.util";

describe("sanitizeJsonResponse", () => {
  it("escapes raw control characters inside string values so JSON.parse succeeds", () => {
    // A literal newline + tab inside a JSON string — exactly what code-heavy
    // free-form output produces, and what breaks JSON.parse.
    const raw = '{"code": "line1\nline2\tend"}';
    expect(() => JSON.parse(raw)).toThrow();

    const sanitized = sanitizeJsonResponse(raw);
    const parsed = JSON.parse(sanitized) as { code: string };
    expect(parsed.code).toBe("line1\nline2\tend");
  });

  it("strips a leading BOM and surrounding whitespace", () => {
    const raw = '﻿  {"a": 1}  ';
    expect(JSON.parse(sanitizeJsonResponse(raw))).toEqual({ a: 1 });
  });

  it("leaves already-valid JSON parseable", () => {
    const raw = '{"a": "b", "n": 2}';
    expect(JSON.parse(sanitizeJsonResponse(raw))).toEqual({ a: "b", n: 2 });
  });
});

describe("extractJsonPayload", () => {
  it("pulls the object out of prose-wrapped output", () => {
    const raw = 'Sure! Here is the grade:\n{"points": 3}\nHope that helps.';
    expect(JSON.parse(extractJsonPayload(raw))).toEqual({ points: 3 });
  });

  it("returns the input unchanged when there is no object span", () => {
    expect(extractJsonPayload("no json here")).toBe("no json here");
  });
});
