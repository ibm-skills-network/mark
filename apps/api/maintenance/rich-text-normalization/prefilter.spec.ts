import { convert } from "./converter";
import { modelByName } from "./manifest";
import { unchangedWithoutParsing } from "./prefilter";
import type { Snapshot } from "./types";

jest.mock("canvas", () => null);

const origin = "https://mark.example.test";
const text = JSON.stringify({ types: ["TEXT"] });
const upload = JSON.stringify({ types: ["UPLOAD"] });
const clean =
  "<p>Plain <strong>answer</strong></p><ul><li><p>item</p></li></ul>";
const legacyList =
  '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>x</li></ol>';
const draft = (question: string) =>
  JSON.stringify([
    {
      id: 1,
      question,
      points: 12345678901234567890,
      variants: [{ variantContent: question }],
    },
  ]);

const cases: [string, Snapshot][] = [
  ["plain html", { values: { question: clean } }],
  ["empty", { values: { question: "" } }],
  ["null", { values: { question: null } }],
  [
    "legacy class",
    { values: { question: '<p class="ql-align-center">a</p>' } },
  ],
  ["legacy list", { values: { question: legacyList } }],
  [
    "upper-case list attribute",
    { values: { question: '<ol><li DATA-LIST="bullet">a</li></ol>' } },
  ],
  [
    "entity-encoded class",
    { values: { question: '<p class="&#113;l-align-center">a</p>' } },
  ],
  [
    "legacy in extra",
    {
      values: { question: clean },
      extra: { scoring: JSON.stringify({ d: legacyList }) },
    },
  ],
  [
    "unicode-escaped extra",
    {
      values: { question: clean },
      extra: { scoring: '{"d":"<p class=\\"\\u0071l-align-center\\">a</p>"}' },
    },
  ],
];
const responseCases: [string, Snapshot][] = [
  ["raw html", { values: { learnerResponse: clean }, context: text }],
  [
    "json-wrapped html",
    { values: { learnerResponse: JSON.stringify(clean) }, context: text },
  ],
  [
    "double-wrapped html",
    {
      values: { learnerResponse: JSON.stringify(JSON.stringify(clean)) },
      context: text,
    },
  ],
  [
    "wrapped legacy",
    { values: { learnerResponse: JSON.stringify(legacyList) }, context: text },
  ],
  [
    "unicode-escaped wrapped legacy",
    {
      values: { learnerResponse: '"<p class=\\"\\u0071l-x\\">a</p>"' },
      context: text,
    },
  ],
  [
    "malformed wrapper",
    { values: { learnerResponse: '"<p>unterminated' }, context: text },
  ],
  [
    "wrapped non-string",
    { values: { learnerResponse: '"1"x' }, context: text },
  ],
  [
    "six levels of wrapping",
    {
      values: {
        learnerResponse: [1, 2, 3, 4, 5, 6].reduce(
          (v) => JSON.stringify(v),
          "a",
        ),
      },
      context: text,
    },
  ],
  [
    "structured upload",
    {
      values: {
        learnerResponse: JSON.stringify([{ filename: "a.py", key: "k" }]),
      },
      context: upload,
    },
  ],
  [
    "structured text",
    {
      values: { learnerResponse: JSON.stringify({ text: clean }) },
      context: text,
    },
  ],
  [
    "no historical types",
    {
      values: { learnerResponse: JSON.stringify(clean) },
      context: JSON.stringify({ types: [] }),
    },
  ],
  [
    "legacy feedback",
    {
      values: { learnerResponse: clean },
      context: text,
      extra: { feedback: JSON.stringify([{ feedback: legacyList }]) },
    },
  ],
];
const draftValues = (questionsData: string) => ({
  introduction: clean,
  instructions: null,
  gradingCriteriaOverview: "",
  questionsData,
});
const draftCases: [string, Snapshot][] = [
  ["native draft", { values: draftValues(draft(clean)) }],
  ["string draft", { values: draftValues(JSON.stringify(draft(clean))) }],
  ["legacy draft", { values: draftValues(draft(legacyList)) }],
  ["object draft", { values: draftValues(JSON.stringify({ questions: [] })) }],
  [
    "duplicate keys",
    { values: draftValues('[{"question":"a","question":"b"}]') },
  ],
  ["invalid json", { values: draftValues("[{") }],
];

describe("parser prefilter", () => {
  it.each([
    ...cases.map(([name, s]) => ["Question", name, s] as const),
    ...responseCases.map(([name, s]) => ["QuestionResponse", name, s] as const),
    ...draftCases.map(([name, s]) => ["AssignmentDraft", name, s] as const),
  ])(
    "%s %s: a skipped row matches the full converter",
    (modelName, _name, snapshot) => {
      const model = modelByName(modelName);
      const fast = unchangedWithoutParsing(model, snapshot);
      if (fast) expect(convert(model, snapshot, origin)).toEqual(fast);
    },
  );

  it.each([
    ["Question", cases, ["plain html", "empty", "null"]],
    [
      "QuestionResponse",
      responseCases,
      [
        "raw html",
        "json-wrapped html",
        "double-wrapped html",
        "structured upload",
        "structured text",
        "no historical types",
      ],
    ],
    ["AssignmentDraft", draftCases, ["native draft", "string draft"]],
  ] as const)(
    "%s: clean shapes skip the parser and suspicious ones do not",
    (modelName, list, expected) => {
      const model = modelByName(modelName);
      const skipped = list
        .filter(([, s]) => unchangedWithoutParsing(model, s))
        .map(([name]) => name);
      expect(skipped).toEqual(expected);
    },
  );
});
