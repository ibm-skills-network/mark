import { sanitizeUnicodeForJson } from "./sanitize-unicode";

describe("sanitizeUnicodeForJson", () => {
  it("passes clean strings through untouched", () => {
    const { value, replaced } = sanitizeUnicodeForJson("hello 🌍 world");
    expect(value).toBe("hello 🌍 world");
    expect(replaced).toBe(0);
  });

  it("replaces a lone high surrogate", () => {
    const broken = "oops \uD83D end";
    const { value, replaced } = sanitizeUnicodeForJson(broken);
    expect(value).toBe("oops � end");
    expect(replaced).toBe(1);
  });

  it("replaces a lone low surrogate", () => {
    const broken = "\uDE00 trailing";
    const { value, replaced } = sanitizeUnicodeForJson(broken);
    expect(value).toBe("� trailing");
    expect(replaced).toBe(1);
  });

  it("preserves valid surrogate pairs", () => {
    const emoji = "🙂"; // U+1F642 = D83D DE42
    const { value, replaced } = sanitizeUnicodeForJson(emoji);
    expect(value).toBe(emoji);
    expect(replaced).toBe(0);
  });

  it("scrubs nested objects and arrays", () => {
    const input = {
      feedback: [{ comment: "ok \uD83D" }, { comment: "fine" }],
      meta: { note: "\uDE00 bad" },
    };
    const { value, replaced } = sanitizeUnicodeForJson(input);
    expect(replaced).toBe(2);
    expect(value).toEqual({
      feedback: [{ comment: "ok �" }, { comment: "fine" }],
      meta: { note: "� bad" },
    });
  });

  it("produces output Postgres-safe JSON can stringify and reparse", () => {
    const input = { s: "x \uD83D y \uDE00 z" };
    const { value } = sanitizeUnicodeForJson(input);
    const round = JSON.parse(JSON.stringify(value)) as { s: string };
    expect(round.s).toBe("x � y � z");
  });

  it("leaves non-plain objects (Date) alone", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const { value } = sanitizeUnicodeForJson({ when: date });
    expect((value as { when: Date }).when).toBe(date);
  });

  it("deletes NUL characters and counts them", () => {
    const broken = "cell A1\u0000cell B1\u0000";
    const { value, replaced } = sanitizeUnicodeForJson(broken);
    expect(value).toBe("cell A1cell B1");
    expect(replaced).toBe(2);
  });

  it("scrubs NULs inside nested feedback the way the persist path sees them", () => {
    const input = {
      feedback: [{ feedback: "extracted: \u0000\u0000binary-ish" }],
      meta: { note: "clean" },
    };
    const { value, replaced } = sanitizeUnicodeForJson(input);
    expect(replaced).toBe(2);
    expect(value).toEqual({
      feedback: [{ feedback: "extracted: binary-ish" }],
      meta: { note: "clean" },
    });
  });

  it("handles NULs and lone surrogates in the same string", () => {
    const broken = "a\u0000b \uD83D c";
    const { value, replaced } = sanitizeUnicodeForJson(broken);
    expect(value).toBe("ab � c");
    expect(replaced).toBe(2);
  });

  it("stringified output contains no \\u0000 escape jsonb would reject", () => {
    const { value } = sanitizeUnicodeForJson({ s: "x\u0000y" });
    expect(JSON.stringify(value)).not.toContain("\\u0000");
  });
});
