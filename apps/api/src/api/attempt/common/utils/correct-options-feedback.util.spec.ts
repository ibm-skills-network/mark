import { LocalizationService } from "./localization.service";
import {
  applyAnswerKeyVisibility,
  applyCorrectOptionsVisibility,
  applyTrueFalseAnswerVisibility,
  correctOptionsSentence,
  trueFalseAnswerSentence,
} from "./correct-options-feedback.util";

describe("correct options feedback", () => {
  const missed = [
    { choice: "Four", feedback: "**Incorrect selection:** Four." },
  ];

  it("writes the sentence in the learner's language", () => {
    expect(correctOptionsSentence("fr", ["Deux", "Trois"])).toBe(
      "Les options correctes étaient: **Deux, Trois**.",
    );
    expect(correctOptionsSentence(undefined, ["2"])).toBe(
      "The correct option(s) were: **2**.",
    );
  });

  it("appends the sentence to the last entry when revealed and not perfect", () => {
    expect(
      applyCorrectOptionsVisibility(missed, {
        revealAnswers: true,
        perfectScore: false,
        correctOptions: ["Two", "Three"],
        language: "en",
      }),
    ).toEqual([
      {
        choice: "Four",
        feedback:
          "**Incorrect selection:** Four.\nThe correct option(s) were: **Two, Three**.",
      },
    ]);
  });

  it("adds nothing for a perfect answer or unknown metadata", () => {
    for (const perfectScore of [true, undefined]) {
      expect(
        applyCorrectOptionsVisibility(missed, {
          revealAnswers: true,
          perfectScore,
          correctOptions: ["Two"],
          language: "en",
        }),
      ).toEqual(missed);
    }
  });

  it.each(["en", "ar", "id", "de", "es", "fr"])(
    "strips a stored %s sentence when the key is hidden",
    (language) => {
      const stored = [
        {
          choice: "Four",
          feedback: `**Incorrect selection:** Four.\n${correctOptionsSentence(
            language,
            ["Two", "Three"],
          )}`,
        },
      ];

      const [entry] = applyCorrectOptionsVisibility(stored, {
        revealAnswers: false,
        perfectScore: false,
        correctOptions: ["Two", "Three"],
        language,
      }) as Array<{ feedback: string }>;

      expect(entry.feedback).toBe("**Incorrect selection:** Four.");
    },
  );

  it("leaves non-object entries and non-string feedback alone", () => {
    const odd = ["text", { feedback: 3 }];
    expect(
      applyCorrectOptionsVisibility(odd, {
        revealAnswers: false,
        perfectScore: false,
        correctOptions: [],
        language: "en",
      }),
    ).toEqual(odd);
  });

  describe("true/false", () => {
    const stored = [{ choice: true, feedback: "Incorrect." }];

    it("names the correct answer in the learner's language when revealed", () => {
      expect(
        applyTrueFalseAnswerVisibility(stored, {
          revealAnswers: true,
          isCorrect: false,
          correctAnswer: false,
          language: "de",
        }),
      ).toEqual([
        {
          choice: true,
          feedback: "Incorrect. Die richtige Antwort ist Falsch.",
        },
      ]);
    });

    it("adds nothing for a right answer or missing metadata", () => {
      for (const [isCorrect, correctAnswer] of [
        [true, true],
        [false, undefined],
        [undefined, true],
      ] as const) {
        expect(
          applyTrueFalseAnswerVisibility(stored, {
            revealAnswers: true,
            isCorrect,
            correctAnswer,
            language: "en",
          }),
        ).toEqual(stored);
      }
    });

    it.each(["en", "ar", "id", "de", "es", "fr"])(
      "strips the answer from a legacy %s row while the key is hidden",
      (language) => {
        const localization = new LocalizationService();
        const legacy = localization.getLocalizedString(
          "incorrectTF",
          language,
          {
            correctAnswer: localization.getLocalizedString("true", language),
          },
        );
        const [entry] = applyTrueFalseAnswerVisibility(
          [{ choice: false, feedback: legacy }],
          {
            revealAnswers: false,
            isCorrect: false,
            correctAnswer: true,
            language,
          },
        ) as Array<{ feedback: string }>;

        expect(entry.feedback).toBe(
          localization.getLocalizedString("incorrectTFNoAnswer", language),
        );
      },
    );

    it("does not repeat the answer a legacy row already names", () => {
      const legacy = [
        {
          choice: false,
          feedback: `Incorrect. ${trueFalseAnswerSentence("en", true)}`,
        },
      ];
      expect(
        applyTrueFalseAnswerVisibility(legacy, {
          revealAnswers: true,
          isCorrect: false,
          correctAnswer: true,
          language: "en",
        }),
      ).toEqual(legacy);
    });
  });

  it("dispatches on the grader's metadata", () => {
    expect(
      applyAnswerKeyVisibility(
        [{ feedback: "Incorrect." }],
        { isCorrect: false, correctAnswer: true },
        {
          revealAnswers: true,
          language: "en",
          isTrueFalse: true,
          isMultipleCorrect: false,
        },
      ),
    ).toEqual([{ feedback: "Incorrect. The correct answer is True." }]);
    expect(
      applyAnswerKeyVisibility([{ feedback: "Well done" }], null, {
        revealAnswers: true,
        language: "en",
        isTrueFalse: false,
        isMultipleCorrect: false,
      }),
    ).toEqual([{ feedback: "Well done" }]);
  });
});
