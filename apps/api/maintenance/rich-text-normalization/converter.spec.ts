import { convert } from "./converter";
import { mapJsonStrings, transformEnvelope } from "./json-codec";
import { modelByName } from "./manifest";

jest.mock("canvas", () => null);

const origin = "https://mark.example.test";
const legacy =
  '<p class="ql-indent-2 ql-align-center ql-direction-rtl">old   saved answer <img src="data:image/png;base64,AAAA"></p>';
const response = (
  value: string,
  context = JSON.stringify({ types: ["TEXT"] }),
) =>
  convert(
    modelByName("QuestionResponse"),
    { values: { learnerResponse: value }, context },
    origin,
  );

describe("migration conversion", () => {
  it("detects entity-encoded legacy classes through the DOM", () => {
    const result = response('<p class="&#113;l-align-center">saved</p>');
    expect(result.state).toBe("pending");
    expect(result.after.learnerResponse).toContain("text-align: center");
  });
  it.each([
    legacy,
    JSON.stringify({ nested: legacy }),
    JSON.stringify(JSON.stringify(legacy)),
  ])(
    "inventories legacy feedback without rewriting the response or feedback",
    (feedback) => {
      const snapshot = {
        values: { learnerResponse: legacy },
        context: JSON.stringify({ types: ["TEXT"] }),
        extra: { feedback },
      };
      const result = convert(modelByName("QuestionResponse"), snapshot, origin);
      expect(result.reason).toBe("unclassified-extra-html");
      expect(result.after).toEqual(snapshot.values);
      expect(snapshot.extra.feedback).toBe(feedback);
    },
  );
  it("preserves plain feedback and treats unsupported structured responses conservatively", () => {
    const result = convert(
      modelByName("QuestionResponse"),
      {
        values: { learnerResponse: legacy },
        context: JSON.stringify({ types: ["TEXT"] }),
        extra: {
          feedback: JSON.stringify({ feedback: "Good work", score: 2 }),
        },
      },
      origin,
    );
    expect(result.state).toBe("pending");
    expect(response(JSON.stringify({ answer: legacy })).reason).toBe(
      "structured-text-response",
    );
    expect(
      response(
        JSON.stringify({
          answer: '<p class="ql-align-center" onclick="bad()">saved</p>',
        }),
      ).reason,
    ).toBe("sanitizer-changes-content");
  });
  it("preserves legacy text, spaces, inline images, direction, and indentation", () => {
    const result = response(JSON.stringify(legacy));
    expect(result.state).toBe("pending");
    const html = JSON.parse(result.after.learnerResponse!);
    expect(html).toContain("old   saved answer");
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("6em");
    expect(html).toContain("text-align: center");
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(response(result.after.learnerResponse!).state).toBe("unchanged");
  });
  it.each([
    legacy,
    JSON.stringify(legacy),
    JSON.stringify(JSON.stringify(legacy)),
  ])("retains the response's envelope", (value) => {
    const result = response(value);
    expect(result.state).toBe("pending");
    const depth = (input: string): number => {
      try {
        const inner: unknown = JSON.parse(input);
        return typeof inner === "string" ? 1 + depth(inner) : 0;
      } catch {
        return 0;
      }
    };
    expect(depth(result.after.learnerResponse!)).toBe(depth(value));
  });
  it("does not rewrite code, upload, boolean, choice, or ambiguous historical responses", () => {
    expect(
      response(JSON.stringify(legacy), JSON.stringify({ types: ["UPLOAD"] }))
        .state,
    ).toBe("unchanged");
    expect(
      response(JSON.stringify(legacy), JSON.stringify({ types: [] })).reason,
    ).toBe("ambiguous-response-context");
    expect(
      response(
        JSON.stringify(legacy),
        JSON.stringify({ types: ["TEXT", "UPLOAD"] }),
      ).reason,
    ).toBe("ambiguous-response-context");
    for (const value of [
      "true",
      "false",
      "42",
      "[]",
      "{}",
      JSON.stringify("[an essay]"),
      JSON.stringify("code mentions ql-indent-1"),
    ])
      expect(response(value).state).toBe("unchanged");
  });
  it("preserves checked lists, numbering continuity, and code whitespace/language", () => {
    const value =
      '<ol><li data-list="ordered">first</li><li data-list="bullet">bullet</li><li data-list="ordered">second</li><li data-list="checked">done</li></ol><div class="ql-code-block-container"><div class="ql-code-block" data-language="python">  print(1)</div><div class="ql-code-block" data-language="python">  print(2)</div></div>';
    const result = response(value);
    expect(result.state).toBe("pending");
    expect(result.after.learnerResponse).toContain('start="2"');
    expect(result.after.learnerResponse).toContain('data-checked="true"');
    expect(result.after.learnerResponse).toContain("language-python");
    expect(result.after.learnerResponse).toContain("  print(1)\n  print(2)");
  });
  it("keeps allowed embeds and applies the browser sandbox policy", () => {
    const result = response(
      '<iframe class="ql-video" src="https://www.youtube.com/embed/abc"></iframe>',
    );
    expect(result.state).toBe("pending");
    expect(result.after.learnerResponse).toContain(
      'sandbox="allow-scripts allow-same-origin allow-presentation"',
    );
  });
  it.each([
    '<p class="ql-font-unknown">text</p>',
    '<p class="ql-align-center" onclick="alert(1)">text</p>',
    '<iframe class="ql-video" src="https://evil.example/"></iframe>',
    '<p class="ql-align-center">text<script>alert(1)</script></p>',
    '<span class="ql-ui">real words</span>',
  ])(
    "quarantines unsafe or unsupported content without returning a destructive patch",
    (value) => {
      const result = response(value);
      expect(result.state).toBe("quarantined");
      expect(result.after).toEqual(result.before);
    },
  );
  it("preserves draft array encoding, large numeric tokens, and unrelated fields", () => {
    const draft =
      '[{"id":9007199254740993123,"fraction":1.234567890123456789,"question":' +
      JSON.stringify(legacy) +
      ',"variants":[{"variantContent":' +
      JSON.stringify(legacy) +
      '}],"scoring":{"points":3}}]';
    for (const stored of [draft, JSON.stringify(draft)]) {
      const result = convert(
        modelByName("AssignmentDraft"),
        {
          values: {
            introduction: null,
            instructions: null,
            gradingCriteriaOverview: null,
            questionsData: stored,
          },
          context: null,
        },
        origin,
      );
      expect(result.state).toBe("pending");
      expect(result.after.questionsData).toContain("9007199254740993123");
      expect(result.after.questionsData).toContain("1.234567890123456789");
      expect(result.after.questionsData).toContain("3");
      expect(result.after.introduction).toBeNull();
      expect(result.before.questionsData).toBe(stored);
    }
  });
  it("quarantines unexplained nested HTML and malformed envelopes without logging input", () => {
    const result = convert(
      modelByName("AssignmentDraft"),
      {
        values: {
          introduction: null,
          instructions: null,
          gradingCriteriaOverview: null,
          questionsData: JSON.stringify([{ unknown: legacy }]),
        },
        context: null,
      },
      origin,
    );
    expect(result.reason).toBe("unknown-draft-html-path");
    expect(response('"PRIVATE learner secret').reason).toBe("invalid-document");
    expect(response('"PRIVATE learner secret').reason).not.toContain("PRIVATE");
  });
});

describe("lossless JSON leaf editing", () => {
  it("does not reserialize unaffected tokens", () => {
    const original =
      '{ "text" : "old", "n": 9007199254740993123, "d":1.000000000000000001 }';
    expect(
      mapJsonStrings(original, (value, path) =>
        path[0] === "text" ? "new" : value,
      ),
    ).toBe(original.replace('"old"', '"new"'));
    expect(mapJsonStrings(original, (value) => value)).toBe(original);
  });
  it.each([
    '{"x":1,"x":2}',
    "[1,]",
    '{"x":01}',
    "[true false]",
    '{"x":"unterminated}',
  ])("rejects ambiguous or invalid JSON", (input) => {
    expect(() => mapJsonStrings(input, (value) => value)).toThrow();
  });
  it("bounds repeated wrapping and deep structures", () => {
    let value = legacy;
    for (let index = 0; index < 7; index++) value = JSON.stringify(value);
    expect(() => transformEnvelope(value, (text) => text, "html")).toThrow(
      "envelope-depth-limit",
    );
    expect(() =>
      mapJsonStrings("[".repeat(66) + "0" + "]".repeat(66), (text) => text),
    ).toThrow("json-depth-limit");
  });
});
