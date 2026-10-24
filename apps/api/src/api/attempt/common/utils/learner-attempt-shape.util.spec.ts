import {
  MappedAttemptQuestion,
  sanitizeRandomizedChoices,
  toLearnerAttemptQuestion,
} from "./learner-attempt-shape.util";

const REQUIRED_KEYS = [
  "id",
  "question",
  "type",
  "choices",
  "translations",
  "authorComment",
  "totalPoints",
  "assignmentId",
  "gradingContextQuestionIds",
  "isDeleted",
  "randomizedChoices",
];
const ALLOWED_KEYS = new Set([
  ...REQUIRED_KEYS,
  "responseType",
  "maxWords",
  "maxCharacters",
  "scoring",
  "videoPresentationConfig",
  "liveRecordingConfig",
]);

const storedChoices = [
  { id: 2, choice: "B", isCorrect: false, points: 0, feedback: "wrong" },
  { id: 1, choice: "A", isCorrect: true, points: 5, feedback: "right" },
];

const mapped = (
  overrides: Partial<MappedAttemptQuestion> & Record<string, unknown> = {},
): MappedAttemptQuestion =>
  ({
    id: 7,
    question: "Pick one",
    type: "SINGLE_CORRECT",
    responseType: null,
    choices: [
      { id: 1, choice: "A" },
      { id: 2, choice: "B" },
    ],
    translations: {
      fr: {
        translatedText: "Choisissez",
        translatedChoices: [{ id: 1, choice: "A", isCorrect: true, points: 5 }],
      },
    },
    authorComment: "grader note",
    answer: "A",
    variantId: 3,
    maxWords: null,
    maxCharacters: 200,
    scoring: {
      type: "CRITERIA_BASED",
      showRubricsToLearner: false,
      rubrics: [{ rubricQuestion: "q", criteria: [] }],
    },
    totalPoints: 5,
    assignmentId: 9,
    gradingContextQuestionIds: [],
    isDeleted: false,
    randomizedChoices: JSON.stringify(storedChoices),
    videoPresentationConfig: null,
    liveRecordingConfig: null,
    ...overrides,
  }) as MappedAttemptQuestion;

describe("toLearnerAttemptQuestion", () => {
  it("emits only contract keys and drops answer, variantId and author comments", () => {
    const shaped = toLearnerAttemptQuestion(mapped(), false);

    for (const key of REQUIRED_KEYS) expect(shaped).toHaveProperty(key);
    for (const key of Object.keys(shaped)) {
      expect(ALLOWED_KEYS.has(key)).toBe(true);
    }
    expect(shaped.authorComment).toBeNull();
    expect(shaped).not.toHaveProperty("maxWords");
    expect(shaped.maxCharacters).toBe(200);
    const serialized = JSON.stringify(shaped);
    expect(serialized).not.toContain('"answer"');
    expect(serialized).not.toContain("grader note");
    expect(serialized).not.toContain('"points"');
    expect(serialized).not.toContain("isCorrect");
  });

  it("serves the frozen order as a sanitised array, never a string", () => {
    const shaped = toLearnerAttemptQuestion(mapped(), false);

    expect(shaped.randomizedChoices).toEqual([
      { id: 2, choice: "B" },
      { id: 1, choice: "A" },
    ]);
  });

  it("adds isCorrect and feedback only when answers may be revealed", () => {
    const shaped = toLearnerAttemptQuestion(mapped(), true);

    expect(shaped.randomizedChoices).toEqual([
      { id: 2, choice: "B", isCorrect: false, feedback: "wrong" },
      { id: 1, choice: "A", isCorrect: true, feedback: "right" },
    ]);
    expect(JSON.stringify(shaped)).not.toContain('"points"');
  });

  it("hides rubrics unless the author shows them to learners", () => {
    expect(
      toLearnerAttemptQuestion(mapped(), false).scoring,
    ).not.toHaveProperty("rubrics");
    const shown = toLearnerAttemptQuestion(
      mapped({
        scoring: {
          type: "CRITERIA_BASED",
          showRubricsToLearner: true,
          rubrics: [{ rubricQuestion: "q", criteria: [] }],
        },
      }),
      false,
    );
    expect(shown.scoring).toHaveProperty("rubrics");
  });

  it("returns an empty translations object when there are none", () => {
    expect(
      toLearnerAttemptQuestion(mapped({ translations: undefined }), false)
        .translations,
    ).toEqual({});
  });
});

describe("sanitizeRandomizedChoices", () => {
  it.each([
    ["boolean flag string", "false"],
    ["boolean", false],
    ["empty array string", "[]"],
    ["empty array", []],
    ["object", { a: 1 }],
    ["null", null],
    ["unparsable", "{not json"],
  ])("is null for %s", (_label, value) => {
    expect(sanitizeRandomizedChoices(value, true)).toBeNull();
  });

  it("accepts an already-parsed array", () => {
    expect(sanitizeRandomizedChoices(storedChoices, false)).toEqual([
      { id: 2, choice: "B" },
      { id: 1, choice: "A" },
    ]);
  });
});
