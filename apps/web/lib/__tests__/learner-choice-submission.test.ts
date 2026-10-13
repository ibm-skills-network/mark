import type { QuestionStore } from "@/config/types";
import {
  selectedChoiceTexts,
  submissionLanguage,
} from "../learner-choice-submission";

const question = (overrides: Partial<QuestionStore>): QuestionStore =>
  ({
    id: 1,
    type: "SINGLE_CORRECT",
    choices: [
      { choice: "A normal transaction" },
      { choice: "A potential anomaly" },
    ],
    learnerChoices: ["1"],
    ...overrides,
  }) as unknown as QuestionStore;

const zh = {
  "zh-CN": {
    translatedText: "q",
    translatedChoices: [{ choice: "正常交易" }, { choice: "潜在的异常" }],
  },
} as unknown as QuestionStore["translations"];

describe("selectedChoiceTexts", () => {
  it("uses the translation for the learner's language when there is one", () => {
    expect(
      selectedChoiceTexts(question({ translations: zh }), "zh-CN"),
    ).toEqual({ texts: ["潜在的异常"], language: "zh-CN" });
  });

  it("labels the plain choices with the language they were fetched in", () => {
    expect(
      selectedChoiceTexts(
        question({ translations: {}, contentLanguage: "ja" }),
        "en",
      ),
    ).toEqual({ texts: ["A potential anomaly"], language: "ja" });
  });

  it("returns no texts when nothing is selected", () => {
    expect(
      selectedChoiceTexts(question({ learnerChoices: [] }), "en").texts,
    ).toEqual([]);
  });
});

describe("submissionLanguage", () => {
  it("names the language the selected choices were rendered in, not the stored preference", () => {
    // The store says English, but the attempt's choices were fetched in
    // Chinese and that is the text being submitted.
    const questions = [
      question({ contentLanguage: "zh-CN" }),
      question({ id: 2, contentLanguage: "zh-CN" }),
    ];
    expect(submissionLanguage(questions, "en")).toBe("zh-CN");
  });

  it("keeps the preference when the choices came from its translation", () => {
    expect(
      submissionLanguage(
        [question({ translations: zh, contentLanguage: "en" })],
        "zh-CN",
      ),
    ).toBe("zh-CN");
  });

  it("keeps the preference when the selected choices mix languages", () => {
    const questions = [
      question({ contentLanguage: "ja" }),
      question({ id: 2, translations: zh, contentLanguage: "en" }),
    ];
    expect(submissionLanguage(questions, "zh-CN")).toBe("zh-CN");
  });

  it("keeps the preference when no choice question is answered", () => {
    expect(
      submissionLanguage(
        [question({ learnerChoices: [], contentLanguage: "ja" })],
        "en",
      ),
    ).toBe("en");
  });

  it("keeps the preference when the fetch language is unknown", () => {
    expect(submissionLanguage([question({})], "en")).toBe("en");
  });
});
