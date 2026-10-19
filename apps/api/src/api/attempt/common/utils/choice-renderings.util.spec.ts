import type { Choice } from "src/api/assignment/dto/update.questions.request.dto";
import {
  buildChoiceRenderings,
  matchChoiceIgnoringWrappingQuotes,
  parseStoredChoices,
  resolveChoiceAcrossRenderings,
  StoredChoiceTranslation,
} from "./choice-renderings.util";

const authored: Choice[] = [
  { choice: "A normal transaction", points: 0, isCorrect: false },
  { choice: "A potential anomaly", points: 1, isCorrect: true },
];
const zh: Choice[] = [
  { choice: "正常交易", points: 0, isCorrect: false },
  { choice: "潜在的异常", points: 1, isCorrect: true },
];
const variant: Choice[] = [
  { choice: "An unusual pattern", points: 1, isCorrect: true },
  { choice: "A routine order", points: 0, isCorrect: false },
];
const variantKo: Choice[] = [
  { choice: "특이한 패턴", points: 1, isCorrect: true },
  { choice: "일상적인 주문", points: 0, isCorrect: false },
];

const row = (
  languageCode: string,
  translatedChoices: unknown,
  untranslatedChoices: unknown,
  variantId: number | null = null,
): StoredChoiceTranslation => ({
  languageCode,
  variantId,
  translatedChoices,
  untranslatedChoices,
});

describe("parseStoredChoices", () => {
  it("reads an array, a JSON string, a double-encoded string and a { choices } wrapper", () => {
    expect(parseStoredChoices(zh)).toEqual(zh);
    expect(parseStoredChoices(JSON.stringify(zh))).toEqual(zh);
    expect(parseStoredChoices(JSON.stringify(JSON.stringify(zh)))).toEqual(zh);
    expect(parseStoredChoices({ choices: zh })).toEqual(zh);
  });

  it("rejects anything that is not a list of choices", () => {
    expect(parseStoredChoices("not json")).toBeUndefined();
    expect(parseStoredChoices(null)).toBeUndefined();
    expect(parseStoredChoices([{ text: "x" }])).toBeUndefined();
  });
});

describe("buildChoiceRenderings", () => {
  it("lines up the authored choices with every translation made from them", () => {
    const renderings = buildChoiceRenderings({
      ownChoices: authored,
      variantId: null,
      rows: [
        row("zh-CN", zh, JSON.stringify(authored)),
        row("en", authored, JSON.stringify(authored)),
      ],
    });

    expect(renderings.map((r) => r.source)).toEqual([
      "authored",
      "translation:zh-CN",
      "translation:en",
    ]);
    expect(renderings.every((r) => r.aligned !== false)).toBe(true);
  });

  it("drops a translation made from choices the author has since changed", () => {
    const renderings = buildChoiceRenderings({
      ownChoices: authored,
      variantId: null,
      rows: [
        row(
          "zh-CN",
          zh,
          JSON.stringify([
            { choice: "Old wording", isCorrect: false },
            { choice: "A potential anomaly", isCorrect: true },
          ]),
        ),
      ],
    });

    expect(renderings.map((r) => r.source)).toEqual(["authored"]);
  });

  it("for a variant, adds the base translation only where the variant has none, and never by index", () => {
    const renderings = buildChoiceRenderings({
      ownChoices: variant,
      baseChoices: authored,
      variantId: 1778,
      rows: [
        row("zh-CN", zh, authored),
        row("ko", authored, authored),
        row("en", authored, authored),
        row("ko", variantKo, variant, 1778),
      ],
    });

    expect(renderings).toEqual([
      { source: "authored", choices: variant },
      { source: "translation:ko", choices: variantKo },
      { source: "base-translation:zh-CN", choices: zh, aligned: false },
    ]);
  });

  it("treats base translations as in order when the variant reuses the base choices", () => {
    const renderings = buildChoiceRenderings({
      ownChoices: authored,
      baseChoices: authored,
      variantId: 5,
      rows: [row("zh-CN", zh, authored)],
    });

    expect(renderings[1]).toEqual({
      source: "base-translation:zh-CN",
      choices: zh,
      aligned: true,
    });
  });
});

describe("resolveChoiceAcrossRenderings", () => {
  it("maps an aligned match onto the grading choice at the same position", () => {
    const result = resolveChoiceAcrossRenderings("潜在的异常", authored, [
      { source: "translation:zh-CN", choices: zh },
    ]);

    expect(result).toEqual({
      kind: "matched",
      choice: authored[1],
      gradingIndex: 1,
      sources: ["translation:zh-CN"],
    });
  });

  it("does not index-map a set whose answer key differs from the grading set", () => {
    const shuffled = [zh[1], zh[0]];
    const result = resolveChoiceAcrossRenderings("潜在的异常", authored, [
      { source: "translation:zh-CN", choices: shuffled },
    ]);

    expect(result).toMatchObject({ kind: "matched", choice: zh[1] });
    expect(result.kind === "matched" && result.gradingIndex).toBeUndefined();
  });

  it("only uses sets in the grading order when asked to", () => {
    const result = resolveChoiceAcrossRenderings(
      "潜在的异常",
      authored,
      [{ source: "base-translation:zh-CN", choices: zh, aligned: false }],
      { alignedOnly: true },
    );

    expect(result).toEqual({ kind: "none" });
  });

  it("calls a text ambiguous when its matches would score differently", () => {
    const result = resolveChoiceAcrossRenderings("same", authored, [
      {
        source: "translation:a",
        choices: [
          { choice: "same", points: 0, isCorrect: false },
          { choice: "y", points: 1, isCorrect: true },
        ],
      },
      {
        source: "translation:b",
        choices: [
          { choice: "x", points: 0, isCorrect: false },
          { choice: "same", points: 1, isCorrect: true },
        ],
      },
    ]);

    expect(result.kind).toBe("ambiguous");
  });
});

describe("matchChoiceIgnoringWrappingQuotes", () => {
  const quoted: Choice[] = [
    { choice: '"Alpha"', points: 1, isCorrect: true },
    { choice: "\u201CBeta\u201D", points: 0, isCorrect: false },
    { choice: 'Say "Gamma"', points: 0, isCorrect: false },
  ];

  it("matches text that lost straight or curly quotes around the choice", () => {
    expect(matchChoiceIgnoringWrappingQuotes("alpha", quoted)).toEqual({
      kind: "matched",
      index: 0,
    });
    expect(matchChoiceIgnoringWrappingQuotes(" Beta ", quoted)).toEqual({
      kind: "matched",
      index: 1,
    });
  });

  it("keeps quotation marks inside the text significant", () => {
    expect(matchChoiceIgnoringWrappingQuotes("Say Gamma", quoted).kind).toBe(
      "none",
    );
  });

  it("is ambiguous when two choices read the same without quotes", () => {
    expect(
      matchChoiceIgnoringWrappingQuotes("yes", [
        { choice: '"yes"', points: 1, isCorrect: true },
        { choice: "yes", points: 0, isCorrect: false },
      ]),
    ).toEqual({ kind: "ambiguous", indexes: [0, 1] });
  });

  it("matches nothing for empty or quote-only text", () => {
    expect(matchChoiceIgnoringWrappingQuotes('""', quoted).kind).toBe("none");
    expect(matchChoiceIgnoringWrappingQuotes("", quoted).kind).toBe("none");
  });
});

describe("resolveChoiceAcrossRenderings with quoted choices", () => {
  const quotedZh: Choice[] = [
    { choice: "\u201C正常交易\u201D", points: 0, isCorrect: false },
    { choice: "\u201C潜在的异常\u201D", points: 1, isCorrect: true },
  ];

  it("maps a translated pick that lost its quotes onto the grading set", () => {
    const result = resolveChoiceAcrossRenderings("潜在的异常", authored, [
      { source: "translation:zh-CN", choices: quotedZh },
    ]);

    expect(result).toMatchObject({ kind: "matched", gradingIndex: 1 });
  });

  it("prefers an exact match in any rendering over a quote-insensitive one", () => {
    const result = resolveChoiceAcrossRenderings("Hello", authored, [
      {
        source: "translation:fr",
        choices: [
          { choice: '"Hello"', points: 0, isCorrect: false },
          { choice: "Autre", points: 1, isCorrect: true },
        ],
      },
      {
        source: "translation:de",
        choices: [
          { choice: "Andere", points: 0, isCorrect: false },
          { choice: "Hello", points: 1, isCorrect: true },
        ],
      },
    ]);

    expect(result).toMatchObject({ kind: "matched", gradingIndex: 1 });
    expect(result.kind === "matched" && result.sources).toEqual([
      "translation:de",
    ]);
  });

  it("skips a rendering where the text names two choices without quotes", () => {
    const result = resolveChoiceAcrossRenderings("yes", authored, [
      {
        source: "translation:xx",
        choices: [
          { choice: '"yes"', points: 0, isCorrect: false },
          { choice: "\u201Cyes\u201D", points: 1, isCorrect: true },
        ],
      },
    ]);

    expect(result.kind).toBe("none");
  });
});
